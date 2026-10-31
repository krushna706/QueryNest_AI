const { randomUUID } = require("node:crypto");
const cloudinary = require("cloudinary").v2;

const User = require("../models/User");

const ExpressError = require("../utils/ExpressError");
const { deleteAllUserChats } = require("../services/deletionService");

// ================== USER RESPONSE ==================
function getUserResponse(user) {
    return {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        avatar: {
            url: user.avatar?.url || "",
        },
    };
}

// ================== PROFILE CONFIGURATION ==================
const MAX_AVATAR_SIZE = 3 * 1024 * 1024;

const ALLOWED_IMAGES = {
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "image/webp": ["webp"],
};

// ================== CLOUDINARY CONFIGURATION ==================
function configureCloudinary() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
        throw new Error(
            "Cloudinary configuration is incomplete."
        );
    }

    cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
    });
}

// ================== GET PROFILE ==================
// GET /api/users/profile
async function getProfile(req, res, next) {
    try {
        const user = await User.findOne({
            _id: req.user._id,
            role: "user",
            status: "Active",
        });

        if (!user) {
            throw new ExpressError(
                404,
                "Profile not found."
            );
        }

        res.set("Cache-Control", "no-store");

        return res.status(200).json({
            success: true,
            user: getUserResponse(user),
        });

    } catch (error) {
        return next(error);
    }
}

// ================== UPDATE PROFILE NAME ==================
// PATCH /api/users/profile
async function updateProfile(req, res, next) {
    try {
        const payload = req.body;

        if (
            !payload ||
            typeof payload !== "object" ||
            Array.isArray(payload) ||
            Object.keys(payload).length !== 1 ||
            !Object.hasOwn(payload, "name")
        ) {
            throw new ExpressError(
                400,
                "Only your name can be updated."
            );
        }

        if (typeof payload.name !== "string") {
            throw new ExpressError(
                400,
                "Enter a valid name."
            );
        }

        const name = payload.name
            .trim()
            .replace(/\s+/g, " ");

        if (
            name.length < 2 ||
            name.length > 100 ||
            /[\u0000-\u001F\u007F]/.test(name)
        ) {
            throw new ExpressError(
                400,
                "Name must contain between 2 and 100 valid characters."
            );
        }

        const user = await User.findOneAndUpdate(
            {
                _id: req.user._id,
                role: "user",
                status: "Active",
            },
            {
                $set: {
                    name,
                },
            },
            {
                returnDocument: "after",
                runValidators: true,
            }
        );

        if (!user) {
            throw new ExpressError(
                404,
                "Profile not found."
            );
        }

        res.set("Cache-Control", "no-store");

        return res.status(200).json({
            success: true,
            message: "Profile updated successfully.",
            user: getUserResponse(user),
        });

    } catch (error) {
        return next(error);
    }
}

// ================== VALIDATE AVATAR ==================
async function validateAvatar(file) {
    if (
        !file ||
        !Buffer.isBuffer(file.buffer)
    ) {
        throw new ExpressError(
            400,
            "Please select a profile picture."
        );
    }

    if (
        file.size <= 0 ||
        file.size > MAX_AVATAR_SIZE
    ) {
        throw new ExpressError(
            413,
            "Profile picture must be smaller than 3 MB."
        );
    }

    const extension = String(
        file.originalname || ""
    )
        .split(".")
        .pop()
        .toLowerCase();

    const { fileTypeFromBuffer } = await import(
        "file-type"
    );

    const detected = await fileTypeFromBuffer(
        file.buffer
    );

    const acceptedExtensions =
        ALLOWED_IMAGES[detected?.mime];

    if (
        !acceptedExtensions ||
        !acceptedExtensions.includes(extension) ||
        file.mimetype !== detected.mime
    ) {
        throw new ExpressError(
            415,
            "Only valid JPG, PNG and WebP images are allowed."
        );
    }
}

