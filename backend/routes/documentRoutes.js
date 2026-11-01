const {
    documentUploadLimiter,
    chatReadLimiter,
    chatWriteLimiter,
    chatDailyWriteLimiter,
} = require("../middleware/rateLimiter");
const express = require("express");

const documentController = require("../controllers/documentController");

const authMiddleware = require("../middleware/authMiddleware");
const ownershipMiddleware = require("../middleware/ownershipMiddleware");
const validateMiddleware = require("../middleware/validateMiddleware");
const { uploadDocumentFiles } = require("../middleware/uploadMiddleware");

const { conversationParamsSchema, deleteDocumentParamsSchema } = require("../validations/schema");

// Router setup
const router = express.Router();

// Authentication
router.use(authMiddleware);

// POST /api/documents
router.post("/", documentUploadLimiter, chatDailyWriteLimiter, uploadDocumentFiles, documentController.uploadDocuments);

// POST /api/documents/:conversationId
router.post("/:conversationId", documentUploadLimiter, validateMiddleware(conversationParamsSchema, { source: "params" }), ownershipMiddleware, uploadDocumentFiles, documentController.uploadDocuments);

// GET /api/documents/:conversationId
router.get("/:conversationId", chatReadLimiter, validateMiddleware(conversationParamsSchema, { source: "params" }), ownershipMiddleware, documentController.getDocuments);

// DELETE /api/documents/:conversationId/:documentId
router.delete("/:conversationId/:documentId", chatWriteLimiter, validateMiddleware(deleteDocumentParamsSchema, { source: "params" }), ownershipMiddleware, documentController.deleteDocument);

module.exports = router;
