
import api from "./api";

// ================== REQUEST ID ==================
function generateChatRequestId() {
    return crypto.randomUUID();
}

// ================== CREATE CONVERSATION ==================
async function createConversation(content, clientRequestId) {
    const { data } = await api.post("/chats", {
        content,
        clientRequestId,
    });

    return data;
}

// ================== CHAT HISTORY ==================
async function getChatHistory({
    search = "",
    cursor,
    limit = 20,
} = {}) {
    const { data } = await api.get("/chats", {
        params: {
            search,
            limit,
            ...(cursor ? { cursor } : {}),
        },
    });

    return data;
}

// ================== GET CONVERSATION ==================
async function getConversation(conversationId) {
    const { data } = await api.get(
        `/chats/${conversationId}`
    );

    return data;
}

// ================== RENAME CONVERSATION ==================
async function renameConversation(conversationId, title) {
    const { data } = await api.patch(
        `/chats/${conversationId}`,
        { title }
    );

    return data;
}

// ================== DELETE CONVERSATION ==================
async function deleteConversation(conversationId) {
    const { data } = await api.delete(
        `/chats/${conversationId}`
    );

    return data;
}

// ================== SEND USER MESSAGE ==================
async function sendMessage(
    conversationId,
    content,
    clientRequestId,
    attachmentIds = []
) {
    // ================== DOCUMENT VALIDATION ==================
    if (!Array.isArray(attachmentIds)) {
        throw new Error("Attachments must be an array.");
    }

    if (attachmentIds.length > 3) {
        throw new Error(
            "Maximum 3 documents are allowed."
        );
    }

    const uniqueIds = new Set(attachmentIds);

    if (
        uniqueIds.size !== attachmentIds.length ||
        attachmentIds.some(
            (id) =>
                typeof id !== "string" ||
                !/^[a-f0-9]{24}$/i.test(id)
        )
    ) {
        throw new Error(
            "Invalid or duplicate document IDs."
        );
    }

    // ================== SAVE MESSAGE ==================
    const { data } = await api.post(
        `/chats/${conversationId}/messages`,
        {
            content,
            clientRequestId,
            ...(attachmentIds.length
                ? { attachmentIds }
                : {}),
        }
    );

    return data;
}

// ================== MESSAGE HISTORY ==================
async function getMessageHistory(
    conversationId,
    {
        before,
        limit = 20,
    } = {}
) {
    const { data } = await api.get(
        `/chats/${conversationId}/messages`,
        {
            params: {
                limit,
                ...(before ? { before } : {}),
            },
        }
    );

    return data;
}

// ================== VALIDATE OBJECT ID ==================
function validateMessageId(value, fieldName) {
    if (
        typeof value !== "string" ||
        !/^[a-f0-9]{24}$/i.test(value)
    ) {
        throw new Error(`Invalid ${fieldName}.`);
    }

    return value;
}

// ================== PARSE RETRY WAIT ==================
function parseRetryAfter(value) {
    if (value == null || value === "") {
        return null;
    }

    const seconds = Number(value);

    if (
        Number.isFinite(seconds) &&
        seconds > 0
    ) {
        return Math.ceil(seconds);
    }

    // HTTP Retry-After can also be an HTTP date.
    if (typeof value === "string") {
        const timestamp = Date.parse(value);

        if (Number.isFinite(timestamp)) {
            const remaining = Math.ceil(
                (timestamp - Date.now()) / 1000
            );

            return remaining > 0
                ? remaining
                : null;
        }
    }

    return null;
}

// ================== CREATE STRUCTURED AI ERROR ==================
function createAIError(
    payload,
    {
        fallback = "AI generation failed. Please try again.",
        httpStatus = null,
        retryAfter = null,
    } = {}
) {
    const details =
        payload &&
        typeof payload === "object"
            ? payload
            : {};

    const nestedError =
        details.error &&
        typeof details.error === "object"
            ? details.error
            : {};

    // ================== SERVER ERROR MESSAGE ==================
    const serverMessage =
        nestedError.message ||
        details.message ||
        (
            typeof details.error === "string"
                ? details.error
                : null
        );

    const message =
        typeof serverMessage === "string" &&
        serverMessage.trim()
            ? serverMessage.trim()
            : fallback;

    // ================== ERROR CODE ==================
    const providedCode =
        nestedError.code ||
        details.code ||
        null;

    const code =
        typeof providedCode === "string" &&
        providedCode.trim()
            ? providedCode.trim().toUpperCase()
            : null;

    // ================== HTTP STATUS ==================
    const providedStatus =
        nestedError.status ??
        details.status ??
        httpStatus;

    const numericStatus = Number(providedStatus);

    const status =
        Number.isInteger(numericStatus) &&
        numericStatus >= 400 &&
        numericStatus <= 599
            ? numericStatus
            : null;

    // ================== RETRY DURATION ==================
    const retryAfterSeconds = parseRetryAfter(
        nestedError.retryAfterSeconds ??
        details.retryAfterSeconds ??
        nestedError.retryAfter ??
        details.retryAfter ??
        retryAfter
    );

    // ================== CREATE ERROR ==================
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

            ...(retryAfterSeconds
                ? { retryAfterSeconds }
                : {}),
        },

        headers: retryAfterSeconds
            ? {
                "retry-after":
                    String(retryAfterSeconds),
            }
            : {},
    };

    return error;
}

