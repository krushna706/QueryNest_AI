const path = require("node:path");
const multer = require("multer");

const ExpressError = require("../utils/ExpressError");
const { APP_USAGE_LIMITS } = require("../config/usageLimits");

// Upload settings
const MAX_FILES = APP_USAGE_LIMITS.maxPdfPerConversation;
const MAX_FILE_SIZE = APP_USAGE_LIMITS.maxPdfSizeBytes;
const FIELD_NAME = "files";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Validate configuration
if (!Number.isSafeInteger(MAX_FILES) || MAX_FILES < 1 || !Number.isSafeInteger(MAX_FILE_SIZE) || MAX_FILE_SIZE < 1) {
    throw new Error("Invalid document upload limits.");
}

// Normalize file name
function normalizeFileName(originalName) {
    if (typeof originalName !== "string") {
        throw new ExpressError(400, "Invalid document filename.");
    }

    const name = path.posix.basename(originalName.replace(/\\/g, "/")).normalize("NFC").trim();

    if (
        !name ||
        name === "." ||
        name === ".." ||
        /[\u0000-\u001F\u007F-\u009F]/u.test(name) ||
        Buffer.byteLength(name, "utf8") > 255
    ) {
        throw new ExpressError(400, "Invalid document filename.");
    }

    const extension = path.extname(name).toLowerCase();

    if (![".pdf", ".docx"].includes(extension)) {
        throw new ExpressError(415, "Only PDF and DOCX files are supported.");
    }

    return {
        name,
        extension,
    };
}

// File filter
function documentFileFilter(req, file, callback) {
    try {
        normalizeFileName(file.originalname);

        callback(null, true);
    } catch (error) {
        callback(error);
    }
}

// Multer configuration
const upload = multer({
    storage: multer.memoryStorage(),

    preservePath: false,

    fileFilter: documentFileFilter,

    limits: {
        fileSize: MAX_FILE_SIZE,
        files: MAX_FILES,

        fields: 4,
        fieldSize: 100 * 1024,
        fieldNameSize: 64,

        parts: MAX_FILES + 4,
        headerPairs: 200,
    },
}).array(FIELD_NAME, MAX_FILES);

// Upload error handling
function mapUploadError(error) {
    if (!(error instanceof multer.MulterError)) {
        return error;
    }

    switch (error.code) {
        case "LIMIT_FILE_SIZE":
            return new ExpressError(413, "Each document must be 5 MB or smaller.");

        case "LIMIT_FILE_COUNT":
        case "LIMIT_UNEXPECTED_FILE":
            return new ExpressError(400, `Upload up to ${MAX_FILES} files using the '${FIELD_NAME}' field.`);

        case "LIMIT_PART_COUNT":
        case "LIMIT_FIELD_COUNT":
        case "LIMIT_FIELD_VALUE":
        case "LIMIT_FIELD_KEY":
        case "LIMIT_FIELD_NAME":
            return new ExpressError(400, "Upload form exceeds the allowed limits.");

        default:
            return new ExpressError(400, "Invalid document upload request.");
    }
}

// Verify file content
async function validateUploadedFiles(files) {
    const { fileTypeFromBuffer } = await import("file-type");

    for (const file of files) {
        const { name, extension } = normalizeFileName(file.originalname);

        if (!Buffer.isBuffer(file.buffer) || file.buffer.length < 1 || file.buffer.length > MAX_FILE_SIZE) {
            throw new ExpressError(413, "Invalid document size.");
        }

        const detected = await fileTypeFromBuffer(file.buffer);

        if (extension === ".pdf") {
            if (detected?.mime !== "application/pdf") {
                throw new ExpressError(415, "Invalid PDF file content.");
            }

            file.fileType = "pdf";
            file.mimeType = "application/pdf";
        } else {
            // DOCX is ZIP-based. Some detectors return ZIP.
            // Word structure is checked by the DOCX extractor.
            if (detected?.mime !== DOCX_MIME && detected?.mime !== "application/zip") {
                throw new ExpressError(415, "Invalid DOCX file content.");
            }

            file.fileType = "docx";
            file.mimeType = DOCX_MIME;
        }

        file.originalname = name;
        file.size = file.buffer.length;
    }
}

// Document upload middleware
function uploadDocumentFiles(req, res, next) {
    if (!req.user?._id) {
        return next(new ExpressError(401, "Please login to continue."));
    }

    if (!req.is("multipart/form-data")) {
        return next(new ExpressError(415, "Use multipart/form-data for document uploads."));
    }

    upload(req, res, async (error) => {
        if (error) {
            return next(mapUploadError(error));
        }

        if (!Array.isArray(req.files) || req.files.length < 1 || req.files.length > MAX_FILES) {
            return next(new ExpressError(400, "Upload at least one PDF or DOCX file."));
        }

        try {
            await validateUploadedFiles(req.files);

            return next();
        } catch (validationError) {
            req.files = [];

            return next(validationError);
        }
    });
}

// Profile picture upload
const MAX_AVATAR_SIZE = 3 * 1024 * 1024;

const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const ALLOWED_AVATAR_EXTENSION = /\.(jpg|jpeg|png|webp)$/i;

const avatarUpload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: MAX_AVATAR_SIZE,
        files: 1,
        fields: 0,
        parts: 1,
        fieldNameSize: 40,
        headerPairs: 20,
    },

    fileFilter: (req, file, callback) => {
        const validMimeType = ALLOWED_AVATAR_TYPES.has(file.mimetype);

        const validExtension = ALLOWED_AVATAR_EXTENSION.test(file.originalname || "");

        if (!validMimeType || !validExtension) {
            return callback(new ExpressError(415, "Only JPG, JPEG, PNG and WebP images are allowed."));
        }

        return callback(null, true);
    },
});

function handleAvatarUpload(req, res, next) {
    avatarUpload.single("avatar")(req, res, (error) => {
        if (!error) {
            return next();
        }

        if (error instanceof multer.MulterError) {
            if (error.code === "LIMIT_FILE_SIZE") {
                return next(new ExpressError(413, "Profile picture must be smaller than 3 MB."));
            }

            if (error.code === "LIMIT_UNEXPECTED_FILE" || error.code === "LIMIT_FILE_COUNT") {
                return next(new ExpressError(400, "Upload only one profile picture using the avatar field."));
            }

            return next(new ExpressError(400, "Invalid profile picture upload."));
        }

        return next(error);
    });
}

// Export
module.exports = { uploadDocumentFiles, handleAvatarUpload };
