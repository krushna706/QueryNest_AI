const Conversation = require("../models/Conversation");
const ExpressError = require("../utils/ExpressError");

// Conversation ownership
async function ownershipMiddleware(req, res, next) {
    try {
        if (!req.user?._id) {
            return next(new ExpressError(401, "Please login to continue."));
        }

        const conversationId = req.validated?.params?.conversationId;

        if (!conversationId) {
            return next(new ExpressError(400, "Invalid conversation ID."));
        }

        const conversation = await Conversation.findOne({
            _id: conversationId,
            userId: req.user._id,
            status: "active",
        })
            .select("_id userId title status lastActivityAt")
            .lean();

        if (!conversation) {
            return next(new ExpressError(404, "Conversation not found."));
        }

        req.conversation = conversation;

        return next();
    } catch (error) {
        return next(error);
    }
}

// Export
module.exports = ownershipMiddleware;
