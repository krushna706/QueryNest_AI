
const {
    AI_PROVIDERS,
    DEFAULT_AI_PROVIDER,
} = require("../../config/aiProviders");

const {
    APP_USAGE_LIMITS,
    getProviderUsageLimits,
} = require("../../config/usageLimits");

const { TASK_TYPES } = require("./taskRouter");
const { streamGroqResponse } = require("./groqProvider");
const { streamGeminiResponse } = require("./geminiProvider");

// ================== ROUTING CONFIGURATION ==================
const MIN_OUTPUT_TOKENS = 256;
const LONG_CONTEXT_THRESHOLD = 4000;

// ================== VALIDATE REQUEST ==================
function validateRoutingOptions({
    task,
    estimatedInputTokens,
    maxOutputTokens,
    providerBudgets,
}) {
    if (typeof task !== "string" || !task.trim()) {
        throw new Error("Invalid AI task.");
    }

    if (!Number.isSafeInteger(estimatedInputTokens) || estimatedInputTokens < 1) {
        throw new Error("Invalid estimated input tokens.");
    }

    if (
        !Number.isSafeInteger(maxOutputTokens) ||
        maxOutputTokens < 1 ||
        maxOutputTokens > APP_USAGE_LIMITS.maxOutputTokensPerRequest
    ) {
        throw new Error("Invalid AI output token limit.");
    }

    if (
        providerBudgets === null ||
        typeof providerBudgets !== "object" ||
        Array.isArray(providerBudgets)
    ) {
        throw new Error("Invalid provider budgets.");
    }
}

// ================== AVAILABLE COUNTER ==================
function remainingBudget(budget, key) {
    const value = budget?.[key];

    return Number.isFinite(value) && value >= 0
        ? value
        : null;
}

// ================== PROVIDER OUTPUT CAPACITY ==================
function getProviderOutputCapacity(
    provider,
    estimatedInputTokens,
    maxOutputTokens,
    providerBudget = {}
) {
    const limits = getProviderUsageLimits(provider);

    if (providerBudget?.available === false) return 0;

    for (const key of [
        "remainingRequestsPerMinute",
        "remainingRequestsPerDay",
    ]) {
        const remaining = remainingBudget(providerBudget, key);

        if (remaining !== null && remaining < 1) {
            return 0;
        }
    }

    // Gemini has a separate input TPM quota.
    if (
        limits.inputTokensPerMinute != null &&
        estimatedInputTokens > limits.inputTokensPerMinute
    ) {
        return 0;
    }

    const remainingInputTPM = remainingBudget(
        providerBudget,
        "remainingInputTokensPerMinute"
    );

    if (
        remainingInputTPM !== null &&
        estimatedInputTokens > remainingInputTPM
    ) {
        return 0;
    }

    let outputCapacity = maxOutputTokens;

    // Groq TPM and daily token limits cover input + output.
    for (const limit of [
        limits.tokensPerMinute,
        limits.tokensPerDay,
        remainingBudget(
            providerBudget,
            "remainingTokensPerMinute"
        ),
        remainingBudget(
            providerBudget,
            "remainingTokensPerDay"
        ),
    ]) {
        if (limit != null) {
            outputCapacity = Math.min(
                outputCapacity,
                limit - estimatedInputTokens
            );
        }
    }

    return Math.max(0, Math.floor(outputCapacity));
}

// ================== PROVIDER ELIGIBILITY ==================
function isProviderEligible(
    provider,
    estimatedInputTokens,
    maxOutputTokens,
    providerBudget = {}
) {
    return getProviderOutputCapacity(
        provider,
        estimatedInputTokens,
        maxOutputTokens,
        providerBudget
    ) >= MIN_OUTPUT_TOKENS;
}

