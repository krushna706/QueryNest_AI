const Joi = require("joi");

// Common email rule
const emailRule = Joi.string().trim().lowercase().email().max(254).required().messages({
    "string.base": "Email must be a string.",
    "string.empty": "Email is required.",
    "string.email": "Enter a valid email address.",
    "string.max": "Email cannot exceed 254 characters.",
    "any.required": "Email is required.",
});

// Common phone rule
const phoneRule = Joi.string()
    .trim()
    .pattern(/^[6-9]\d{9}$/)
    .required()
    .messages({
        "string.base": "Phone number must be a string.",
        "string.empty": "Phone number is required.",
        "string.pattern.base": "Enter a valid 10-digit Indian mobile number.",
        "any.required": "Phone number is required.",
    });

// Common password rule
const passwordRule = Joi.string()
    .max(72)
    .custom((value, helpers) => {
        if (Buffer.byteLength(value, "utf8") > 72) {
            return helpers.error("password.byteLimit");
        }

        return value;
    }, "password byte limit")
    .required()
    .messages({
        "string.base": "Password must be a string.",
        "string.empty": "Password is required.",
        "string.max": "Password cannot exceed 72 UTF-8 bytes.",
        "password.byteLimit": "Password cannot exceed 72 UTF-8 bytes.",
        "any.required": "Password is required.",
    });

// Account identifier
const identifierRule = Joi.alternatives().try(emailRule, phoneRule).required().messages({
    "alternatives.match": "Enter a valid email address or 10-digit Indian mobile number.",
    "any.required": "Email address or phone number is required.",
});

// Signup validation
const signupSchema = Joi.object({
    name: Joi.string().trim().min(2).max(100).required().messages({
        "string.empty": "Name is required.",
        "string.min": "Name must contain at least 2 characters.",
        "string.max": "Name cannot exceed 100 characters.",
        "any.required": "Name is required.",
    }),

    email: emailRule,

    phone: phoneRule,

    password: passwordRule.min(6).messages({
        "string.min": "Password must contain at least 6 characters.",
    }),

    confirmPassword: Joi.string().valid(Joi.ref("password")).required().messages({
        "string.empty": "Confirm your password.",
        "any.only": "Passwords do not match.",
        "any.required": "Confirm password is required.",
    }),
})
    .required()
    .unknown(false);

// Login validation
const loginSchema = Joi.object({
    identifier: identifierRule,
    password: passwordRule,
})
    .required()
    .unknown(false);

// Request password otp
const forgotPasswordRequestSchema = Joi.object({
    identifier: identifierRule,
})
    .required()
    .unknown(false);

// Verify password otp
const forgotPasswordVerifySchema = Joi.object({
    identifier: identifierRule,

    otp: Joi.string()
        .pattern(/^\d{6}$/)
        .required()
        .strict()
        .messages({
            "string.empty": "Enter the OTP.",
            "string.pattern.base": "OTP must contain exactly 6 digits.",
            "any.required": "OTP is required.",
        }),
})
    .required()
    .unknown(false);

// Reset password
const forgotPasswordResetSchema = Joi.object({
    resetToken: Joi.string()
        .pattern(/^[a-f0-9]{64}$/)
        .required()
        .messages({
            "string.empty": "Password reset authorization is required.",
            "string.pattern.base": "Invalid password reset authorization.",
            "any.required": "Reset authorization is required.",
        }),

    newPassword: passwordRule.min(6).messages({
        "string.min": "Password must contain at least 6 characters.",
    }),

    confirmPassword: Joi.string().valid(Joi.ref("newPassword")).required().messages({
        "string.empty": "Confirm your new password.",
        "any.only": "Passwords do not match.",
        "any.required": "Confirm password is required.",
    }),
})
    .required()
    .unknown(false);

// Document attachment rule
const attachmentIdsRule = Joi.array()
    .items(Joi.string().trim().lowercase().hex().length(24).required())
    .max(3)
    .unique()
    .default([])
    .messages({
        "array.base": "Attachments must be an array.",
        "array.max": "Maximum 3 document attachments are allowed.",
        "array.unique": "Duplicate documents are not allowed.",
    });

// Chat message validation
const chatMessageSchema = Joi.object({
    content: Joi.string().trim().min(1).max(100000).required().messages({
        "string.empty": "Message cannot be empty.",
        "string.min": "Message cannot be empty.",
        "string.max": "Message is too long.",
        "any.required": "Message is required.",
    }),

    clientRequestId: Joi.string().guid({ version: "uuidv4" }).required().messages({
        "string.guid": "Invalid request identifier.",
        "any.required": "Request identifier is required.",
    }),

    // Optional documents
    attachmentIds: attachmentIdsRule,
})
    .required()
    .unknown(false);

// Generate ai validation
const generateAISchema = Joi.object({
    messageId: Joi.string().hex().length(24).required().messages({
        "string.hex": "Invalid user message ID.",
        "string.length": "Invalid user message ID.",
        "any.required": "User message ID is required.",
    }),

    regenerate: Joi.boolean().strict().default(false).messages({
        "boolean.base": "Regenerate must be a boolean.",
    }),
})
    .required()
    .unknown(false);

// Rename conversation
const renameConversationSchema = Joi.object({
    title: Joi.string().trim().min(1).max(120).required().messages({
        "string.empty": "Conversation title is required.",
        "string.min": "Conversation title cannot be empty.",
        "string.max": "Title cannot exceed 120 characters.",
        "any.required": "Conversation title is required.",
    }),
})
    .required()
    .unknown(false);

// Conversation id
const conversationParamsSchema = Joi.object({
    conversationId: Joi.string().hex().length(24).required().messages({
        "string.hex": "Invalid conversation ID.",
        "string.length": "Invalid conversation ID.",
        "any.required": "Conversation ID is required.",
    }),
})
    .required()
    .unknown(false);

// Document id params
const deleteDocumentParamsSchema = conversationParamsSchema
    .keys({
        documentId: Joi.string().hex().length(24).required().messages({
            "string.hex": "Invalid document ID.",
            "string.length": "Invalid document ID.",
            "any.required": "Document ID is required.",
        }),
    })
    .unknown(false);

// Profile name validation
const updateProfileSchema = Joi.object({
    name: Joi.string()
        .trim()
        .min(2)
        .max(100)
        .pattern(/^[^\u0000-\u001F\u007F]+$/)
        .required()
        .messages({
            "string.empty": "Name is required.",
            "string.min": "Name must contain at least 2 characters.",
            "string.max": "Name cannot exceed 100 characters.",
            "string.pattern.base": "Enter a valid name.",
            "any.required": "Name is required.",
        }),
})
    .required()
    .unknown(false);

// Chat history query
const chatHistoryQuerySchema = Joi.object({
    search: Joi.string().trim().max(120).allow("").default(""),

    cursor: Joi.string().max(256).optional(),

    limit: Joi.number().integer().min(1).max(50).default(20),
})
    .required()
    .unknown(false);

// Message history query
const messageHistoryQuerySchema = Joi.object({
    before: Joi.string().hex().length(24).optional(),

    limit: Joi.number().integer().min(1).max(50).default(20),
})
    .required()
    .unknown(false);

// Exports
module.exports = {
    signupSchema,
    loginSchema,
    forgotPasswordRequestSchema,
    forgotPasswordVerifySchema,
    forgotPasswordResetSchema,

    chatMessageSchema,
    generateAISchema,
    renameConversationSchema,

    conversationParamsSchema,
    deleteDocumentParamsSchema,
    updateProfileSchema,
    chatHistoryQuerySchema,
    messageHistoryQuerySchema,
};
