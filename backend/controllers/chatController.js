
const mongoose = require("mongoose");
const { randomUUID } = require("node:crypto");

const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const ExpressError = require("../utils/ExpressError");

const { identifyTask } = require("../services/ai/taskRouter");
const { buildAIContext } = require("../services/ai/contextBuilder");
const { streamAIResponse } = require("../services/ai/aiRouter");
const { scheduleAIRequest } = require("../services/usage/requestScheduler");

const {
    getCurrentProviderBudgets,
    reserveAIUsage,
    startAIUsage,
    finalizeAIUsage,
    cancelReservedAIUsage,
} = require("../services/usage/usageService");

const { createStreamResponse } = require("../utils/streamResponse");
const { APP_USAGE_LIMITS } = require("../config/usageLimits");

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
            return next(
                new ExpressError(404, "Conversation not found.")
            );
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
                    throw new ExpressError(
                        404,
                        "Conversation not found."
                    );
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
                return next(
                    new ExpressError(400, "Invalid message cursor.")
                );
            }

            filter.$or = [
                {
                    createdAt: {
                        $lt: previousMessage.createdAt,
                    },
                },
                {
                    createdAt: previousMessage.createdAt,
                    _id: {
                        $lt: previousMessage._id,
                    },
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
                throw new ExpressError(
                    404,
                    "Conversation not found."
                );
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

// ================== GENERATE AI RESPONSE ==================
// POST /api/chats/:conversationId/generate
async function generateAIResponse(req, res, next) {
    try {
        const userId = req.user._id;
        const conversationId = req.conversation._id;
        const messageId = req.body?.messageId;
        const regenerate = req.body?.regenerate === true;

        // ================== VALIDATE MESSAGE ID ==================
        if (!mongoose.isValidObjectId(messageId)) {
            throw new ExpressError(
                400,
                "Invalid user message ID."
            );
        }

        // ================== FETCH SAVED MESSAGE ==================
        const userMessage = await Message.findOne({
            _id: messageId,
            userId,
            conversationId,
            role: "user",
            status: "completed",
        }).lean();

        if (!userMessage) {
            throw new ExpressError(
                404,
                "User message not found."
            );
        }

        // ================== LATEST USER MESSAGE ==================
        const latestUserMessage = await Message.findOne({
            userId,
            conversationId,
            role: "user",
        })
            .sort({
                createdAt: -1,
                _id: -1,
            })
            .select("_id")
            .lean();

        if (
            String(latestUserMessage?._id) !==
            String(messageId)
        ) {
            throw new ExpressError(
                409,
                "Generate a reply for the latest message."
            );
        }

        // ================== DOCUMENT SUPPORT ==================
        // Document retrieval will be integrated separately.
        if (userMessage.attachmentIds?.length) {
            throw new ExpressError(
                409,
                "Document processing is not available yet."
            );
        }

        // ================== IDENTIFY TASK ==================
        const taskResult = identifyTask({
            message: userMessage.content,
            hasDocuments: false,
            hasSourceText: false,
        });

        if (taskResult.needsClarification) {
            throw new ExpressError(
                422,
                taskResult.clarification
            );
        }

        // ================== BUILD AI CONTEXT ==================
        const context = await buildAIContext({
            userId,
            conversationId,
            currentMessageId: messageId,
            task: taskResult.task,
            documentChunks: [],
            maxInputTokens: 5000,
        });

        // ================== CENTRALIZED OUTPUT LIMIT ==================
        const maxOutputTokens =
            APP_USAGE_LIMITS.maxOutputTokensPerRequest;

        const stream = createStreamResponse(req, res);

        // ================== PER-REQUEST STATE ==================
        let assistantMessage = null;
        let attemptKey = null;
        let attemptUsage = null;
        let usageSettled = false;

        let content = "";
        let selectedProvider = null;
        let selectedModel = null;
        let finishReason = "unknown";
        let lastCheckpoint = Date.now();

        // ================== SAVE ANSWER PROGRESS ==================
        async function persistAnswer(status) {
            if (!assistantMessage) return;

            const saved = await Message.updateOne(
                {
                    _id: assistantMessage._id,
                    userId,
                    conversationId,
                    role: "assistant",
                },
                {
                    $set: {
                        content,
                        status,
                        provider: selectedProvider,
                        model: selectedModel,
                    },
                }
            );

            if (saved.matchedCount !== 1) {
                throw new ExpressError(
                    404,
                    "Conversation is no longer available."
                );
            }

            lastCheckpoint = Date.now();
        }

        // ================== SETTLE CURRENT PROVIDER ==================
        async function settleProvider(status) {
            if (!attemptKey || usageSettled) {
                return;
            }

            await finalizeAIUsage({
                attemptKey,
                status,
                usage: attemptUsage,
            });

            usageSettled = true;
        }

        // ================== RESERVE PROVIDER QUOTA ==================
        async function reserveProvider({
            provider,
            estimatedInputTokens,
            maxOutputTokens: outputTokens,
        }) {
            // Finalize the previous failed provider before fallback.
            if (attemptKey && !usageSettled) {
                await settleProvider("failed");
            }

            attemptKey = null;
            attemptUsage = null;
            usageSettled = false;

            const key = randomUUID();

            const reservation = await reserveAIUsage({
                attemptKey: key,
                userId,
                provider,
                task: taskResult.task,
                estimatedInputTokens,
                maxOutputTokens: outputTokens,
            });

            if (!reservation.allowed) {
                return {
                    allowed: false,
                };
            }

            try {
                await startAIUsage({
                    attemptKey: key,
                });
            } catch (error) {
                await cancelReservedAIUsage({
                    attemptKey: key,
                });

                throw error;
            }

            attemptKey = key;

            return {
                allowed: true,
            };
        }

        // ================== GENERATE IN EXECUTION SLOT ==================
        async function executeGeneration() {

            // ================== RECHECK LATEST MESSAGE ==================
            const latestSavedUser = await Message.findOne({
                userId,
                conversationId,
                role: "user",
            })
                .sort({
                    createdAt: -1,
                    _id: -1,
                })
                .select("_id")
                .lean();

            if (
                String(latestSavedUser?._id) !==
                String(messageId)
            ) {
                throw new ExpressError(
                    409,
                    "Generate a reply for the latest message."
                );
            }

            // ================== CREATE RESPONSE ATOMICALLY ==================
            await mongoose.connection.transaction(
                async (session) => {
                    const activeConversation =
                        await Conversation.findOneAndUpdate(
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

                    if (!activeConversation) {
                        throw new ExpressError(
                            404,
                            "Conversation not found."
                        );
                    }

                    // ================== CHECK PREVIOUS ATTEMPT ==================
                    const latestResponse = await Message.findOne({
                        userId,
                        conversationId,
                        role: "assistant",
                        replyToMessageId: messageId,
                    })
                        .sort({
                            attemptNumber: -1,
                            _id: -1,
                        })
                        .session(session)
                        .lean();

                    if (
                        ["queued", "streaming"].includes(
                            latestResponse?.status
                        )
                    ) {
                        throw new ExpressError(
                            409,
                            "An AI response is already in progress."
                        );
                    }

                    // ================== REGENERATE RULE ==================
                    if (regenerate) {
                        if (
                            latestResponse?.status !==
                            "completed"
                        ) {
                            throw new ExpressError(
                                409,
                                "Only a completed AI response can be regenerated. Use Retry for an incomplete response."
                            );
                        }
                    } else if (
                        latestResponse?.status === "completed"
                    ) {
                        throw new ExpressError(
                            409,
                            "An AI response already exists. Use Regenerate to create a new version."
                        );
                    }

                    // ================== CREATE RESPONSE VERSION ==================
                    const [created] = await Message.create(
                        [{
                            userId,
                            conversationId,
                            role: "assistant",
                            replyToMessageId: messageId,
                            attemptNumber:
                                (latestResponse?.attemptNumber || 0) + 1,
                            content: "",
                            status: "queued",
                        }],
                        { session }
                    );

                    assistantMessage = created;
                }
            );

            try {
                // ================== START STREAM ==================
                await stream.send("start", {
                    messageId: String(assistantMessage._id),
                    replyToMessageId: String(messageId),
                });

                // ================== CURRENT PROVIDER BUDGET ==================
                // Read quota after the request enters its execution slot.
                // The reservation transaction remains the final check.
                const providerBudgets =
                    await getCurrentProviderBudgets();

                // ================== ROUTE AI REQUEST ==================
                const events = streamAIResponse({
                    task: taskResult.task,
                    messages: context.messages,
                    systemInstruction: context.systemInstruction,
                    estimatedInputTokens:
                        context.estimatedInputTokens,
                    maxOutputTokens,
                    providerBudgets,
                    reserveProvider,
                    signal: stream.signal,
                });

                // ================== PROCESS STREAM EVENTS ==================
                for await (const event of events) {
                    if (stream.signal.aborted) {
                        throw new Error(
                            "Generation stopped."
                        );
                    }

                    // ================== PROVIDER SELECTED ==================
                    if (event.type === "provider") {
                        selectedProvider = event.provider;
                        selectedModel = event.model;

                        await persistAnswer("streaming");

                        await stream.send("provider", {
                            provider: selectedProvider,
                            model: selectedModel,
                        });

                    // ================== RESPONSE DELTA ==================
                    } else if (event.type === "delta") {
                        if (
                            content.length + event.text.length >
                            100000
                        ) {
                            throw new ExpressError(
                                413,
                                "AI answer exceeds the message limit."
                            );
                        }

                        content += event.text;

                        // Periodic DB checkpoints during streaming.
                        if (
                            content.length % 1000 <
                                event.text.length ||
                            Date.now() - lastCheckpoint >= 2000
                        ) {
                            await persistAnswer(
                                "streaming"
                            );
                        }

                        await stream.send("delta", {
                            text: event.text,
                        });

                    // ================== TOKEN USAGE ==================
                    } else if (event.type === "usage") {
                        attemptUsage = {
                            inputTokens: event.inputTokens,
                            outputTokens: event.outputTokens,
                            totalTokens: event.totalTokens,
                        };

                    // ================== FINISH REASON ==================
                    } else if (event.type === "finish") {
                        finishReason = event.reason;
                    }
                }

                // ================== CHECK ACTIVE CONVERSATION ==================
                const stillActive =
                    await Conversation.exists({
                        _id: conversationId,
                        userId,
                        status: "active",
                    });

                if (!stillActive) {
                    throw new ExpressError(
                        404,
                        "Conversation not found."
                    );
                }

                // ================== FINAL RESPONSE STATUS ==================
                const completed =
                    Boolean(content.trim()) &&
                    finishReason === "stop";

                const finalStatus = completed
                    ? "completed"
                    : "incomplete";

                // ================== SAVE FINAL RESPONSE ==================
                await persistAnswer(finalStatus);

                // ================== FINALIZE TOKEN USAGE ==================
                await settleProvider(finalStatus);

                // ================== FINISH STREAM ==================
                await stream.send("done", {
                    messageId: String(assistantMessage._id),
                    status: finalStatus,
                    provider: selectedProvider,
                    model: selectedModel,
                    finishReason,
                });

            } catch (error) {
                // ================== FAILED OR STOPPED RESPONSE ==================
                const cancelled = stream.signal.aborted;

                const status = cancelled
                    ? "stopped"
                    : content.length
                        ? "incomplete"
                        : "failed";

                // Preserve partial content if the record still exists.
                try {
                    await persistAnswer(status);
                } catch {
                    // Conversation may have been deleted.
                }

                // Reconcile quota even when generation fails.
                try {
                    await settleProvider(status);
                } catch {
                    // Failed settlements require recovery handling.
                }

                throw error;
            }
        }

        // ================== SCHEDULE GENERATION ==================
        try {
            await scheduleAIRequest({
                userId,
                signal: stream.signal,

                onQueued: ({ position }) => {
                    stream.send("queued", {
                        position,
                    }).catch(() => {});
                },

                execute: executeGeneration,
            });
        } catch (error) {
            // ================== SEND SAFE ERROR ==================
            if (!stream.isClosed()) {
                const safeMessage =
                    error instanceof ExpressError
                        ? error.message
                        : "AI generation failed. Please try again.";

                try {
                    await stream.send("error", {
                        message: safeMessage,
                    });
                } catch {
                    // Client may already be disconnected.
                }
            }
        } finally {
            stream.end();
        }

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
    generateAIResponse,
};