// ================== SELECT PROVIDERS ==================
function selectAIProviders({
    task,
    estimatedInputTokens,
    maxOutputTokens = APP_USAGE_LIMITS.maxOutputTokensPerRequest,
    requiresFullDocument = false,
    providerBudgets = {},
} = {}) {
    validateRoutingOptions({
        task,
        estimatedInputTokens,
        maxOutputTokens,
        providerBudgets,
    });

    const prefersGemini =
        requiresFullDocument ||
        estimatedInputTokens > LONG_CONTEXT_THRESHOLD ||
        [
            TASK_TYPES.SUMMARY,
            TASK_TYPES.COMPARISON,
            TASK_TYPES.RESUME_ANALYSIS,
            TASK_TYPES.DOCUMENT_IMPROVEMENT,
        ].includes(task);

    const alternateProvider = DEFAULT_AI_PROVIDER === "groq"
        ? "gemini"
        : "groq";

    const priority = prefersGemini
        ? ["gemini", "groq"]
        : [DEFAULT_AI_PROVIDER, alternateProvider];

    return [...new Set(priority)].filter(
        (provider) =>
            Boolean(AI_PROVIDERS[provider]) &&
            isProviderEligible(
                provider,
                estimatedInputTokens,
                maxOutputTokens,
                providerBudgets[provider]
            )
    );
}

// ================== RETRYABLE PROVIDER ERRORS ==================
function isRetryableProviderError(error) {
    const status = Number(
        error?.status ??
        error?.statusCode ??
        error?.response?.status ??
        error?.code
    );

    const code = String(error?.code || "").toUpperCase();

    return (
        status === 408 ||
        status === 429 ||
        (status >= 500 && status < 600) ||
        [
            "ECONNRESET",
            "ETIMEDOUT",
            "ECONNREFUSED",
            "EAI_AGAIN",
            "UND_ERR_CONNECT_TIMEOUT",
        ].includes(code)
    );
}

// ================== STREAM AI RESPONSE ==================
async function* streamAIResponse({
    task,
    messages,
    systemInstruction = "",
    estimatedInputTokens,
    maxOutputTokens = APP_USAGE_LIMITS.maxOutputTokensPerRequest,
    requiresFullDocument = false,
    providerBudgets = {},
    reserveProvider,
    signal,
} = {}) {
    if (!Array.isArray(messages) || !messages.length) {
        throw new Error("AI messages are required.");
    }

    if (typeof reserveProvider !== "function") {
        throw new Error("AI quota reservation is required.");
    }

    const providers = selectAIProviders({
        task,
        estimatedInputTokens,
        maxOutputTokens,
        requiresFullDocument,
        providerBudgets,
    });

    let lastProviderError = null;

    for (const provider of providers) {
        if (signal?.aborted) {
            throw new Error("Generation stopped.");
        }

        const providerMaxOutputTokens = getProviderOutputCapacity(
            provider,
            estimatedInputTokens,
            maxOutputTokens,
            providerBudgets[provider]
        );

        // The reservation handles real-time counters and concurrent users.
        const reservation = await reserveProvider({
            provider,
            estimatedInputTokens,
            maxOutputTokens: providerMaxOutputTokens,
        });

        if (!reservation?.allowed) {
            continue;
        }

        let hasVisibleOutput = false;

        try {
            const providerStream = provider === "groq"
                ? streamGroqResponse({
                    messages,
                    systemInstruction,
                    maxOutputTokens: providerMaxOutputTokens,
                    signal,
                })
                : streamGeminiResponse({
                    messages,
                    systemInstruction,
                    maxOutputTokens: providerMaxOutputTokens,
                    signal,
                });

            yield {
                type: "provider",
                provider,
                model: AI_PROVIDERS[provider].model,
            };

            for await (const event of providerStream) {
                if (signal?.aborted) {
                    throw new Error("Generation stopped.");
                }

                if (event.type === "delta" && event.text) {
                    hasVisibleOutput = true;
                }

                yield event;
            }

            return;
        } catch (error) {
            // Never switch models after any response text reaches the user.
            if (
                signal?.aborted ||
                hasVisibleOutput ||
                !isRetryableProviderError(error)
            ) {
                throw error;
            }

            lastProviderError = error;
        }
    }

    if (lastProviderError) {
        throw lastProviderError;
    }

    throw new Error(
        "No AI provider has sufficient quota for this request."
    );
}

// ================== EXPORTS ==================
module.exports = {
    selectAIProviders,
    streamAIResponse,
};
