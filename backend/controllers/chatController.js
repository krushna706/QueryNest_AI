
const mongoose = require("mongoose");

const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const ExpressError = require("../utils/ExpressError");

// ================== CONVERSATION RESPONSE ==================
function getConversationResponse(conversation) {
    return {
        _id: conversation._id,
        title: conversation.title,
        status: conversation.status,
        lastActivityAt: conversation.lastActivityAt,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
    };
}

// ================== MESSAGE RESPONSE ==================
function getMessageResponse(message) {
    return {
        _id: message._id,
        conversationId: message.conversationId,
        role: message.role,
        content: message.content,
        status: message.status,
        replyToMessageId: message.replyToMessageId,
        attemptNumber: message.attemptNumber,
        clientRequestId: message.clientRequestId,
        provider: message.provider,
        model: message.model,
        attachmentIds: message.attachmentIds || [],
        sources: message.sources || [],
        createdAt: message.createdAt,
    };
}

// ================== CONVERSATION TITLE ==================
function generateTitle(content) {
    const title = content.replace(/\s+/g, " ").trim();

    return title.slice(0, 120) || "New Chat";
}

// ================== PAGINATION CURSOR ==================
function encodeCursor(conversation) {
    return Buffer.from(
        JSON.stringify({
            id: String(conversation._id),
            date: conversation.lastActivityAt.toISOString(),
        })
    ).toString("base64url");
}

function decodeCursor(cursor) {
    if (!cursor) return null;

    try {
        const value = JSON.parse(
            Buffer.from(cursor, "base64url").toString("utf8")
        );

        if (
            !/^[a-f0-9]{24}$/i.test(value.id) ||
            typeof value.date !== "string"
        ) {
            throw new Error("Invalid cursor.");
        }

        const date = new Date(value.date);

        if (!Number.isFinite(date.getTime())) {
            throw new Error("Invalid cursor date.");
        }

        return {
            id: new mongoose.Types.ObjectId(value.id),
            date,
        };
    } catch {
        throw new ExpressError(400, "Invalid pagination cursor.");
    }
}

// ================== CREATE CONVERSATION ==================
// POST /api/chats
async function createConversation(req, res, next) {
    try {
        const { content, clientRequestId } = req.body;
        const userId = req.user._id;

        let conversation;
        let message;

        await mongoose.connection.transaction(async (session) => {
            const [createdConversation] = await Conversation.create(
                [{
                    userId,
                    title: generateTitle(content),
                    lastActivityAt: new Date(),
                }],
                { session }
            );

            const [createdMessage] = await Message.create(
                [{
                    userId,
                    conversationId: createdConversation._id,
                    role: "user",
                    content,
                    status: "completed",
                    clientRequestId,
                }],
                { session }
            );

            conversation = createdConversation;
            message = createdMessage;
        });

        res.set("Cache-Control", "no-store");

        return res.status(201).json({
            success: true,
            message: "Conversation created successfully.",
            conversation: getConversationResponse(conversation),
            initialMessage: getMessageResponse(message),
        });
    } catch (error) {
        return next(error);
    }
}

// ================== CHAT HISTORY ==================
// GET /api/chats
async function getChatHistory(req, res, next) {
    try {
        const { search, cursor, limit } = req.validated.query;

        const filter = {
            userId: req.user._id,
            status: "active",
        };

        // ================== TITLE SEARCH ==================
        if (search) {
            const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

            filter.title = {
                $regex: escaped,
                $options: "i",
            };
        }

        // ================== CURSOR FILTER ==================
        const position = decodeCursor(cursor);

        if (position) {
            filter.$or = [
                {
                    lastActivityAt: { $lt: position.date },
                },
                {
                    lastActivityAt: position.date,
                    _id: { $lt: position.id },
                },
            ];
        }

        // ================== FETCH CONVERSATIONS ==================
        const conversations = await Conversation.find(filter)
            .sort({ lastActivityAt: -1, _id: -1 })
            .limit(limit + 1)
            .lean();

        const hasMore = conversations.length > limit;
        const results = conversations.slice(0, limit);

        const nextCursor = hasMore
            ? encodeCursor(results[results.length - 1])
            : null;

        res.set("Cache-Control", "no-store");

        return res.status(200).json({
            success: true,
            conversations: results.map(getConversationResponse),
            pagination: {
                hasMore,
                nextCursor,
            },
        });
    } catch (error) {
        return next(error);
    }
}

// ================== GET CONVERSATION ==================
// GET /api/chats/:conversationId
async function getConversation(req, res, next) {
    try {
        res.set("Cache-Control", "no-store");

        return res.status(200).json({
            success: true,
            conversation: getConversationResponse(req.conversation),
        });
    } catch (error) {
        return next(error);
    }
}

