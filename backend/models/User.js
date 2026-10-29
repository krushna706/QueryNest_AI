
const mongoose = require("mongoose");

const { Schema } = mongoose;

// ================== USER SCHEMA ==================
const userSchema = new Schema(
    {
        // ================== BASIC DETAILS ==================
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

        // ================== AUTHENTICATION ==================
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

        // ================== PROFILE IMAGE ==================
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

        // ================== ACCOUNT ACTIVITY ==================
        lastLoginAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        optimisticConcurrency: true,

        // ================== SAFE JSON RESPONSE ==================
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

// ================== MODEL ==================
const User = mongoose.model("User", userSchema);

// ================== EXPORT ==================
module.exports = User;
