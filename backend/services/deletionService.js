const mongoose = require("mongoose");

const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Document = require("../models/Document");
const DocumentChunk = require("../models/DocumentChunk");
const { AIUsage } = require("../models/AIUsage");

const ExpressError = require("../utils/ExpressError");

// Local delete guard
// Prevent overlapping Clear All calls in this Node.js process.
const deletingUsers = new Set();

// Check active work
async function assertNoActiveWork(userId, session) {
    const activeMessage = await Message.exists({
        userId,
        role: "assistant",
        status: {
            $in: ["queued", "streaming"],
        },
    }).session(session);

    if (activeMessage) {
        throw new ExpressError(409, "Stop the active AI response before clearing chat history.");
    }

    const processingDocument = await Document.exists({
        userId,
        status: {
            $in: ["uploaded", "processing"],
        },
    }).session(session);

    if (processingDocument) {
        throw new ExpressError(409, "Wait for document processing to finish before clearing chat history.");
    }

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
        throw new ExpressError(409, "An AI request is still running. Please try again after it finishes.");
    }
}

// Clear all chat history
async function deleteAllUserChats(userId) {
    if (!mongoose.isValidObjectId(userId)) {
        throw new ExpressError(400, "Invalid user ID.");
    }

    const userKey = String(userId);

    if (deletingUsers.has(userKey)) {
        throw new ExpressError(409, "Chat history deletion is already in progress.");
    }

    deletingUsers.add(userKey);

    try {
        return await mongoose.connection.transaction(async (session) => {
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

            await assertNoActiveWork(userId, session);

            const chunks = await DocumentChunk.deleteMany(
                {
                    userId,
                },
                {
                    session,
                }
            );

            const documents = await Document.deleteMany(
                {
                    userId,
                },
                {
                    session,
                }
            );

            const messages = await Message.deleteMany(
                {
                    userId,
                },
                {
                    session,
                }
            );

            const conversations = await Conversation.deleteMany(
                {
                    userId,
                },
                {
                    session,
                }
            );

            return {
                conversations: conversations.deletedCount,
                messages: messages.deletedCount,
                documents: documents.deletedCount,
                chunks: chunks.deletedCount,
            };
        });
    } finally {
        deletingUsers.delete(userKey);
    }
}

// Exports
module.exports = {
    deleteAllUserChats,
};
