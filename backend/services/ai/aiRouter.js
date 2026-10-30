
const {
    AI_PROVIDERS,
    DEFAULT_AI_PROVIDER,
} = require("../../config/aiProviders");

const {
    getProviderUsageLimits,
} = require("../../config/usageLimits");

const { TASK_TYPES } = require("./taskRouter");
const { streamGroqResponse } = require("./groqProvider");
const { streamGeminiResponse } = require("./geminiProvider");

// ================== PROVIDER STREAMS ==================
const PROVIDER_STREAMS = {
    groq: streamGroqResponse,
    gemini: streamGeminiResponse,
};

// ================== LONG CONTEXT TASKS ==================
const LONG_CONTEXT_TASKS = new Set([
    TASK_TYPES.RESUME_ANALYSIS,
    TASK_TYPES.COMPARISON,
]);

// ================== VALIDATE ROUTING OPTIONS ==================
function validateRoutingOptions({
    task,
    estimatedInputTokens,
    maxOutputTokens,
    providerBudgets,
}) {
    if (!Object.values(TASK_TYPES).includes(task)) {
        throw new Error("Invalid AI task type.");
    }

    if (
        !Number.isInteger(estimatedInputTokens) ||
        estimatedInputTokens < 1
    ) {
        throw new Error("Invalid estimated input tokens.");
    }

    if (
        !Number.isInteger(maxOutputTokens) ||
        maxOutputTokens < 1
    ) {
        throw new Error("Invalid output token limit.");
    }

    if (
        !providerBudgets ||
        typeof providerBudgets !== "object" ||
        Array.isArray(providerBudgets)
    ) {
        throw new Error("Invalid provider budgets.");
    }
}

// ================== PROVIDER ELIGIBILITY ==================
function isProviderEligible(
    provider,
    estimatedInputTokens,
    maxOutputTokens,
    providerBudget = {}
) {
    const config = AI_PROVIDERS[provider];

    if (!config) return false;

    // ================== API KEY ==================
    if (!process.env[config.apiKeyEnv]?.trim()) {
        return false;
    }

    // ================== PROVIDER STATUS ==================
    if (
        providerBudget.available === false ||
        providerBudget.disabled === true
    ) {
        return false;
    }

    const limits = getProviderUsageLimits(provider);

    // ================== REQUEST TOKEN LIMIT ==================
    if (
        Number.isFinite(limits.tokensPerMinute) &&
        estimatedInputTokens + maxOutputTokens >
            limits.tokensPerMinute
    ) {
        return false;
    }

    if (
        Number.isFinite(limits.inputTokensPerMinute) &&
        estimatedInputTokens > limits.inputTokensPerMinute
    ) {
        return false;
    }

    // ================== REMAINING REQUESTS ==================
    if (
        Number.isFinite(providerBudget.remainingRequestsPerMinute) &&
        providerBudget.remainingRequestsPerMinute < 1
    ) {
        return false;
    }

    if (
        Number.isFinite(providerBudget.remainingRequestsPerDay) &&
        providerBudget.remainingRequestsPerDay < 1
    ) {
        return false;
    }

    // ================== REMAINING TOKENS ==================
    const estimatedTotalTokens =
        estimatedInputTokens + maxOutputTokens;

    if (
        Number.isFinite(providerBudget.remainingTokensPerMinute) &&
        estimatedTotalTokens >
            providerBudget.remainingTokensPerMinute
    ) {
        return false;
    }

    if (
        Number.isFinite(providerBudget.remainingInputTokensPerMinute) &&
        estimatedInputTokens >
            providerBudget.remainingInputTokensPerMinute
    ) {
        return false;
    }

    if (
        Number.isFinite(providerBudget.remainingTokensPerDay) &&
        estimatedTotalTokens >
            providerBudget.remainingTokensPerDay
    ) {
        return false;
    }

    return true;
}

// ================== SELECT PROVIDER ORDER ==================
function selectAIProviders({
    task = TASK_TYPES.GENERAL_CHAT,
    estimatedInputTokens,
    maxOutputTokens = 2048,
    requiresFullDocument = false,
    providerBudgets = {},
} = {}) {
    validateRoutingOptions({
        task,
        estimatedInputTokens,
        maxOutputTokens,
        providerBudgets,
    });

    // ================== PREFERRED PROVIDER ==================
    const groqLimits = getProviderUsageLimits("groq");

    const exceedsGroqBudget =
        estimatedInputTokens + maxOutputTokens >
        groqLimits.tokensPerMinute;

    const preferGemini =
        LONG_CONTEXT_TASKS.has(task) ||
        requiresFullDocument ||
        exceedsGroqBudget;

    const preferredProvider = preferGemini
        ? "gemini"
        : DEFAULT_AI_PROVIDER;

    // ================== FALLBACK ORDER ==================
    const providerOrder = [
        preferredProvider,
        ...Object.keys(PROVIDER_STREAMS).filter(
            (provider) => provider !== preferredProvider
        ),
    ];

    // ================== FILTER ELIGIBLE PROVIDERS ==================
    return providerOrder.filter((provider) =>
        isProviderEligible(
            provider,
            estimatedInputTokens,
            maxOutputTokens,
            providerBudgets[provider]
        )
    );
}

