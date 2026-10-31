
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

        citationId: {
            type: String,
            trim: true,
            maxlength: 20,
            default: null,
        },

        filename: {
            type: String,
            required: true,
            trim: true,
            maxlength: 255,
        },

        // ================== FILE TYPE ==================
        fileType: {
            type: String,
            enum: ["pdf", "docx"],
            default: "pdf",
            required: true,
        },

        label: {
            type: String,
            trim: true,
            maxlength: 400,
            default: null,
        },

        // ================== PDF PAGE REFERENCE ==================
        pageNumber: {
            type: Number,
            min: 1,
            default: null,
            required() {
                return this.fileType === "pdf";
            },
            validate: {
                validator(value) {
                    return value == null || Number.isSafeInteger(value);
                },
                message: "Page number must be a positive integer.",
            },
        },

        // ================== DOCX SECTION REFERENCE ==================
        sectionTitle: {
            type: String,
            trim: true,
            maxlength: 250,
            default: null,
        },

        paragraphStart: {
            type: Number,
            min: 1,
            default: null,
            validate: {
                validator(value) {
                    return value == null || Number.isSafeInteger(value);
                },
                message: "Paragraph start must be an integer.",
            },
        },

        paragraphEnd: {
            type: Number,
            min: 1,
            default: null,
            validate: {
                validator(value) {
                    return value == null || Number.isSafeInteger(value);
                },
                message: "Paragraph end must be an integer.",
            },
        },

        // ================== SOURCE EXCERPT ==================
        text: {
            type: String,
            default: "",
            maxlength: 8000,
        },

        // ================== RETRIEVAL SCORE ==================
        score: {
            type: Number,
            min: 0,
            max: 1,
            default: null,
        },
    },
    {
        _id: false,
    }
);

// ================== SOURCE VALIDATION ==================
sourceSchema.pre("validate", function () {
    if (
        this.fileType === "docx" &&
        this.pageNumber != null
    ) {
        this.invalidate(
            "pageNumber",
            "DOCX citations cannot use PDF page numbers."
        );
    }

    if (
        (this.paragraphStart == null) !==
        (this.paragraphEnd == null)
    ) {
        this.invalidate(
            "paragraphEnd",
            "Both paragraph boundaries are required together."
        );
    }

    if (
        this.paragraphStart != null &&
        this.paragraphEnd != null &&
        this.paragraphEnd < this.paragraphStart
    ) {
        this.invalidate(
            "paragraphEnd",
            "Paragraph end cannot precede paragraph start."
        );
    }

    if (
        this.fileType === "pdf" &&
        (
            this.paragraphStart != null ||
            this.paragraphEnd != null
        )
    ) {
        this.invalidate(
            "paragraphStart",
            "PDF citations must use page references."
        );
    }
});

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

        // ================== DOCUMENT ATTACHMENTS ==================
        attachmentIds: {
            type: [
                {
                    type: Schema.Types.ObjectId,
                    ref: "Document",
                },
            ],
            default: [],
        },

        // ================== DOCUMENT CITATIONS ==================
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
            clientRequestId: {
                $type: "string",
            },
        },
    }
);

// ================== MODEL ==================
const Message = mongoose.model(
    "Message",
    messageSchema
);

// ================== EXPORT ==================
module.exports = Message;
