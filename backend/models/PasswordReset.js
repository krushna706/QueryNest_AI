const mongoose = require("mongoose");

const { Schema } = mongoose;

// Password reset schema
const passwordResetSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },

        // Email otp
        otpHash: {
            type: String,
            default: null,
            match: /^[a-f0-9]{64}$/,
            select: false,
        },

        otpExpiresAt: {
            type: Date,
            default: null,
        },

        failedAttempts: {
            type: Number,
            default: 0,
            min: 0,
            max: 5,
        },

        // Request limits
        resendAvailableAt: {
            type: Date,
            default: null,
        },

        requestWindowStartedAt: {
            type: Date,
            default: null,
        },

        requestsInWindow: {
            type: Number,
            default: 0,
            min: 0,
            max: 10,
        },

        // Reset verification
        verificationTokenHash: {
            type: String,
            default: null,
            match: /^[a-f0-9]{64}$/,
            select: false,
        },

        verificationExpiresAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,

        toJSON: {
            transform: function (doc, result) {
                delete result.otpHash;
                delete result.verificationTokenHash;
                delete result.__v;

                return result;
            },
        },
    }
);

// Ttl index
passwordResetSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 86400 });

// Model
const PasswordReset = mongoose.model("PasswordReset", passwordResetSchema);

// Export
module.exports = PasswordReset;
