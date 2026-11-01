const mongoose = require("mongoose");
const { EMBEDDING_CONFIG } = require("../config/aiProviders");

const { Schema } = mongoose;

// Chunking configuration
const MAX_CHUNK_TOKENS = 900;
const CHUNK_OVERLAP_TOKENS = 150;
const MAX_CHUNK_CHARACTERS = 8000;
const VECTOR_INDEX_NAME = "document_chunks_vector_index";

// Document chunk schema
const documentChunkSchema = new Schema(
    {
        // Ownership
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

        documentId: {
            type: Schema.Types.ObjectId,
            ref: "Document",
            required: true,
            immutable: true,
        },

        // Chunk details
        fileType: {
            type: String,
            enum: ["pdf", "docx"],
            required: true,
            immutable: true,
        },

        chunkIndex: {
            type: Number,
            required: true,
            min: 0,
            immutable: true,
            validate: {
                validator: Number.isSafeInteger,
                message: "Chunk index must be an integer.",
            },
        },

        text: {
            type: String,
            required: true,
            trim: true,
            maxlength: MAX_CHUNK_CHARACTERS,
        },

        tokenCount: {
            type: Number,
            required: true,
            min: 1,
            max: MAX_CHUNK_TOKENS,
            validate: {
                validator: Number.isSafeInteger,
                message: "Chunk token count must be an integer.",
            },
        },

        // Source references
        // PDF chunks stay within one page for accurate citations.
        pageNumber: {
            type: Number,
            default: null,
            min: 1,
            required() {
                return this.fileType === "pdf";
            },
            validate: {
                validator(value) {
                    return value == null || Number.isSafeInteger(value);
                },
                message: "PDF page number must be an integer.",
            },
        },

        // DOCX documents do not have reliable page numbers.
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

        // Vector embedding
        embeddingModel: {
            type: String,
            required: true,
            default: EMBEDDING_CONFIG.model,
            enum: [EMBEDDING_CONFIG.model],
            immutable: true,
        },

        embedding: {
            type: [Number],
            required: true,
            default: undefined,
            select: false,
            validate: {
                validator(values) {
                    return (
                        Array.isArray(values) &&
                        values.length === EMBEDDING_CONFIG.dimensions &&
                        values.every(Number.isFinite)
                    );
                },
                message: `Embedding must contain ${EMBEDDING_CONFIG.dimensions} finite numbers.`,
            },
        },
    },
    {
        timestamps: true,
        autoSearchIndex: false,
    }
);

// Source validation
documentChunkSchema.pre("validate", function () {
    if (this.fileType === "docx" && this.pageNumber != null) {
        this.invalidate("pageNumber", "DOCX chunks cannot use PDF page numbers.");
    }

    if (this.fileType === "pdf" && (this.paragraphStart != null || this.paragraphEnd != null)) {
        this.invalidate("paragraphStart", "PDF chunks must use page references.");
    }

    if ((this.paragraphStart == null) !== (this.paragraphEnd == null)) {
        this.invalidate("paragraphEnd", "Both paragraph boundaries are required together.");
    }

    if (this.paragraphStart != null && this.paragraphEnd != null && this.paragraphEnd < this.paragraphStart) {
        this.invalidate("paragraphEnd", "Paragraph end cannot precede paragraph start.");
    }
});

// Database indexes
documentChunkSchema.index(
    {
        userId: 1,
        conversationId: 1,
        documentId: 1,
        chunkIndex: 1,
    },
    {
        unique: true,
    }
);

documentChunkSchema.index({
    documentId: 1,
});

// Atlas vector search index
// Create once in Atlas during RAG setup.
documentChunkSchema.searchIndex({
    name: VECTOR_INDEX_NAME,
    type: "vectorSearch",
    definition: {
        fields: [
            {
                type: "vector",
                path: "embedding",
                numDimensions: EMBEDDING_CONFIG.dimensions,
                similarity: "cosine",
            },
            {
                type: "filter",
                path: "userId",
            },
            {
                type: "filter",
                path: "conversationId",
            },
            {
                type: "filter",
                path: "documentId",
            },
        ],
    },
});

// Reusable configuration
documentChunkSchema.statics.CHUNKING_CONFIG = Object.freeze({
    maxTokens: MAX_CHUNK_TOKENS,
    overlapTokens: CHUNK_OVERLAP_TOKENS,
    maxCharacters: MAX_CHUNK_CHARACTERS,
});

documentChunkSchema.statics.VECTOR_INDEX_NAME = VECTOR_INDEX_NAME;

// Model
const DocumentChunk = mongoose.model("DocumentChunk", documentChunkSchema);

// Export
module.exports = DocumentChunk;
