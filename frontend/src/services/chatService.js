
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
};
