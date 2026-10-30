
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

// ================== GET CONVERSATION ==================
async function getConversation(conversationId) {
    const { data } = await api.get(`/chats/${conversationId}`);

    return data;
}

// ================== RENAME CONVERSATION ==================
async function renameConversation(conversationId, title) {
    const { data } = await api.patch(`/chats/${conversationId}`, {
        title,
    });

    return data;
}

// ================== DELETE CONVERSATION ==================
async function deleteConversation(conversationId) {
    const { data } = await api.delete(`/chats/${conversationId}`);

    return data;
}

// ================== SEND USER MESSAGE ==================
async function sendMessage(conversationId, content, clientRequestId) {
    const { data } = await api.post(
        `/chats/${conversationId}/messages`,
        {
            content,
            clientRequestId,
        }
    );

    return data;
}

// ================== MESSAGE HISTORY ==================
async function getMessageHistory(conversationId, { before, limit = 20 } = {}) {
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

// ================== GENERATE AI RESPONSE (SSE) ==================
async function generateAIResponse(
    conversationId,
    messageId,
    { signal, onEvent, regenerate = false } = {}
) {
    // ================== VALIDATE INPUT ==================
    const objectIdPattern = /^[a-f\d]{24}$/i;

    if (
        !objectIdPattern.test(conversationId) ||
        !objectIdPattern.test(messageId)
    ) {
        throw new Error("Invalid conversation or message ID.");
    }

    if (onEvent != null && typeof onEvent !== "function") {
        throw new Error("AI event handler must be a function.");
    }

    // fetch() supports readable streaming.
    // Axios remains in use for existing chat APIs.
    const baseURL = api.defaults.baseURL?.replace(/\/+$/, "");

    if (!baseURL) {
        throw new Error("API URL is not configured.");
    }

    // ================== OPEN AI STREAM ==================
    const response = await fetch(
        `${baseURL}/chats/${conversationId}/generate`,
        {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
                Accept: "text/event-stream",
            },
            body: JSON.stringify({
                messageId,
                ...(regenerate ? { regenerate: true } : {}),
            }),
            signal,
            cache: "no-store",
        }
    );

    // ================== HANDLE HTTP ERRORS ==================
    if (!response.ok) {
        const errorBody = await response.json().catch(() => null);

        const error = new Error(
            errorBody?.message ||
            `Unable to generate AI response (HTTP ${response.status}).`
        );

        error.status = response.status;
        throw error;
    }

    if (!response.body) {
        throw new Error("AI streaming is not supported by this response.");
    }

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.toLowerCase().includes("text/event-stream")) {
        throw new Error("Server returned an invalid AI stream response.");
    }

    // ================== READ SSE CHUNKS ==================
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let eventType = "message";
    let eventData = [];
    let completed = false;
    let completion = null;

    // ================== DISPATCH SSE EVENT ==================
    async function dispatchEvent() {
        if (!eventData.length) {
            eventType = "message";
            return;
        }

        const rawData = eventData.join("\n");
        const type = eventType;

        eventType = "message";
        eventData = [];

        let data;

        try {
            data = JSON.parse(rawData);
        } catch {
            throw new Error("Received invalid AI stream data.");
        }

        // ================== AI ERROR ==================
        if (type === "error") {
            throw new Error(data?.message || "AI generation failed.");
        }

        // ================== AI COMPLETION ==================
        if (type === "done") {
            completed = true;
            completion = data;
        }

        // ================== FRONTEND CALLBACK ==================
        if (onEvent) {
            await onEvent({ type, data });
        }
    }

    // ================== PARSE SSE LINE ==================
    async function parseLine(line) {
        if (line.endsWith("\r")) {
            line = line.slice(0, -1);
        }

        if (line === "") {
            await dispatchEvent();
            return;
        }

        // Ignore SSE comments and heartbeat frames.
        if (line.startsWith(":")) return;

        const separator = line.indexOf(":");
        const field = separator < 0 ? line : line.slice(0, separator);

        let value = separator < 0
            ? ""
            : line.slice(separator + 1);

        if (value.startsWith(" ")) {
            value = value.slice(1);
        }

        if (field === "event") {
            eventType = value;
        }

        if (field === "data") {
            eventData.push(value);
        }
    }

    // ================== CONSUME AI STREAM ==================
    try {
        while (!completed) {
            const { done, value } = await reader.read();

            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            let newlineIndex;

            while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
                const line = buffer.slice(0, newlineIndex);

                buffer = buffer.slice(newlineIndex + 1);

                await parseLine(line);

                if (completed) break;
            }
        }

        // ================== INCOMPLETE RESPONSE ==================
        if (!completed) {
            throw new Error(
                "AI stream ended before completion. Refresh the conversation to check the saved response."
            );
        }

        return completion;

    } finally {
        // ================== STREAM CLEANUP ==================
        await reader.cancel().catch(() => {});
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
