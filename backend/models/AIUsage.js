
const mongoose = require("mongoose");

const { Schema } = mongoose;

// ================== USAGE CONSTANTS ==================
const AI_PROVIDERS = ["groq", "gemini"];

const ATTEMPT_STATUSES = [
    "reserved",
    "streaming",
    "completed",
    "stopped",
    "incomplete",
    "failed",
    "cancelled",
];

const USAGE_METRICS = [
    "requestsPerMinute",
    "requestsPerDay",
    "tokensPerMinute",
    "inputTokensPerMinute",
    "tokensPerDay",
];

// ================== NON-NEGATIVE INTEGER ==================
const isValidCount = (value) =>
    value == null ||
    (Number.isSafeInteger(value) && value >= 0);

// ================== AI REQUEST ATTEMPT ==================
// One record per provider request, including fallback and embedding calls.
// No prompt text, document text or conversation content is stored.
const aiUsageSchema = new Schema(
    {
        // ================== REQUEST IDENTITY ==================
        attemptKey: {
            type: String,
            required: true,
            unique: true,
            immutable: true,
            trim: true,
            maxlength: 128,
        },

        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            immutable: true,
        },

        // ================== PROVIDER DETAILS ==================
        provider: {
            type: String,
            enum: AI_PROVIDERS,
            required: true,
            immutable: true,
        },

        model: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
            immutable: true,
        },

        operation: {
            type: String,
            enum: ["chat", "embedding", "summary", "other"],
            default: "chat",
            required: true,
            immutable: true,
        },

        task: {
            type: String,
            trim: true,
            maxlength: 60,
            default: null,
        },

        // ================== REQUEST STATUS ==================
        status: {
            type: String,
            enum: ATTEMPT_STATUSES,
            default: "reserved",
            required: true,
        },

        // ================== RESERVED TOKEN BUDGET ==================
        estimatedInputTokens: {
            type: Number,
            required: true,
            min: 0,
            validate: isValidCount,
        },

        reservedOutputTokens: {
            type: Number,
            required: true,
            min: 0,
            validate: isValidCount,
        },

        reservedTotalTokens: {
            type: Number,
            required: true,
            min: 0,
            validate: isValidCount,
        },

        // ================== ACTUAL TOKEN USAGE ==================
        actualInputTokens: {
            type: Number,
            default: null,
            min: 0,
            validate: isValidCount,
        },

        actualOutputTokens: {
            type: Number,
            default: null,
            min: 0,
            validate: isValidCount,
        },

        actualTotalTokens: {
            type: Number,
            default: null,
            min: 0,
            validate: isValidCount,
        },

        usageSource: {
            type: String,
            enum: ["unavailable", "reported", "estimated"],
            default: "unavailable",
        },

        // ================== RECOVERY METADATA ==================
        leaseExpiresAt: {
            type: Date,
            default: null,
        },

        startedAt: {
            type: Date,
            default: null,
        },

        finishedAt: {
            type: Date,
            default: null,
        },

        errorCode: {
            type: String,
            trim: true,
            maxlength: 80,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// ================== ATTEMPT INDEXES ==================
aiUsageSchema.index({ userId: 1, createdAt: -1 });
aiUsageSchema.index({ provider: 1, createdAt: -1 });
aiUsageSchema.index({ status: 1, leaseExpiresAt: 1 });

// ================== QUOTA COUNTER ==================
// One counter per scope, metric and time window.
// Atomic reservation and reconciliation will be implemented
// in the usage service, not in this schema.
const aiUsageCounterSchema = new Schema(
    {
        scope: {
            type: String,
            enum: ["user", "provider"],
            required: true,
            immutable: true,
        },

        // User scope: String(userId). Provider scope: provider budget key.
        scopeId: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
            immutable: true,
        },

        metric: {
            type: String,
            enum: USAGE_METRICS,
            required: true,
            immutable: true,
        },

        windowStart: {
            type: Date,
            required: true,
            immutable: true,
        },

        windowEnd: {
            type: Date,
            required: true,
            immutable: true,
        },

        used: {
            type: Number,
            default: 0,
            min: 0,
            validate: isValidCount,
        },

        reserved: {
            type: Number,
            default: 0,
            min: 0,
            validate: isValidCount,
        },

        // Set by the usage service after the retention period.
        expiresAt: {
            type: Date,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// ================== COUNTER INDEXES ==================
aiUsageCounterSchema.index(
    {
        scope: 1,
        scopeId: 1,
        metric: 1,
        windowStart: 1,
    },
    {
        unique: true,
    }
);

// ================== COUNTER EXPIRATION ==================
aiUsageCounterSchema.index(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
);

// ================== MODELS ==================
const AIUsage = mongoose.model(
    "AIUsage",
    aiUsageSchema
);

const AIUsageCounter = mongoose.model(
    "AIUsageCounter",
    aiUsageCounterSchema
);

// ================== EXPORTS ==================
module.exports = {
    AIUsage,
    AIUsageCounter,
};
