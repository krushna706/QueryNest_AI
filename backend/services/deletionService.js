
const mongoose = require("mongoose");

const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Document = require("../models/Document");
const DocumentChunk = require("../models/DocumentChunk");
const { AIUsage } = require("../models/AIUsage");

const ExpressError = require("../utils/ExpressError");

// ================== LOCAL DELETE GUARD ==================
// Prevent overlapping Clear All calls in this Node.js process.
const deletingUsers = new Set();

// ================== CHECK ACTIVE WORK ==================
async function assertNoActiveWork(userId, session) {
    // ================== ACTIVE CHAT GENERATION ==================
    const activeMessage = await Message.exists({
        userId,
        role: "assistant",
        status: {
            $in: ["queued", "streaming"],
        },
    }).session(session);

    if (activeMessage) {
        throw new ExpressError(
            409,
            "Stop the active AI response before clearing chat history."
        );
    }

    // ================== DOCUMENT PROCESSING ==================
    const processingDocument = await Document.exists({
        userId,
        status: {
            $in: ["uploaded", "processing"],
        },
    }).session(session);

    if (processingDocument) {
        throw new ExpressError(
            409,
            "Wait for document processing to finish before clearing chat history."
        );
    }

    // ================== ACTIVE PROVIDER ATTEMPTS ==================
    // Catch pending Groq/Gemini operations, including embeddings,
    // when their current reservation lease is still valid.
    const activeProvider = await AIUsage.exists({
        userId,
        status: {
            $in: ["reserved", "streaming"],
        },
        leaseExpiresAt: {
            $gt: new Date(),
        },
    }).session(session);

    if (activeProvider) {
        throw new ExpressError(
            409,
            "An AI request is still running. Please try again after it finishes."
        );
    }
}

// ================== CLEAR ALL CHAT HISTORY ==================
async function deleteAllUserChats(userId) {
    // ================== VALIDATE USER ==================
    if (!mongoose.isValidObjectId(userId)) {
        throw new ExpressError(
            400,
            "Invalid user ID."
        );
    }

    const userKey = String(userId);

    // ================== PREVENT DUPLICATE DELETION ==================
    if (deletingUsers.has(userKey)) {
        throw new ExpressError(
            409,
            "Chat history deletion is already in progress."
        );
    }

    deletingUsers.add(userKey);

    try {
        // ================== DATABASE TRANSACTION ==================
        return await mongoose.connection.transaction(
            async (session) => {
                // ================== BLOCK EXISTING CHAT WRITES ==================
                // Rollback restores these statuses when a guard fails.
                await Conversation.updateMany(
                    {
                        userId,
                        status: "active",
                    },
                    {
                        $set: {
                            status: "deleting",
                        },
                    },
                    {
                        session,
                    }
                );

                // ================== VERIFY ACTIVE OPERATIONS ==================
                await assertNoActiveWork(
                    userId,
                    session
                );

                // ================== DELETE VECTOR CHUNKS ==================
                const chunks = await DocumentChunk.deleteMany(
                    {
                        userId,
                    },
                    {
                        session,
                    }
                );

                // ================== DELETE DOCUMENTS ==================
                const documents = await Document.deleteMany(
                    {
                        userId,
                    },
                    {
                        session,
                    }
                );

                // ================== DELETE MESSAGES ==================
                const messages = await Message.deleteMany(
                    {
                        userId,
                    },
                    {
                        session,
                    }
                );

                // ================== DELETE CONVERSATIONS ==================
                const conversations = await Conversation.deleteMany(
                    {
                        userId,
                    },
                    {
                        session,
                    }
                );

                // ================== DELETION RESULT ==================
                return {
                    conversations: conversations.deletedCount,
                    messages: messages.deletedCount,
                    documents: documents.deletedCount,
                    chunks: chunks.deletedCount,
                };
            }
        );
    } finally {
        // ================== RELEASE LOCAL DELETE GUARD ==================
        deletingUsers.delete(userKey);
    }
}

// ================== EXPORTS ==================
module.exports = {
    deleteAllUserChats,
};