// ================== PROCESS SSE EVENT ==================
function processStreamEvent(block, onEvent) {
    let eventType = "message";

    const dataLines = [];

    // ================== READ SSE FIELDS ==================
    for (const line of block.split(/\r?\n/)) {
        if (
            !line ||
            line.startsWith(":")
        ) {
            continue;
        }

        if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();

        } else if (line.startsWith("data:")) {
            dataLines.push(
                line.slice(5).trimStart()
            );
        }
    }

    if (!dataLines.length) {
        return false;
    }

    // ================== PARSE EVENT DATA ==================
    let data;

    try {
        data = JSON.parse(
            dataLines.join("\n")
        );

    } catch {
        throw createAIError(
            {
                code: "INVALID_STREAM_RESPONSE",
            },
            {
                fallback:
                    "The AI response was interrupted. Please try again.",
            }
        );
    }

    // ================== SERVER ERROR EVENT ==================
    if (eventType === "error") {
        throw createAIError(data, {
            fallback:
                "AI generation failed. Please try again.",
        });
    }

    // ================== FORWARD NORMAL EVENT ==================
    onEvent?.({
        type: eventType,
        data,
    });

    return eventType === "done";
}

// ================== GENERATE AI STREAM ==================
async function generateAIResponse(
    conversationId,
    messageId,
    {
        regenerate = false,
        signal,
        onEvent,
    } = {}
) {
    // ================== VALIDATE IDS ==================
    const validConversationId = validateMessageId(
        conversationId,
        "Conversation ID"
    );

    const validMessageId = validateMessageId(
        messageId,
        "Message ID"
    );

    // ================== API BASE URL ==================
    const baseURL =
        api.defaults.baseURL?.replace(/\/$/, "");

    if (!baseURL) {
        throw new Error(
            "API base URL is not configured."
        );
    }

    // ================== SEND STREAM REQUEST ==================
    const response = await fetch(
        `${baseURL}/chats/${validConversationId}/generate`,
        {
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
        }
    );

    // ================== HTTP ERROR ==================
    if (!response.ok) {
        const errorData = await response
            .json()
            .catch(() => null);

        throw createAIError(errorData, {
            httpStatus: response.status,

            retryAfter:
                response.headers.get(
                    "Retry-After"
                ),

            fallback:
                `AI request failed (${response.status}).`,
        });
    }

    // ================== STREAM AVAILABILITY ==================
    if (!response.body) {
        throw createAIError(
            {
                code: "STREAM_UNAVAILABLE",
            },
            {
                fallback:
                    "The AI response could not be started. Please try again.",
            }
        );
    }

    // ================== STREAM READER ==================
    const reader =
        response.body.getReader();

    const decoder =
        new TextDecoder();

    let buffer = "";
    let completed = false;

    try {
        // ================== READ STREAM ==================
        while (!completed) {
            const {
                done,
                value,
            } = await reader.read();

            if (done) {
                break;
            }

            buffer += decoder.decode(value, {
                stream: true,
            });

            // ================== PROCESS COMPLETE EVENTS ==================
            let boundary = /\r?\n\r?\n/.exec(buffer);

            while (boundary) {
                const block = buffer.slice(
                    0,
                    boundary.index
                );

                buffer = buffer.slice(
                    boundary.index +
                    boundary[0].length
                );

                if (
                    processStreamEvent(
                        block,
                        onEvent
                    )
                ) {
                    completed = true;
                    break;
                }

                boundary =
                    /\r?\n\r?\n/.exec(buffer);
            }

            // ================== STREAM SIZE PROTECTION ==================
            if (
                buffer.length >
                1024 * 1024
            ) {
                throw createAIError(
                    {
                        code:
                            "STREAM_EVENT_TOO_LARGE",
                    },
                    {
                        fallback:
                            "The AI response was interrupted. Please try again.",
                    }
                );
            }
        }

        // ================== PROCESS FINAL BUFFER ==================
        if (!completed) {
            buffer += decoder.decode();

            if (buffer.trim()) {
                completed = processStreamEvent(
                    buffer.trim(),
                    onEvent
                );
            }
        }

        // ================== INCOMPLETE STREAM ==================
        if (!completed) {
            throw createAIError(
                {
                    code:
                        "STREAM_INTERRUPTED",
                },
                {
                    fallback:
                        "The AI response was interrupted. Please try again.",
                }
            );
        }

    } finally {
        // ================== RELEASE STREAM ==================
        if (!completed) {
            await reader
                .cancel()
                .catch(() => {});
        }

        reader.releaseLock();
    }
}

// ================== EXPORTS ==================
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
