const { GoogleGenAI } = require("@google/genai");

const { getAIProviderConfig } = require("../../config/aiProviders");
const { APP_USAGE_LIMITS } = require("../../config/usageLimits");

// Prepare gemini messages
function prepareGeminiMessages(messages, systemInstruction) {
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error("AI messages are required.");
    }

    const contents = [];
    const instructions = [];

    if (typeof systemInstruction === "string" && systemInstruction.trim()) {
        instructions.push(systemInstruction.trim());
    }

    for (const message of messages) {
        if (
            !["system", "user", "assistant"].includes(message?.role) ||
            typeof message?.content !== "string" ||
            !message.content.trim()
        ) {
            throw new Error("Invalid Gemini message format.");
        }

        if (message.role === "system") {
            instructions.push(message.content.trim());
            continue;
        }

        contents.push({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
        });
    }

    if (!contents.length) {
        throw new Error("At least one user or assistant message is required.");
    }

    return {
        contents,
        systemInstruction: instructions.join("\n\n"),
    };
}

// Normalize token usage
function normalizeGeminiUsage(usage) {
    if (!usage || typeof usage !== "object") return null;

    const inputTokens = usage.promptTokenCount;
    const candidateTokens = usage.candidatesTokenCount ?? 0;
    const thinkingTokens = usage.thoughtsTokenCount ?? 0;

    const totalTokens = usage.totalTokenCount ?? inputTokens + candidateTokens + thinkingTokens;

    if (
        !Number.isSafeInteger(inputTokens) ||
        inputTokens < 0 ||
        !Number.isSafeInteger(totalTokens) ||
        totalTokens < inputTokens
    ) {
        return null;
    }

    // Include thinking tokens in the output-side usage budget.
    return {
        type: "usage",
        inputTokens,
        outputTokens: totalTokens - inputTokens,
        totalTokens,
    };
}

// Stream gemini response
async function* streamGeminiResponse({
    messages,
    systemInstruction = "",
    maxOutputTokens = APP_USAGE_LIMITS.maxOutputTokensPerRequest,
    signal,
} = {}) {
    if (
        !Number.isSafeInteger(maxOutputTokens) ||
        maxOutputTokens < 1 ||
        maxOutputTokens > APP_USAGE_LIMITS.maxOutputTokensPerRequest
    ) {
        throw new Error("Invalid Gemini output token limit.");
    }

    if (signal?.aborted) {
        throw new Error("Generation stopped.");
    }

    const { contents, systemInstruction: instruction } = prepareGeminiMessages(messages, systemInstruction);

    const { apiKey, model } = getAIProviderConfig("gemini");

    const client = new GoogleGenAI({ apiKey });

    const config = {
        maxOutputTokens,

        ...(instruction ? { systemInstruction: instruction } : {}),

        ...(signal ? { abortSignal: signal } : {}),
    };

    const stream = await client.models.generateContentStream({
        model,
        contents,
        config,
    });

    let finishReason = "unknown";
    let lastUsage = null;

    for await (const chunk of stream) {
        if (signal?.aborted) {
            throw new Error("Generation stopped.");
        }

        const candidate = chunk?.candidates?.[0];
        const parts = candidate?.content?.parts;

        const text = Array.isArray(parts)
            ? parts
                  .filter((part) => !part?.thought && typeof part?.text === "string")
                  .map((part) => part.text)
                  .join("")
            : typeof chunk?.text === "string"
              ? chunk.text
              : "";

        if (text) {
            yield {
                type: "delta",
                text,
            };
        }

        if (candidate?.finishReason) {
            const reason = candidate.finishReason;

            finishReason = reason === "STOP" ? "stop" : reason === "MAX_TOKENS" ? "length" : reason.toLowerCase();
        }

        if (chunk?.usageMetadata) {
            lastUsage = chunk.usageMetadata;
        }
    }

    if (signal?.aborted) {
        throw new Error("Generation stopped.");
    }

    // Gemini usage metadata can be cumulative.
    // Emit once to avoid double-counting.
    const usageEvent = normalizeGeminiUsage(lastUsage);

    if (usageEvent) {
        yield usageEvent;
    }

    yield {
        type: "finish",
        reason: finishReason,
    };
}

// Exports
module.exports = {
    streamGeminiResponse,
};
