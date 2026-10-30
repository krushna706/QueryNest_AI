
const Joi = require("joi");

// ================== COMMON EMAIL RULE ==================
const emailRule = Joi.string().trim().lowercase().email().max(254).required().messages({
    "string.base": "Email must be a string.",
    "string.empty": "Email is required.",
    "string.email": "Enter a valid email address.",
    "string.max": "Email cannot exceed 254 characters.",
    "any.required": "Email is required.",
});

// ================== COMMON PHONE RULE ==================
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

// ================== COMMON PASSWORD RULE ==================
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

// ================== ACCOUNT IDENTIFIER ==================
const identifierRule = Joi.alternatives()
    .try(emailRule, phoneRule)
    .required()
    .messages({
        "alternatives.match": "Enter a valid email address or 10-digit Indian mobile number.",
        "any.required": "Email address or phone number is required.",
    });

// ================== SIGNUP VALIDATION ==================
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

    confirmPassword: Joi.string()
        .valid(Joi.ref("password"))
        .required()
        .messages({
            "string.empty": "Confirm your password.",
            "any.only": "Passwords do not match.",
            "any.required": "Confirm password is required.",
        }),
})
    .required()
    .unknown(false);

// ================== LOGIN VALIDATION ==================
const loginSchema = Joi.object({
    identifier: identifierRule,
    password: passwordRule,
})
    .required()
    .unknown(false);

// ================== REQUEST PASSWORD OTP ==================
const forgotPasswordRequestSchema = Joi.object({
    identifier: identifierRule,
})
    .required()
    .unknown(false);

// ================== VERIFY PASSWORD OTP ==================
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

// ================== RESET PASSWORD ==================
const forgotPasswordResetSchema = Joi.object({
    resetToken: Joi.string()
        .pattern(/^[a-f0-9]{64}$/)
        .required()
        .messages({
            "string.empty": "Password reset authorization is required.",
            "string.pattern.base": "Invalid password reset authorization.",
            "any.required": "Password reset authorization is required.",
        }),

    newPassword: passwordRule.min(6).messages({
        "string.min": "Password must contain at least 6 characters.",
    }),

    confirmPassword: Joi.string()
        .valid(Joi.ref("newPassword"))
        .required()
        .messages({
            "string.empty": "Confirm your new password.",
            "any.only": "Passwords do not match.",
            "any.required": "Confirm password is required.",
        }),
})
    .required()
    .unknown(false);

// ================== CHAT MESSAGE VALIDATION ==================
const chatMessageSchema = Joi.object({
    content: Joi.string()
        .trim()
        .min(1)
        .max(100000)
        .required()
        .messages({
            "string.empty": "Message cannot be empty.",
            "string.min": "Message cannot be empty.",
            "string.max": "Message is too long.",
            "any.required": "Message is required.",
        }),

    clientRequestId: Joi.string()
        .guid({ version: "uuidv4" })
        .required()
        .messages({
            "string.guid": "Invalid request identifier.",
            "any.required": "Request identifier is required.",
        }),
})
    .required()
    .unknown(false);

// ================== RENAME CONVERSATION VALIDATION ==================
const renameConversationSchema = Joi.object({
    title: Joi.string()
        .trim()
        .min(1)
        .max(120)
        .required()
        .messages({
            "string.empty": "Conversation title is required.",
            "string.min": "Conversation title cannot be empty.",
            "string.max": "Title cannot exceed 120 characters.",
            "any.required": "Conversation title is required.",
        }),
})
    .required()
    .unknown(false);

// ================== CONVERSATION ID VALIDATION ==================
const conversationParamsSchema = Joi.object({
    conversationId: Joi.string()
        .hex()
        .length(24)
        .required()
        .messages({
            "string.hex": "Invalid conversation ID.",
            "string.length": "Invalid conversation ID.",
            "any.required": "Conversation ID is required.",
        }),
})
    .required()
    .unknown(false);

// ================== CHAT HISTORY VALIDATION ==================
const chatHistoryQuerySchema = Joi.object({
    search: Joi.string()
        .trim()
        .max(120)
        .allow("")
        .default(""),

    cursor: Joi.string()
        .max(256)
        .optional(),

    limit: Joi.number()
        .integer()
        .min(1)
        .max(50)
        .default(20),
})
    .required()
    .unknown(false);

// ================== MESSAGE HISTORY VALIDATION ==================
const messageHistoryQuerySchema = Joi.object({
    before: Joi.string()
        .hex()
        .length(24)
        .optional(),

    limit: Joi.number()
        .integer()
        .min(1)
        .max(50)
        .default(20),
})
    .required()
    .unknown(false);

// ================== AI GENERATION VALIDATION ==================
const generateAISchema = Joi.object({
    messageId: Joi.string()
        .hex()
        .length(24)
        .required()
        .messages({
            "string.hex": "Invalid message ID.",
            "string.length": "Invalid message ID.",
            "any.required": "Message ID is required.",
        }),

    regenerate: Joi.boolean()
        .strict()
        .default(false)
        .messages({
            "boolean.base": "Regenerate must be true or false.",
        }),
})
    .required()
    .unknown(false);

// ================== EXPORTS ==================
module.exports = {
    signupSchema,
    loginSchema,
    forgotPasswordRequestSchema,
    forgotPasswordVerifySchema,
    forgotPasswordResetSchema,
    chatMessageSchema,
    renameConversationSchema,
    conversationParamsSchema,
    chatHistoryQuerySchema,
    messageHistoryQuerySchema,
    generateAISchema,
};
