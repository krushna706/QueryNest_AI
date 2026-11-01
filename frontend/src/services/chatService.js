import { DOCUMENT_LIMITS } from "../config/appConfig";
import api from "./api";

// Request id
function generateChatRequestId() {
    return crypto.randomUUID();
}

// Create conversation
async function createConversation(content, clientRequestId) {
    const { data } = await api.post("/chats", {
        content,
        clientRequestId,
    });

    return data;
}

// Chat history
async function getChatHistory({ search = "", cursor, limit = 20 } = {}) {
    const { data } = await api.get("/chats", {
        params: {
            search,
            limit,
            ...(cursor ? { cursor } : {}),
        },
    });

    return data;
}

// Get conversation
async function getConversation(conversationId) {
    const { data } = await api.get(`/chats/${conversationId}`);

    return data;
}

// Rename conversation
async function renameConversation(conversationId, title) {
    const { data } = await api.patch(`/chats/${conversationId}`, { title });

    return data;
}

// Delete conversation
async function deleteConversation(conversationId) {
    const { data } = await api.delete(`/chats/${conversationId}`);

    return data;
}

// Send user message
async function sendMessage(conversationId, content, clientRequestId, attachmentIds = []) {
    if (!Array.isArray(attachmentIds)) {
        throw new Error("Attachments must be an array.");
    }

    if (attachmentIds.length > DOCUMENT_LIMITS.maxFiles) {
        throw new Error("Maximum 3 documents are allowed.");
    }

    const uniqueIds = new Set(attachmentIds);

    if (
        uniqueIds.size !== attachmentIds.length ||
        attachmentIds.some((id) => typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id))
    ) {
        throw new Error("Invalid or duplicate document IDs.");
    }

    const { data } = await api.post(`/chats/${conversationId}/messages`, {
        content,
        clientRequestId,
        ...(attachmentIds.length ? { attachmentIds } : {}),
    });

    return data;
}

// Message history
async function getMessageHistory(conversationId, { before, limit = 20 } = {}) {
    const { data } = await api.get(`/chats/${conversationId}/messages`, {
        params: {
            limit,
            ...(before ? { before } : {}),
        },
    });

    return data;
}

// Validate object id
function validateMessageId(value, fieldName) {
    if (typeof value !== "string" || !/^[a-f0-9]{24}$/i.test(value)) {
        throw new Error(`Invalid ${fieldName}.`);
    }

    return value;
}

// Parse retry wait
function parseRetryAfter(value) {
    if (value == null || value === "") {
        return null;
    }

    const seconds = Number(value);

    if (Number.isFinite(seconds) && seconds > 0) {
        return Math.ceil(seconds);
    }

    // HTTP Retry-After can also be an HTTP date.
    if (typeof value === "string") {
        const timestamp = Date.parse(value);

        if (Number.isFinite(timestamp)) {
            const remaining = Math.ceil((timestamp - Date.now()) / 1000);

            return remaining > 0 ? remaining : null;
        }
    }

    return null;
}

// Create structured ai error
function createAIError(
    payload,
    { fallback = "AI generation failed. Please try again.", httpStatus = null, retryAfter = null } = {}
) {
    const details = payload && typeof payload === "object" ? payload : {};

    const nestedError = details.error && typeof details.error === "object" ? details.error : {};

    const serverMessage =
        nestedError.message || details.message || (typeof details.error === "string" ? details.error : null);

    const message = typeof serverMessage === "string" && serverMessage.trim() ? serverMessage.trim() : fallback;

    const providedCode = nestedError.code || details.code || null;

    const code = typeof providedCode === "string" && providedCode.trim() ? providedCode.trim().toUpperCase() : null;

    const providedStatus = nestedError.status ?? details.status ?? httpStatus;

    const numericStatus = Number(providedStatus);

    const status =
        Number.isInteger(numericStatus) && numericStatus >= 400 && numericStatus <= 599 ? numericStatus : null;

    const retryAfterSeconds = parseRetryAfter(
        nestedError.retryAfterSeconds ??
            details.retryAfterSeconds ??
            nestedError.retryAfter ??
            details.retryAfter ??
            retryAfter
    );

    const error = new Error(message);

    error.name = "AIResponseError";

    if (code) {
        error.code = code;
    }

    // Preserve the same error shape used by Axios
    // so Conversation.jsx can handle both uniformly.
    error.response = {
        status,

        data: {
            message,
            ...(code ? { code } : {}),

            ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
        },

        headers: retryAfterSeconds
            ? {
                  "retry-after": String(retryAfterSeconds),
              }
            : {},
    };

    return error;
}