// ================== UPLOAD TO CLOUDINARY ==================
function uploadToCloudinary(buffer) {
    return new Promise((resolve, reject) => {
        const uploadStream =
            cloudinary.uploader.upload_stream(
                {
                    folder: "querynest_ai",

                    public_id: randomUUID(),

                    resource_type: "image",
                    type: "upload",

                    overwrite: false,
                    unique_filename: false,

                    format: "webp",

                    transformation: [
                        {
                            width: 512,
                            height: 512,
                            crop: "limit",
                            quality: "auto",
                        },
                    ],
                },
                (error, result) => {
                    if (error) {
                        reject(error);
                        return;
                    }

                    resolve(result);
                }
            );

        uploadStream.end(buffer);
    });
}

// ================== DELETE CLOUDINARY IMAGE ==================
async function deleteCloudinaryImage(publicId) {
    if (!publicId) return;

    await cloudinary.uploader.destroy(
        publicId,
        {
            resource_type: "image",
            invalidate: true,
        }
    );
}

// ================== UPLOAD / REPLACE AVATAR ==================
// POST /api/users/profile/avatar
async function uploadAvatar(req, res, next) {
    let newPublicId = "";
    let avatarSaved = false;

    try {
        await validateAvatar(req.file);

        configureCloudinary();

        const existingUser = await User.findOne({
            _id: req.user._id,
            role: "user",
            status: "Active",
        }).select("+avatar.publicId");

        if (!existingUser) {
            throw new ExpressError(
                404,
                "Profile not found."
            );
        }

        const oldPublicId =
            existingUser.avatar?.publicId || "";

        const uploaded = await uploadToCloudinary(
            req.file.buffer
        );

        newPublicId = uploaded?.public_id || "";

        if (
            !newPublicId ||
            typeof uploaded?.secure_url !== "string" ||
            !uploaded.secure_url.startsWith(
                "https://res.cloudinary.com/"
            )
        ) {
            throw new Error(
                "Cloudinary returned an invalid upload result."
            );
        }

        const avatarCondition = oldPublicId
            ? {
                "avatar.publicId": oldPublicId,
            }
            : {
                $or: [
                    {
                        "avatar.publicId": "",
                    },
                    {
                        "avatar.publicId": {
                            $exists: false,
                        },
                    },
                ],
            };

        const updatedUser = await User.findOneAndUpdate(
            {
                _id: req.user._id,
                role: "user",
                status: "Active",
                ...avatarCondition,
            },
            {
                $set: {
                    avatar: {
                        url: uploaded.secure_url,
                        publicId: newPublicId,
                    },
                },
            },
            {
                returnDocument: "after",
                runValidators: true,
            }
        );

        if (!updatedUser) {
            throw new ExpressError(
                409,
                "Profile picture changed. Please try again."
            );
        }

        avatarSaved = true;

        if (
            oldPublicId &&
            oldPublicId !== newPublicId
        ) {
            try {
                await deleteCloudinaryImage(
                    oldPublicId
                );
            } catch {
                // New avatar is already saved.
                // Old-image cleanup can be retried separately.
                console.warn(
                    "Previous profile image cleanup failed."
                );
            }
        }

        res.set("Cache-Control", "no-store");

        return res.status(200).json({
            success: true,
            message:
                "Profile picture updated successfully.",

            user: getUserResponse(
                updatedUser
            ),
        });

    } catch (error) {
        if (
            newPublicId &&
            !avatarSaved
        ) {
            try {
                await deleteCloudinaryImage(
                    newPublicId
                );
            } catch {
                console.warn(
                    "Failed profile upload cleanup requires retry."
                );
            }
        }

        return next(error);
    }
}

// ================== CLEAR ALL CHAT HISTORY ==================
// DELETE /api/users/chat-history
async function clearAllChatHistory(req, res, next) {
    try {
        const result = await deleteAllUserChats(req.user._id);

        res.set("Cache-Control", "private, no-store");

        return res.status(200).json({
            success: true,
            message: "Your chat history has been cleared successfully.",
            deleted: result,
        });

    } catch (error) {
        return next(error);
    }
}

// ================== EXPORTS ==================
module.exports = {
    getProfile,
    updateProfile,
    uploadAvatar,
    clearAllChatHistory,
};