// ================== RETRYABLE PROVIDER ERROR ==================
function isRetryableProviderError(error) {
    const status = Number(
        error?.status ??
        error?.statusCode ??
        error?.response?.status
    );

    const code = String(
        error?.code ||
        error?.cause?.code ||
        ""
    ).toUpperCase();

    const retryableStatuses = [
        408,
        429,
        500,
        502,
        503,
        504,
    ];

    const retryableCodes = [
        "ETIMEDOUT",
        "ECONNRESET",
        "EAI_AGAIN",
        "UND_ERR_CONNECT_TIMEOUT",
        "RESOURCE_EXHAUSTED",
        "UNAVAILABLE",
    ];

    return (
        retryableStatuses.includes(status) ||
        retryableCodes.includes(code)
    );
}

// ================== STREAM AI RESPONSE ==================
async function* streamAIResponse({
    task = TASK_TYPES.GENERAL_CHAT,
    messages,
    systemInstruction = "",
    estimatedInputTokens,
    maxOutputTokens = 2048,
    requiresFullDocument = false,
    providerBudgets = {},
    reserveProvider,
    signal,
} = {}) {
    // ================== VALIDATE REQUEST ==================
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error("AI messages are required.");
    }

    if (typeof reserveProvider !== "function") {
        throw new Error("AI capacity reservation is required.");
    }

    // ================== GET PROVIDER ORDER ==================
    const providers = selectAIProviders({
        task,
        estimatedInputTokens,
        maxOutputTokens,
        requiresFullDocument,
        providerBudgets,
    });

    if (!providers.length) {
        throw new Error(
            "No AI provider is currently eligible for this request."
        );
    }

    let lastError = null;

    // ================== PROVIDER ATTEMPTS ==================
    for (const provider of providers) {
        if (signal?.aborted) {
            throw new Error("AI request cancelled.");
        }

        // Reserve capacity before starting each provider request.
        const reservation = await reserveProvider({
            provider,
            estimatedInputTokens,
            maxOutputTokens,
        });

        if (!reservation?.allowed) {
            continue;
        }

        const streamProvider = PROVIDER_STREAMS[provider];
        const model = AI_PROVIDERS[provider].model;

        let hasStartedResponse = false;
        let providerAnnounced = false;
        let finishReason = "unknown";

        try {
            // ================== START PROVIDER STREAM ==================
            const stream = streamProvider({
                messages,
                systemInstruction,
                maxOutputTokens,
                signal,
            });

            for await (const event of stream) {
                if (signal?.aborted) {
                    throw new Error("AI request cancelled.");
                }

                // ================== TEXT CHUNKS ==================
                if (
                    event.type === "delta" &&
                    typeof event.text === "string" &&
                    event.text.length > 0
                ) {
                    if (!providerAnnounced) {
                        providerAnnounced = true;

                        yield {
                            type: "provider",
                            provider,
                            model,
                        };
                    }

                    hasStartedResponse = true;

                    yield {
                        type: "delta",
                        text: event.text,
                    };
                }

                // ================== TOKEN USAGE ==================
                else if (event.type === "usage") {
                    yield {
                        ...event,
                        provider,
                        model,
                    };
                }

                // ================== FINISH REASON ==================
                else if (event.type === "finish") {
                    finishReason = event.reason || "unknown";
                }
            }

            // ================== RESPONSE COMPLETE ==================
            if (!providerAnnounced) {
                yield {
                    type: "provider",
                    provider,
                    model,
                };
            }

            yield {
                type: "finish",
                provider,
                model,
                reason: finishReason,
            };

            return;
        } catch (error) {
            lastError = error;

            // Never fallback after visible response content.
            if (
                signal?.aborted ||
                hasStartedResponse ||
                !isRetryableProviderError(error)
            ) {
                throw error;
            }

            // Retryable failure before response:
            // try the next eligible provider, if any.
        }
    }

    // ================== PROVIDERS UNAVAILABLE ==================
    if (lastError) {
        throw lastError;
    }

    throw new Error(
        "AI providers are temporarily unavailable. Please try again later."
    );
}

// ================== EXPORT ==================
module.exports = {
    selectAIProviders,
    streamAIResponse,
};
