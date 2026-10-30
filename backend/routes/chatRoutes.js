
const express = require("express");

const chatController = require("../controllers/chatController");

const authMiddleware = require("../middleware/authMiddleware");
const ownershipMiddleware = require("../middleware/ownershipMiddleware");
const validateMiddleware = require("../middleware/validateMiddleware");

const {
    chatMessageSchema,
    renameConversationSchema,
    conversationParamsSchema,
    chatHistoryQuerySchema,
    messageHistoryQuerySchema,
} = require("../validations/schema");

// ================== ROUTER SETUP ==================
const router = express.Router();

// ================== AUTHENTICATION ==================
router.use(authMiddleware);

// ================== CREATE CONVERSATION ==================
router.post(
    "/",
    validateMiddleware(chatMessageSchema),
    chatController.createConversation
);

// ================== CHAT HISTORY ==================
router.get(
    "/",
    validateMiddleware(chatHistoryQuerySchema, { source: "query" }),
    chatController.getChatHistory
);

// ================== GET CONVERSATION ==================
router.get(
    "/:conversationId",
    validateMiddleware(conversationParamsSchema, { source: "params" }),
    ownershipMiddleware,
    chatController.getConversation
);

// ================== RENAME CONVERSATION ==================
router.patch(
    "/:conversationId",
    validateMiddleware(conversationParamsSchema, { source: "params" }),
    ownershipMiddleware,
    validateMiddleware(renameConversationSchema),
    chatController.renameConversation
);

// ================== DELETE CONVERSATION ==================
router.delete(
    "/:conversationId",
    validateMiddleware(conversationParamsSchema, { source: "params" }),
    ownershipMiddleware,
    chatController.deleteConversation
);

// ================== ADD USER MESSAGE ==================
router.post(
    "/:conversationId/messages",
    validateMiddleware(conversationParamsSchema, { source: "params" }),
    ownershipMiddleware,
    validateMiddleware(chatMessageSchema),
    chatController.addUserMessage
);

// ================== MESSAGE HISTORY ==================
router.get(
    "/:conversationId/messages",
    validateMiddleware(conversationParamsSchema, { source: "params" }),
    ownershipMiddleware,
    validateMiddleware(messageHistoryQuerySchema, { source: "query" }),
    chatController.getMessageHistory
);

// ================== EXPORT ==================
module.exports = router;
