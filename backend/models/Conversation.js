const mongoose = require("mongoose");

const { Schema } = mongoose;

// Conversation schema
const conversationSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            immutable: true,
        },

        // Conversation details
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

// Database indexes
conversationSchema.index({
    userId: 1,
    status: 1,
    lastActivityAt: -1,
    _id: -1,
});

// Model
const Conversation = mongoose.model("Conversation", conversationSchema);

// Export
module.exports = Conversation;