// Process sse event
function processStreamEvent(block, onEvent) {
    let eventType = "message";

    const dataLines = [];

    for (const line of block.split(/\r?\n/)) {
        if (!line || line.startsWith(":")) {
            continue;
        }

        if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
        }
    }

    if (!dataLines.length) {
        return false;
    }

    let data;

    try {
        data = JSON.parse(dataLines.join("\n"));
    } catch {
        throw createAIError(
            {
                code: "INVALID_STREAM_RESPONSE",
            },
            {
                fallback: "The AI response was interrupted. Please try again.",
            }
        );
    }

    if (eventType === "error") {
        throw createAIError(data, {
            fallback: "AI generation failed. Please try again.",
        });
    }

    onEvent?.({
        type: eventType,
        data,
    });

    return eventType === "done";
}

// Generate ai stream
async function generateAIResponse(conversationId, messageId, { regenerate = false, signal, onEvent } = {}) {
    const validConversationId = validateMessageId(conversationId, "Conversation ID");

    const validMessageId = validateMessageId(messageId, "Message ID");

    const baseURL = api.defaults.baseURL?.replace(/\/$/, "");

    if (!baseURL) {
        throw new Error("API base URL is not configured.");
    }

    const response = await fetch(`${baseURL}/chats/${validConversationId}/generate`, {
        method: "POST",

        credentials: "include",

        headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
        },

        body: JSON.stringify({
            messageId: validMessageId,
            regenerate: Boolean(regenerate),
        }),

        signal,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);

        throw createAIError(errorData, {
            httpStatus: response.status,

            retryAfter: response.headers.get("Retry-After"),

            fallback: `AI request failed (${response.status}).`,
        });
    }

    if (!response.body) {
        throw createAIError(
            {
                code: "STREAM_UNAVAILABLE",
            },
            {
                fallback: "The AI response could not be started. Please try again.",
            }
        );
    }

    const reader = response.body.getReader();

    const decoder = new TextDecoder();

    let buffer = "";
    let completed = false;

    try {
        while (!completed) {
            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            buffer += decoder.decode(value, {
                stream: true,
            });

            let boundary = /\r?\n\r?\n/.exec(buffer);

            while (boundary) {
                const block = buffer.slice(0, boundary.index);

                buffer = buffer.slice(boundary.index + boundary[0].length);

                if (processStreamEvent(block, onEvent)) {
                    completed = true;
                    break;
                }

                boundary = /\r?\n\r?\n/.exec(buffer);
            }

            if (buffer.length > 1024 * 1024) {
                throw createAIError(
                    {
                        code: "STREAM_EVENT_TOO_LARGE",
                    },
                    {
                        fallback: "The AI response was interrupted. Please try again.",
                    }
                );
            }
        }

        if (!completed) {
            buffer += decoder.decode();

            if (buffer.trim()) {
                completed = processStreamEvent(buffer.trim(), onEvent);
            }
        }

        if (!completed) {
            throw createAIError(
                {
                    code: "STREAM_INTERRUPTED",
                },
                {
                    fallback: "The AI response was interrupted. Please try again.",
                }
            );
        }
    } finally {
        if (!completed) {
            await reader.cancel().catch(() => {});
        }

        reader.releaseLock();
    }
}

// Exports
export {
    generateChatRequestId,
    createConversation,
    getChatHistory,
    getConversation,
    renameConversation,
    deleteConversation,
    sendMessage,
    getMessageHistory,
    generateAIResponse,
};
