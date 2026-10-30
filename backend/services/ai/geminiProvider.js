
const { GoogleGenAI } = require("@google/genai");

const {
    getAIProviderConfig,
} = require("../../config/aiProviders");

// ================== GEMINI CLIENT ==================
let geminiClient = null;

function getGeminiClient(apiKey) {
    if (!geminiClient) {
        geminiClient = new GoogleGenAI({
            apiKey,
        });
    }

    return geminiClient;
}

// ================== VALIDATE MESSAGES ==================
function validateMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error("AI messages are required.");
    }

    for (const message of messages) {
        if (
            !["user", "assistant"].includes(message.role) ||
            typeof message.content !== "string" ||
            !message.content.trim()
        ) {
            throw new Error("Invalid AI message format.");
        }
    }
}

// ================== GEMINI STREAM ==================
async function* streamGeminiResponse({
    messages,
    systemInstruction = "",
    maxOutputTokens = 2048,
    signal,
} = {}) {
    validateMessages(messages);

    if (
        typeof systemInstruction !== "string" ||
        !Number.isInteger(maxOutputTokens) ||
        maxOutputTokens < 1
    ) {
        throw new Error("Invalid AI generation options.");
    }

    if (signal?.aborted) {
        throw new Error("AI request cancelled.");
    }

    // ================== PROVIDER CONFIGURATION ==================
    const { apiKey, model } = getAIProviderConfig("gemini");
    const client = getGeminiClient(apiKey);

    // ================== PREPARE MESSAGES ==================
    const contents = messages.map((message) => ({
        role: message.role === "assistant"
            ? "model"
            : "user",

        parts: [
            {
                text: message.content,
            },
        ],
    }));

    // ================== GENERATE RESPONSE ==================
    const stream = await client.models.generateContentStream({
        model,
        contents,
        config: {
            ...(systemInstruction.trim()
                ? {
                    systemInstruction: systemInstruction.trim(),
                }
                : {}),

            maxOutputTokens,

            // Avoid additional untracked continuation requests.
            automaticContinuation: false,

            ...(signal
                ? { abortSignal: signal }
                : {}),
        },
    });

    let finishReason = null;
    let usage = null;

    // ================== PROCESS STREAM ==================
    for await (const chunk of stream) {
        if (signal?.aborted) {
            throw new Error("AI request cancelled.");
        }

        // ================== RESPONSE TEXT ==================
        const content = chunk.text;

        if (typeof content === "string" && content.length > 0) {
            yield {
                type: "delta",
                text: content,
            };
        }

        // ================== FINISH REASON ==================
        const reason = chunk.candidates?.[0]?.finishReason;

        if (reason) {
            finishReason = reason;
        }

        // ================== TOKEN USAGE ==================
        if (chunk.usageMetadata) {
            usage = chunk.usageMetadata;
        }
    }

    // ================== FINAL TOKEN USAGE ==================
    if (usage) {
        yield {
            type: "usage",
            inputTokens: usage.promptTokenCount ?? null,
            outputTokens: usage.candidatesTokenCount ?? null,
            totalTokens: usage.totalTokenCount ?? null,
        };
    }

    // ================== STREAM COMPLETE ==================
    yield {
        type: "finish",
        reason: finishReason === "MAX_TOKENS"
            ? "length"
            : finishReason?.toLowerCase() || "unknown",
    };
}

// ================== EXPORT ==================
module.exports = {
    streamGeminiResponse,
};
