
const path = require("node:path");
const multer = require("multer");

const ExpressError = require("../utils/ExpressError");
const { APP_USAGE_LIMITS } = require("../config/usageLimits");

// ================== UPLOAD SETTINGS ==================
const MAX_FILES = APP_USAGE_LIMITS.maxPdfPerConversation;
const MAX_FILE_SIZE = APP_USAGE_LIMITS.maxPdfSizeBytes;
const FIELD_NAME = "files";

const DOCX_MIME =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// ================== VALIDATE CONFIGURATION ==================
if (
    !Number.isSafeInteger(MAX_FILES) ||
    MAX_FILES < 1 ||
    !Number.isSafeInteger(MAX_FILE_SIZE) ||
    MAX_FILE_SIZE < 1
) {
    throw new Error("Invalid document upload limits.");
}

// ================== NORMALIZE FILE NAME ==================
function normalizeFileName(originalName) {
    if (typeof originalName !== "string") {
        throw new ExpressError(
            400,
            "Invalid document filename."
        );
    }

    const name = path.posix.basename(
        originalName.replace(/\\/g, "/")
    )
        .normalize("NFC")
        .trim();

    if (
        !name ||
        name === "." ||
        name === ".." ||
        /[\u0000-\u001F\u007F-\u009F]/u.test(name) ||
        Buffer.byteLength(name, "utf8") > 255
    ) {
        throw new ExpressError(
            400,
            "Invalid document filename."
        );
    }

    // ================== ALLOWED EXTENSIONS ==================
    const extension = path.extname(name).toLowerCase();

    if (![".pdf", ".docx"].includes(extension)) {
        throw new ExpressError(
            415,
            "Only PDF and DOCX files are supported."
        );
    }

    return {
        name,
        extension,
    };
}

// ================== FILE FILTER ==================
function documentFileFilter(req, file, callback) {
    try {
        normalizeFileName(file.originalname);

        callback(null, true);
    } catch (error) {
        callback(error);
    }
}

// ================== MULTER CONFIGURATION ==================
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

// ================== UPLOAD ERROR HANDLING ==================
function mapUploadError(error) {
    if (!(error instanceof multer.MulterError)) {
        return error;
    }

    switch (error.code) {
        // ================== FILE SIZE ==================
        case "LIMIT_FILE_SIZE":
            return new ExpressError(
                413,
                "Each document must be 5 MB or smaller."
            );

        // ================== FILE COUNT ==================
        case "LIMIT_FILE_COUNT":
        case "LIMIT_UNEXPECTED_FILE":
            return new ExpressError(
                400,
                `Upload up to ${MAX_FILES} files using the '${FIELD_NAME}' field.`
            );

        // ================== FORM LIMITS ==================
        case "LIMIT_PART_COUNT":
        case "LIMIT_FIELD_COUNT":
        case "LIMIT_FIELD_VALUE":
        case "LIMIT_FIELD_KEY":
        case "LIMIT_FIELD_NAME":
            return new ExpressError(
                400,
                "Upload form exceeds the allowed limits."
            );

        default:
            return new ExpressError(
                400,
                "Invalid document upload request."
            );
    }
}

// ================== VERIFY FILE CONTENT ==================
async function validateUploadedFiles(files) {
    const { fileTypeFromBuffer } =
        await import("file-type");

    for (const file of files) {
        // ================== NORMALIZE NAME ==================
        const { name, extension } =
            normalizeFileName(file.originalname);

        // ================== VALIDATE BUFFER ==================
        if (
            !Buffer.isBuffer(file.buffer) ||
            file.buffer.length < 1 ||
            file.buffer.length > MAX_FILE_SIZE
        ) {
            throw new ExpressError(
                413,
                "Invalid document size."
            );
        }

        // ================== DETECT FILE TYPE ==================
        const detected = await fileTypeFromBuffer(
            file.buffer
        );

        // ================== PDF VALIDATION ==================
        if (extension === ".pdf") {
            if (
                detected?.mime !== "application/pdf"
            ) {
                throw new ExpressError(
                    415,
                    "Invalid PDF file content."
                );
            }

            file.fileType = "pdf";
            file.mimeType = "application/pdf";

        // ================== DOCX VALIDATION ==================
        } else {
            // DOCX is ZIP-based. Some detectors return ZIP.
            // Word structure is checked by the DOCX extractor.
            if (
                detected?.mime !== DOCX_MIME &&
                detected?.mime !== "application/zip"
            ) {
                throw new ExpressError(
                    415,
                    "Invalid DOCX file content."
                );
            }

            file.fileType = "docx";
            file.mimeType = DOCX_MIME;
        }

        // ================== SAFE FILE METADATA ==================
        file.originalname = name;
        file.size = file.buffer.length;
    }
}

// ================== DOCUMENT UPLOAD MIDDLEWARE ==================
function uploadDocumentFiles(req, res, next) {
    // ================== AUTHENTICATION CHECK ==================
    if (!req.user?._id) {
        return next(
            new ExpressError(
                401,
                "Please login to continue."
            )
        );
    }

    // ================== CONTENT TYPE CHECK ==================
    if (!req.is("multipart/form-data")) {
        return next(
            new ExpressError(
                415,
                "Use multipart/form-data for document uploads."
            )
        );
    }

    // ================== HANDLE FILE UPLOAD ==================
    upload(req, res, async (error) => {
        if (error) {
            return next(
                mapUploadError(error)
            );
        }

        // ================== VALIDATE FILE COUNT ==================
        if (
            !Array.isArray(req.files) ||
            req.files.length < 1 ||
            req.files.length > MAX_FILES
        ) {
            return next(
                new ExpressError(
                    400,
                    "Upload at least one PDF or DOCX file."
                )
            );
        }

        try {
            // ================== VERIFY FILE SIGNATURES ==================
            await validateUploadedFiles(
                req.files
            );

            // ================== CONTINUE TO CONTROLLER ==================
            return next();

        } catch (validationError) {
            // ================== DISCARD INVALID FILES ==================
            req.files = [];

            return next(
                validationError
            );
        }
    });
}

// ================== EXPORT ==================
module.exports = uploadDocumentFiles;
