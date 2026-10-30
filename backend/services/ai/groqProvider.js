
const Groq = require("groq-sdk").default;

const {
    getAIProviderConfig,
} = require("../../config/aiProviders");

// ================== GROQ CLIENT ==================
let groqClient = null;

function getGroqClient(apiKey) {
    if (!groqClient) {
        groqClient = new Groq({
            apiKey,
            maxRetries: 0,
        });
    }

    return groqClient;
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

// ================== GROQ STREAM ==================
async function* streamGroqResponse({
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
    const { apiKey, model } = getAIProviderConfig("groq");
    const client = getGroqClient(apiKey);

    // ================== PREPARE MESSAGES ==================
    const chatMessages = [
        ...(systemInstruction.trim()
            ? [{
                role: "system",
                content: systemInstruction.trim(),
            }]
            : []),

        ...messages.map((message) => ({
            role: message.role,
            content: message.content,
        })),
    ];

    // ================== GENERATE RESPONSE ==================
    const stream = await client.chat.completions.create(
        {
            model,
            messages: chatMessages,
            max_completion_tokens: maxOutputTokens,
            stream: true,
            stream_options: {
                include_usage: true,
            },
        },
        {
            signal,
        }
    );

    let finishReason = null;
    let usageReported = false;

    // ================== PROCESS STREAM ==================
    for await (const chunk of stream) {
        if (signal?.aborted) {
            throw new Error("AI request cancelled.");
        }

        const choice = chunk.choices?.[0];
        const content = choice?.delta?.content;

        // ================== RESPONSE TEXT ==================
        if (typeof content === "string" && content.length > 0) {
            yield {
                type: "delta",
                text: content,
            };
        }

        // ================== FINISH REASON ==================
        if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
        }

        // ================== TOKEN USAGE ==================
        const usage = chunk.x_groq?.usage || chunk.usage;

        if (usage && !usageReported) {
            usageReported = true;

            yield {
                type: "usage",
                inputTokens: usage.prompt_tokens ?? null,
                outputTokens: usage.completion_tokens ?? null,
                totalTokens: usage.total_tokens ?? null,
            };
        }
    }

    // ================== STREAM COMPLETE ==================
    yield {
        type: "finish",
        reason: finishReason || "unknown",
    };
}

// ================== EXPORT ==================
module.exports = {
    streamGroqResponse,
};
