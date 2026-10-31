
const express = require("express");
const Joi = require("joi");

const documentController = require("../controllers/documentController");

const authMiddleware = require("../middleware/authMiddleware");
const ownershipMiddleware = require("../middleware/ownershipMiddleware");
const validateMiddleware = require("../middleware/validateMiddleware");
const uploadDocumentFiles = require("../middleware/uploadMiddleware");

const {
    conversationParamsSchema,
} = require("../validations/schema");

// ================== ROUTER SETUP ==================
const router = express.Router();

// ================== DOCUMENT ID VALIDATION ==================
// Extend the existing conversation parameter schema.
const deleteDocumentParamsSchema = conversationParamsSchema.keys({
    documentId: Joi.string()
        .hex()
        .length(24)
        .required()
        .messages({
            "string.hex": "Invalid document ID.",
            "string.length": "Invalid document ID.",
            "any.required": "Document ID is required.",
        }),
}).unknown(false);

// ================== AUTHENTICATION ==================
router.use(authMiddleware);

// ================== UPLOAD TO NEW CHAT ==================
// POST /api/documents
router.post(
    "/",
    uploadDocumentFiles,
    documentController.uploadDocuments
);

// ================== UPLOAD TO EXISTING CHAT ==================
// POST /api/documents/:conversationId
router.post(
    "/:conversationId",
    validateMiddleware(
        conversationParamsSchema,
        { source: "params" }
    ),
    ownershipMiddleware,
    uploadDocumentFiles,
    documentController.uploadDocuments
);

// ================== GET CONVERSATION DOCUMENTS ==================
// GET /api/documents/:conversationId
router.get(
    "/:conversationId",
    validateMiddleware(
        conversationParamsSchema,
        { source: "params" }
    ),
    ownershipMiddleware,
    documentController.getDocuments
);

// ================== DELETE DOCUMENT ==================
// DELETE /api/documents/:conversationId/:documentId
router.delete(
    "/:conversationId/:documentId",
    validateMiddleware(
        deleteDocumentParamsSchema,
        { source: "params" }
    ),
    ownershipMiddleware,
    documentController.deleteDocument
);

// ================== EXPORT ==================
module.exports = router;
