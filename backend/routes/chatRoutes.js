const { chatReadLimiter, chatWriteLimiter, chatDailyWriteLimiter } = require("../middleware/rateLimiter");
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
    generateAISchema,
} = require("../validations/schema");

// Router setup
const router = express.Router();

// Authentication
router.use(authMiddleware);

router.post("/", chatWriteLimiter, chatDailyWriteLimiter, validateMiddleware(chatMessageSchema), chatController.createConversation);

router.get("/", chatReadLimiter, validateMiddleware(chatHistoryQuerySchema, { source: "query" }), chatController.getChatHistory);

router.get("/:conversationId", chatReadLimiter, validateMiddleware(conversationParamsSchema, { source: "params" }), ownershipMiddleware, chatController.getConversation);

router.patch("/:conversationId", chatWriteLimiter, chatDailyWriteLimiter, validateMiddleware(conversationParamsSchema, { source: "params" }), ownershipMiddleware, validateMiddleware(renameConversationSchema), chatController.renameConversation);

router.delete("/:conversationId", chatWriteLimiter, chatDailyWriteLimiter, validateMiddleware(conversationParamsSchema, { source: "params" }), ownershipMiddleware, chatController.deleteConversation);

router.post("/:conversationId/messages", chatWriteLimiter, chatDailyWriteLimiter, validateMiddleware(conversationParamsSchema, { source: "params" }), ownershipMiddleware, validateMiddleware(chatMessageSchema), chatController.addUserMessage);

router.get("/:conversationId/messages", chatReadLimiter, validateMiddleware(conversationParamsSchema, { source: "params" }), ownershipMiddleware, validateMiddleware(messageHistoryQuerySchema, { source: "query" }), chatController.getMessageHistory);

router.post("/:conversationId/generate", chatWriteLimiter, validateMiddleware(conversationParamsSchema, { source: "params" }), ownershipMiddleware, validateMiddleware(generateAISchema), chatController.generateAIResponse);

module.exports = router;
