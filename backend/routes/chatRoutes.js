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

// ================== ROUTER SETUP ==================
const router = express.Router();

// ================== AUTHENTICATION ==================
router.use(authMiddleware);

router.post("/", validateMiddleware(chatMessageSchema), chatController.createConversation);

router.get("/", validateMiddleware(chatHistoryQuerySchema, { source: "query" }), chatController.getChatHistory);

router.get("/:conversationId", validateMiddleware(conversationParamsSchema, { source: "params" }), ownershipMiddleware, chatController.getConversation);

router.patch("/:conversationId", validateMiddleware(conversationParamsSchema, { source: "params" }), ownershipMiddleware, validateMiddleware(renameConversationSchema), chatController.renameConversation);

router.delete("/:conversationId", validateMiddleware(conversationParamsSchema, { source: "params" }), ownershipMiddleware, chatController.deleteConversation);

router.post("/:conversationId/messages", validateMiddleware(conversationParamsSchema, { source: "params" }), ownershipMiddleware, validateMiddleware(chatMessageSchema), chatController.addUserMessage);

router.get("/:conversationId/messages", validateMiddleware(conversationParamsSchema, { source: "params" }), ownershipMiddleware, validateMiddleware(messageHistoryQuerySchema, { source: "query" }), chatController.getMessageHistory);

router.post("/:conversationId/generate", validateMiddleware(conversationParamsSchema, { source: "params" }), ownershipMiddleware, validateMiddleware(generateAISchema), chatController.generateAIResponse);

module.exports = router;
