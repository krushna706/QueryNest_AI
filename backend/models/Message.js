const mongoose = require("mongoose");

const { Schema } = mongoose;

// Message statuses
const MESSAGE_STATUSES = ["queued", "streaming", "completed", "stopped", "incomplete", "failed"];

// Message sources
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

        // File type
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

        // Pdf page reference
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

        // Docx section reference
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

        // Source excerpt
        text: {
            type: String,
            default: "",
            maxlength: 8000,
        },

        // Retrieval score
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

// Source validation
sourceSchema.pre("validate", function () {
    if (this.fileType === "docx" && this.pageNumber != null) {
        this.invalidate("pageNumber", "DOCX citations cannot use PDF page numbers.");
    }

    if ((this.paragraphStart == null) !== (this.paragraphEnd == null)) {
        this.invalidate("paragraphEnd", "Both paragraph boundaries are required together.");
    }

    if (this.paragraphStart != null && this.paragraphEnd != null && this.paragraphEnd < this.paragraphStart) {
        this.invalidate("paragraphEnd", "Paragraph end cannot precede paragraph start.");
    }

    if (this.fileType === "pdf" && (this.paragraphStart != null || this.paragraphEnd != null)) {
        this.invalidate("paragraphStart", "PDF citations must use page references.");
    }
});

// Message schema
const messageSchema = new Schema(
    {
        // Message owner
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

        // Message details
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

        // Response attempts
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

        // Ai provider
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

        // Document attachments
        attachmentIds: {
            type: [
                {
                    type: Schema.Types.ObjectId,
                    ref: "Document",
                },
            ],
            default: [],
        },

        // Document citations
        sources: {
            type: [sourceSchema],
            default: [],
        },
    },
    {
        timestamps: true,
    }
);

// Database indexes
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

// Model
const Message = mongoose.model("Message", messageSchema);

// Export
module.exports = Message;
