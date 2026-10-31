
const { PDFParse } = require("pdf-parse");

const Document = require("../../models/Document");
const ExpressError = require("../../utils/ExpressError");

const {
    APP_USAGE_LIMITS,
} = require("../../config/usageLimits");

// ================== PDF EXTRACTION SETTINGS ==================
const MAX_FILE_SIZE =
    APP_USAGE_LIMITS.maxPdfSizeBytes;

const MAX_PAGES =
    APP_USAGE_LIMITS.maxPagesPerConversation;

const MAX_EXTRACTED_CHARACTERS =
    Document.MAX_EXTRACTED_CHARACTERS;

const EXTRACTION_TIMEOUT_MS = 30000;

// ================== VALIDATE PDF FILE ==================
async function validatePdfBuffer(buffer) {
    if (
        !Buffer.isBuffer(buffer) ||
        buffer.length === 0
    ) {
        throw new ExpressError(
            400,
            "A valid PDF file is required."
        );
    }

    // ================== FILE SIZE ==================
    if (buffer.length > MAX_FILE_SIZE) {
        throw new ExpressError(
            413,
            "PDF file size must not exceed 5 MB."
        );
    }

    // ================== VERIFY ACTUAL FILE TYPE ==================
    // file-type v22 is an ESM package.
    const { fileTypeFromBuffer } =
        await import("file-type");

    const detected = await fileTypeFromBuffer(
        buffer
    );

    if (
        detected?.mime !== "application/pdf" ||
        detected?.ext !== "pdf"
    ) {
        throw new ExpressError(
            415,
            "Only valid PDF files are supported."
        );
    }
}

// ================== VALIDATE REMAINING PAGES ==================
function validateRemainingPages(remainingPages) {
    if (
        !Number.isSafeInteger(remainingPages) ||
        remainingPages < 0 ||
        remainingPages > MAX_PAGES
    ) {
        throw new ExpressError(
            400,
            "Invalid remaining PDF page allowance."
        );
    }

    if (remainingPages === 0) {
        throw new ExpressError(
            409,
            "PDF page limit reached for this conversation."
        );
    }
}

// ================== NORMALIZE PAGE TEXT ==================
function normalizePageText(value) {
    if (typeof value !== "string") {
        return "";
    }

    return value
        .replace(/\0/g, "")
        .replace(/\r\n?/g, "\n")
        .replace(/\u00a0/g, " ")
        .split("\n")
        .map((line) =>
            line
                .replace(/[ \t]+/g, " ")
                .trim()
        )
        .filter(Boolean)
        .join("\n")
        .trim();
}

// ================== VALIDATE PAGE COUNT ==================
function validatePageCount(
    pageCount,
    remainingPages
) {
    if (
        !Number.isSafeInteger(pageCount) ||
        pageCount < 1
    ) {
        throw new ExpressError(
            422,
            "Unable to determine PDF page count."
        );
    }

    if (pageCount > MAX_PAGES) {
        throw new ExpressError(
            413,
            `PDF cannot contain more than ${MAX_PAGES} pages.`
        );
    }

    if (pageCount > remainingPages) {
        throw new ExpressError(
            413,
            `Only ${remainingPages} PDF page(s) remain in this conversation.`
        );
    }
}

// ================== VALIDATE PARSED PAGES ==================
function prepareParsedPages(
    parsedResult,
    pageCount
) {
    if (
        parsedResult?.total !== pageCount ||
        !Array.isArray(parsedResult.pages) ||
        parsedResult.pages.length !== pageCount
    ) {
        throw new ExpressError(
            422,
            "PDF page extraction is incomplete."
        );
    }

    const pages = [];

    for (
        let index = 0;
        index < parsedResult.pages.length;
        index++
    ) {
        const page = parsedResult.pages[index];

        // Maintain exact source page references.
        if (
            page?.num !== index + 1 ||
            typeof page.text !== "string"
        ) {
            throw new ExpressError(
                422,
                "Invalid PDF page extraction result."
            );
        }

        pages.push({
            pageNumber: page.num,
            text: normalizePageText(page.text),
        });
    }

    return pages;
}

