
const mongoose = require("mongoose");

const { Schema } = mongoose;

// ================== MESSAGE STATUSES ==================
const MESSAGE_STATUSES = [
    "queued",
    "streaming",
    "completed",
    "stopped",
    "incomplete",
    "failed",
];

// ================== MESSAGE SOURCES ==================
const sourceSchema = new Schema(
    {
        documentId: {
            type: Schema.Types.ObjectId,
            ref: "Document",
            required: true,
        },

        chunkId: {
            type: Schema.Types.ObjectId,
            ref: "DocumentChunk",
            required: true,
        },

        filename: {
            type: String,
            required: true,
            trim: true,
            maxlength: 255,
        },

        pageNumber: {
            type: Number,
            required: true,
            min: 1,
        },
    },
    {
        _id: false,
    }
);

// ================== MESSAGE SCHEMA ==================
const messageSchema = new Schema(
    {
        // ================== MESSAGE OWNER ==================
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            immutable: true,
        },

        conversationId: {
            type: Schema.Types.ObjectId,
            ref: "Conversation",
            required: true,
            immutable: true,
        },

        // ================== MESSAGE DETAILS ==================
        role: {
            type: String,
            enum: ["user", "assistant"],
            required: true,
            immutable: true,
        },

        content: {
            type: String,
            default: "",
            maxlength: 100000,
        },

        status: {
            type: String,
            enum: MESSAGE_STATUSES,
            default: "completed",
            required: true,
        },

        // ================== RESPONSE ATTEMPTS ==================
        replyToMessageId: {
            type: Schema.Types.ObjectId,
            ref: "Message",
            default: null,
        },

        attemptNumber: {
            type: Number,
            default: 1,
            min: 1,
        },

        clientRequestId: {
            type: String,
            trim: true,
            maxlength: 100,
            default: null,
        },

        // ================== AI PROVIDER ==================
        provider: {
            type: String,
            enum: ["groq", "gemini", null],
            default: null,
        },

        model: {
            type: String,
            trim: true,
            maxlength: 120,
            default: null,
        },

        // ================== DOCUMENT REFERENCES ==================
        attachmentIds: {
            type: [
                {
                    type: Schema.Types.ObjectId,
                    ref: "Document",
                },
            ],
            default: [],
        },

        sources: {
            type: [sourceSchema],
            default: [],
        },
    },
    {
        timestamps: true,
    }
);

// ================== DATABASE INDEXES ==================
messageSchema.index({
    userId: 1,
    conversationId: 1,
    createdAt: 1,
    _id: 1,
});

messageSchema.index({
    conversationId: 1,
    replyToMessageId: 1,
    attemptNumber: -1,
});

messageSchema.index(
    {
        conversationId: 1,
        clientRequestId: 1,
    },
    {
        unique: true,
        partialFilterExpression: {
            role: "user",
            clientRequestId: { $type: "string" },
        },
    }
);

// ================== MODEL ==================
const Message = mongoose.model("Message", messageSchema);

// ================== EXPORT ==================
module.exports = Message;
