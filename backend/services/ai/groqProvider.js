
const Groq = require("groq-sdk");

const { getAIProviderConfig } = require("../../config/aiProviders");
const { APP_USAGE_LIMITS } = require("../../config/usageLimits");

// ================== PREPARE GROQ MESSAGES ==================
function prepareGroqMessages(messages, systemInstruction) {
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error("AI messages are required.");
    }

    const prepared = [];

    if (typeof systemInstruction === "string" && systemInstruction.trim()) {
        prepared.push({
            role: "system",
            content: systemInstruction.trim(),
        });
    }

    for (const message of messages) {
        if (
            !["system", "user", "assistant"].includes(message?.role) ||
            typeof message?.content !== "string" ||
            !message.content.trim()
        ) {
            throw new Error("Invalid Groq message format.");
        }

        prepared.push({
            role: message.role,
            content: message.content,
        });
    }

    return prepared;
}

// ================== NORMALIZE TOKEN USAGE ==================
function normalizeGroqUsage(usage) {
    if (!usage || typeof usage !== "object") return null;

    const inputTokens = usage.prompt_tokens ?? usage.input_tokens;
    const outputTokens = usage.completion_tokens ?? usage.output_tokens;

    const totalTokens = usage.total_tokens ??
        (Number.isSafeInteger(inputTokens) && Number.isSafeInteger(outputTokens)
            ? inputTokens + outputTokens
            : null);

    if (
        !Number.isSafeInteger(inputTokens) || inputTokens < 0 ||
        !Number.isSafeInteger(outputTokens) || outputTokens < 0 ||
        !Number.isSafeInteger(totalTokens) || totalTokens < 0
    ) {
        return null;
    }

    return {
        type: "usage",
        inputTokens,
        outputTokens,
        totalTokens,
    };
}

// ================== STREAM GROQ RESPONSE ==================
async function* streamGroqResponse({
    messages,
    systemInstruction = "",
    maxOutputTokens = APP_USAGE_LIMITS.maxOutputTokensPerRequest,
    signal,
} = {}) {

    // ================== VALIDATE OUTPUT LIMIT ==================
    if (
        !Number.isSafeInteger(maxOutputTokens) ||
        maxOutputTokens < 1 ||
        maxOutputTokens > APP_USAGE_LIMITS.maxOutputTokensPerRequest
    ) {
        throw new Error("Invalid Groq output token limit.");
    }

    if (signal?.aborted) {
        throw new Error("Generation stopped.");
    }

    // ================== PREPARE REQUEST ==================
    const preparedMessages = prepareGroqMessages(
        messages,
        systemInstruction
    );

    const { apiKey, model } = getAIProviderConfig("groq");

    // ================== INITIALIZE GROQ ==================
    const client = new Groq({
        apiKey,
        maxRetries: 0,
        timeout: 60000,
    });

    // ================== CREATE STREAM ==================
    const completion = await client.chat.completions.create(
        {
            model,
            messages: preparedMessages,
            stream: true,
            stream_options: {
                include_usage: true,
            },
            max_completion_tokens: maxOutputTokens,
        },
        { signal }
    );

    let finishReason = "unknown";

    // ================== PROCESS STREAM ==================
    for await (const chunk of completion) {
        if (signal?.aborted) {
            throw new Error("Generation stopped.");
        }

        const choice = chunk?.choices?.[0];
        const text = choice?.delta?.content;

        // ================== RESPONSE TEXT ==================
        if (typeof text === "string" && text.length > 0) {
            yield {
                type: "delta",
                text,
            };
        }

        // ================== FINISH REASON ==================
        if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
        }

        // ================== TOKEN USAGE ==================
        const usageEvent = normalizeGroqUsage(
            chunk?.usage ?? chunk?.x_groq?.usage
        );

        if (usageEvent) {
            yield usageEvent;
        }
    }

    // ================== STREAM COMPLETED ==================
    if (signal?.aborted) {
        throw new Error("Generation stopped.");
    }

    yield {
        type: "finish",
        reason: finishReason,
    };
}

// ================== EXPORTS ==================
module.exports = {
    streamGroqResponse,
};
