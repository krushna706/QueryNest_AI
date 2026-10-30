
const mongoose = require("mongoose");

const { Schema } = mongoose;

// ================== CONVERSATION SCHEMA ==================
const conversationSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            immutable: true,
        },

        // ================== CONVERSATION DETAILS ==================
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
            default: "New Chat",
        },

        status: {
            type: String,
            enum: ["active", "deleting"],
            default: "active",
            required: true,
        },

        lastActivityAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true,
        optimisticConcurrency: true,
    }
);

// ================== DATABASE INDEXES ==================
conversationSchema.index({
    userId: 1,
    status: 1,
    lastActivityAt: -1,
    _id: -1,
});

// ================== MODEL ==================
const Conversation = mongoose.model(
    "Conversation",
    conversationSchema
);

// ================== EXPORT ==================
module.exports = Conversation;
