const mongoose = require("mongoose");

const { Schema } = mongoose;

// User schema
const userSchema = new Schema(
    {
        // Basic details
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
        },

        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            maxlength: 254,
            unique: true,
            immutable: true,
        },

        phone: {
            type: String,
            required: true,
            trim: true,
            match: /^[6-9]\d{9}$/,
            unique: true,
            immutable: true,
        },

        // Authentication
        passwordHash: {
            type: String,
            required: true,
            select: false,
            match: /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/,
        },

        role: {
            type: String,
            enum: ["user"],
            default: "user",
            required: true,
            immutable: true,
        },

        status: {
            type: String,
            enum: ["Active", "Inactive"],
            default: "Active",
            required: true,
        },

        tokenVersion: {
            type: Number,
            default: 0,
            min: 0,
            select: false,
            validate: {
                validator: Number.isSafeInteger,
                message: "Token version must be a safe integer.",
            },
        },

        passwordChangedAt: {
            type: Date,
            default: null,
            select: false,
        },

        // Profile image
        avatar: {
            url: {
                type: String,
                trim: true,
                default: "",
            },

            publicId: {
                type: String,
                trim: true,
                default: "",
                select: false,
            },
        },

        // Account activity
        lastLoginAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        optimisticConcurrency: true,

        // Safe json response
        toJSON: {
            transform: function (doc, result) {
                delete result.passwordHash;
                delete result.tokenVersion;
                delete result.passwordChangedAt;
                delete result.__v;

                if (result.avatar) {
                    delete result.avatar.publicId;
                }

                return result;
            },
        },
    }
);

// Model
const User = mongoose.model("User", userSchema);

// Export
module.exports = User;