// ================== EXTRACT PDF TEXT ==================
// remainingPages must be calculated from the
// existing PDF documents in this conversation.
async function extractPdf(
    buffer,
    {
        remainingPages = MAX_PAGES,
        signal,
    } = {}
) {
    // ================== VALIDATE INPUT ==================
    validateRemainingPages(remainingPages);

    if (signal?.aborted) {
        throw new ExpressError(
            408,
            "PDF processing cancelled."
        );
    }

    await validatePdfBuffer(buffer);

    if (signal?.aborted) {
        throw new ExpressError(
            408,
            "PDF processing cancelled."
        );
    }

    // ================== INITIALIZE PDF PARSER ==================
    const parser = new PDFParse({
        data: new Uint8Array(buffer),
    });

    let timedOut = false;
    let destroyPromise = null;

    // ================== PARSER CLEANUP ==================
    function destroyParser() {
        if (!destroyPromise) {
            destroyPromise = parser
                .destroy()
                .catch(() => {});
        }

        return destroyPromise;
    }

    // ================== CANCEL PROCESSING ==================
    function handleAbort() {
        void destroyParser();
    }

    signal?.addEventListener(
        "abort",
        handleAbort,
        { once: true }
    );

    const timeout = setTimeout(() => {
        timedOut = true;
        void destroyParser();
    }, EXTRACTION_TIMEOUT_MS);

    timeout.unref?.();

    try {
        // ================== READ PDF METADATA ==================
        const info = await parser.getInfo();

        if (signal?.aborted) {
            throw new ExpressError(
                408,
                "PDF processing cancelled."
            );
        }

        if (timedOut) {
            throw new ExpressError(
                408,
                "PDF extraction timed out."
            );
        }

        // ================== CHECK PDF PAGES ==================
        const pageCount = info?.total;

        validatePageCount(
            pageCount,
            remainingPages
        );

        // ================== EXTRACT PAGE-WISE TEXT ==================
        const parsedResult = await parser.getText({
            first: pageCount,

            // Avoid synthetic page markers in extracted text.
            pageJoiner: "",

            // Preserve useful line boundaries.
            lineEnforce: true,

            // Treat document content as plain text.
            parseHyperlinks: false,
        });

        if (signal?.aborted) {
            throw new ExpressError(
                408,
                "PDF processing cancelled."
            );
        }

        if (timedOut) {
            throw new ExpressError(
                408,
                "PDF extraction timed out."
            );
        }

        // ================== PREPARE PAGE REFERENCES ==================
        const pages = prepareParsedPages(
            parsedResult,
            pageCount
        );

        // ================== EXTRACTED TEXT ==================
        const extractedText = pages
            .filter((page) => page.text)
            .map((page) => page.text)
            .join("\n\n");

        // ================== SCANNED / EMPTY PDF ==================
        if (!extractedText.trim()) {
            throw new ExpressError(
                422,
                "No readable text found. Scanned or image-only PDFs are not supported."
            );
        }

        // ================== TEXT SIZE LIMIT ==================
        if (
            extractedText.length >
            MAX_EXTRACTED_CHARACTERS
        ) {
            throw new ExpressError(
                413,
                "Extracted PDF text exceeds the allowed limit."
            );
        }

        // ================== EMPTY PAGE REFERENCES ==================
        const emptyPageNumbers = pages
            .filter((page) => !page.text)
            .map((page) => page.pageNumber);

        // ================== EXTRACTION RESULT ==================
        return {
            fileType: "pdf",
            mimeType: "application/pdf",
            sizeBytes: buffer.length,

            pageCount,
            pages,

            extractedText,
            extractedCharCount:
                extractedText.length,

            emptyPageNumbers,
        };

    } catch (error) {
        // ================== CANCELLED REQUEST ==================
        if (signal?.aborted) {
            throw new ExpressError(
                408,
                "PDF processing cancelled."
            );
        }

        // ================== EXTRACTION TIMEOUT ==================
        if (timedOut) {
            throw new ExpressError(
                408,
                "PDF extraction timed out."
            );
        }

        // ================== KNOWN VALIDATION ERRORS ==================
        if (error instanceof ExpressError) {
            throw error;
        }

        // ================== ENCRYPTED PDF ==================
        if (
            error?.name === "PasswordException" ||
            /password|encrypted/i.test(
                String(error?.message || "")
            )
        ) {
            throw new ExpressError(
                422,
                "Password-protected PDFs are not supported."
            );
        }

        // ================== INVALID PDF ==================
        if (
            [
                "InvalidPDFException",
                "FormatError",
                "MissingPDFException",
            ].includes(error?.name)
        ) {
            throw new ExpressError(
                422,
                "PDF file is damaged or invalid."
            );
        }

        // Unexpected parser errors go to global error handling.
        throw error;

    } finally {
        // ================== RELEASE MEMORY ==================
        clearTimeout(timeout);

        signal?.removeEventListener(
            "abort",
            handleAbort
        );

        await destroyParser();
    }
}

// ================== EXPORTS ==================
module.exports = {
    extractPdf,
};