// ================== RENAME CONVERSATION ==================
// PATCH /api/chats/:conversationId
async function renameConversation(req, res, next) {
    try {
        const conversation = await Conversation.findOneAndUpdate(
            {
                _id: req.conversation._id,
                userId: req.user._id,
                status: "active",
            },
            {
                $set: {
                    title: req.body.title,
                },
            },
            {
                returnDocument: "after",
                runValidators: true,
            }
        );

        if (!conversation) {
            return next(new ExpressError(404, "Conversation not found."));
        }

        return res.status(200).json({
            success: true,
            message: "Conversation renamed successfully.",
            conversation: getConversationResponse(conversation),
        });
    } catch (error) {
        return next(error);
    }
}

// ================== ADD USER MESSAGE ==================
// POST /api/chats/:conversationId/messages
async function addUserMessage(req, res, next) {
    try {
        const { content, clientRequestId } = req.body;
        const conversationId = req.conversation._id;
        const userId = req.user._id;

        // ================== DUPLICATE REQUEST CHECK ==================
        const existingMessage = await Message.findOne({
            userId,
            conversationId,
            role: "user",
            clientRequestId,
        }).lean();

        if (existingMessage) {
            return res.status(200).json({
                success: true,
                message: "Message already exists.",
                userMessage: getMessageResponse(existingMessage),
            });
        }

        let savedMessage;

        try {
            await mongoose.connection.transaction(async (session) => {
                const conversation = await Conversation.findOneAndUpdate(
                    {
                        _id: conversationId,
                        userId,
                        status: "active",
                    },
                    {
                        $set: {
                            lastActivityAt: new Date(),
                        },
                    },
                    {
                        session,
                        returnDocument: "after",
                    }
                );

                if (!conversation) {
                    throw new ExpressError(404, "Conversation not found.");
                }

                const [createdMessage] = await Message.create(
                    [{
                        userId,
                        conversationId,
                        role: "user",
                        content,
                        status: "completed",
                        clientRequestId,
                    }],
                    { session }
                );

                savedMessage = createdMessage;
            });
        } catch (error) {
            if (error.code === 11000) {
                const duplicate = await Message.findOne({
                    userId,
                    conversationId,
                    role: "user",
                    clientRequestId,
                }).lean();

                if (duplicate) {
                    return res.status(200).json({
                        success: true,
                        message: "Message already exists.",
                        userMessage: getMessageResponse(duplicate),
                    });
                }
            }

            throw error;
        }

        res.set("Cache-Control", "no-store");

        return res.status(201).json({
            success: true,
            message: "Message saved successfully.",
            userMessage: getMessageResponse(savedMessage),
        });
    } catch (error) {
        return next(error);
    }
}

// ================== MESSAGE HISTORY ==================
// GET /api/chats/:conversationId/messages
async function getMessageHistory(req, res, next) {
    try {
        const { before, limit } = req.validated.query;

        const filter = {
            userId: req.user._id,
            conversationId: req.conversation._id,
        };

        // ================== OLDER MESSAGES ==================
        if (before) {
            const previousMessage = await Message.findOne({
                ...filter,
                _id: before,
            })
                .select("_id createdAt")
                .lean();

            if (!previousMessage) {
                return next(new ExpressError(400, "Invalid message cursor."));
            }

            filter.$or = [
                {
                    createdAt: { $lt: previousMessage.createdAt },
                },
                {
                    createdAt: previousMessage.createdAt,
                    _id: { $lt: previousMessage._id },
                },
            ];
        }

        // ================== FETCH MESSAGES ==================
        const messages = await Message.find(filter)
            .sort({ createdAt: -1, _id: -1 })
            .limit(limit + 1)
            .lean();

        const hasMore = messages.length > limit;
        const results = messages.slice(0, limit);

        const nextCursor = hasMore
            ? String(results[results.length - 1]._id)
            : null;

        res.set("Cache-Control", "no-store");

        return res.status(200).json({
            success: true,
            messages: results.reverse().map(getMessageResponse),
            pagination: {
                hasMore,
                nextCursor,
            },
        });
    } catch (error) {
        return next(error);
    }
}

// ================== DELETE CONVERSATION ==================
// DELETE /api/chats/:conversationId
async function deleteConversation(req, res, next) {
    try {
        const conversationId = req.conversation._id;
        const userId = req.user._id;

        await mongoose.connection.transaction(async (session) => {
            const conversation = await Conversation.findOneAndUpdate(
                {
                    _id: conversationId,
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
                    returnDocument: "after",
                }
            );

            if (!conversation) {
                throw new ExpressError(404, "Conversation not found.");
            }

            await Message.deleteMany(
                {
                    conversationId,
                    userId,
                },
                { session }
            );

            await Conversation.deleteOne(
                {
                    _id: conversationId,
                    userId,
                    status: "deleting",
                },
                { session }
            );
        });

        return res.status(200).json({
            success: true,
            message: "Conversation deleted successfully.",
        });
    } catch (error) {
        return next(error);
    }
}

// ================== EXPORTS ==================
module.exports = {
    createConversation,
    getChatHistory,
    getConversation,
    renameConversation,
    addUserMessage,
    getMessageHistory,
    deleteConversation,
};
