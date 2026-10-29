
const mongoose = require("mongoose");

const { Schema } = mongoose;

// ================== AUTH SESSION SCHEMA ==================
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

// ================== SESSION INDEXES ==================
authSessionSchema.index(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
);

authSessionSchema.index({
    userId: 1,
    revokedAt: 1,
});

// ================== MODEL ==================
const AuthSession = mongoose.model("AuthSession", authSessionSchema);

// ================== EXPORT ==================
module.exports = AuthSession;
