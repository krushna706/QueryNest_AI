
const mongoose = require("mongoose");

const { Schema } = mongoose;

// ================== DOCUMENT TYPES ==================
const DOCUMENT_MIME_TYPES = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const MAX_EXTRACTED_CHARACTERS = 300000;

// ================== DOCUMENT SCHEMA ==================
const documentSchema = new Schema(
    {
        // ================== OWNERSHIP ==================
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

        // ================== FILE METADATA ==================
        originalName: {
            type: String,
            required: true,
            trim: true,
            maxlength: 255,
        },

        fileType: {
            type: String,
            enum: Object.keys(DOCUMENT_MIME_TYPES),
            required: true,
            immutable: true,
        },

        mimeType: {
            type: String,
            required: true,
            immutable: true,
            validate: {
                validator(value) {
                    return DOCUMENT_MIME_TYPES[this.fileType] === value;
                },
                message: "Document MIME type does not match the file type.",
            },
        },

        sizeBytes: {
            type: Number,
            required: true,
            min: 1,
            immutable: true,
            validate: {
                validator: Number.isSafeInteger,
                message: "Document size must be an integer.",
            },
        },

        // ================== PROCESSING ==================
        status: {
            type: String,
            enum: [
                "uploaded",
                "processing",
                "ready",
                "failed",
                "deleting",
            ],
            default: "uploaded",
            required: true,
        },

        pageCount: {
            type: Number,
            default: null,
            min: 1,
            validate: {
                validator(value) {
                    return value == null || (
                        this.fileType === "pdf" &&
                        Number.isSafeInteger(value)
                    );
                },
                message: "Page count is supported only for PDFs.",
            },
        },

        // ================== EXTRACTED CONTENT ==================
        extractedText: {
            type: String,
            default: "",
            maxlength: MAX_EXTRACTED_CHARACTERS,
            select: false,
        },

        extractedCharCount: {
            type: Number,
            default: 0,
            min: 0,
            validate: Number.isSafeInteger,
        },

        extractedTokenCount: {
            type: Number,
            default: 0,
            min: 0,
            validate: Number.isSafeInteger,
        },

        chunkCount: {
            type: Number,
            default: 0,
            min: 0,
            validate: Number.isSafeInteger,
        },

        // ================== PROCESSING RESULT ==================
        errorCode: {
            type: String,
            default: null,
            trim: true,
            maxlength: 80,
        },

        processedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// ================== DATABASE INDEXES ==================
documentSchema.index({
    userId: 1,
    conversationId: 1,
    status: 1,
    createdAt: -1,
});

// ================== SHARED EXTRACTION LIMIT ==================
documentSchema.statics.MAX_EXTRACTED_CHARACTERS =
    MAX_EXTRACTED_CHARACTERS;

// ================== MODEL ==================
const Document = mongoose.model(
    "Document",
    documentSchema
);

// ================== EXPORT ==================
module.exports = Document;
