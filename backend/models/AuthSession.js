const mongoose = require("mongoose");

const { Schema } = mongoose;

// Auth session schema
const authSessionSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        tokenHash: {
            type: String,
            required: true,
            unique: true,
            select: false,
            match: /^[a-f0-9]{64}$/,
        },

        expiresAt: {
            type: Date,
            required: true,
        },

        revokedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Session indexes
authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

authSessionSchema.index({
    userId: 1,
    revokedAt: 1,
});

// Model
const AuthSession = mongoose.model("AuthSession", authSessionSchema);

// Export
module.exports = AuthSession;
