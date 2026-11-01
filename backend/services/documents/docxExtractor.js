const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

const Document = require("../../models/Document");
const ExpressError = require("../../utils/ExpressError");

const { APP_USAGE_LIMITS } = require("../../config/usageLimits");

// Docx settings
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const MAX_FILE_SIZE = APP_USAGE_LIMITS.maxPdfSizeBytes;

const MAX_EXTRACTED_CHARACTERS = Document.MAX_EXTRACTED_CHARACTERS;

const EXTRACTION_TIMEOUT_MS = 30000;

// Isolated docx parser
if (!isMainThread && workerData?.task === "querynest-docx-extract") {
    (async () => {
        const mammoth = require("mammoth");

        const buffer = Buffer.from(workerData.buffer);

        const result = await mammoth.extractRawText({
            buffer,
        });

        if (typeof result.value !== "string") {
            throw new Error("INVALID_DOCX");
        }

        const normalized = result.value.replace(/\r\n?/g, "\n").replace(/\0/g, "");

        const paragraphs = normalized
            .split("\n\n")
            .map((text, index) => ({
                paragraphNumber: index + 1,
                sectionTitle: null,

                text: text
                    .split("\n")
                    .map((line) => line.replace(/[ \t]+/g, " ").trim())
                    .filter(Boolean)
                    .join("\n")
                    .trim(),
            }))
            .filter((paragraph) => paragraph.text);

        const contents = paragraphs.map((paragraph) => paragraph.text);

        const extractedText = contents.join("\n\n");

        if (!extractedText) {
            parentPort.postMessage({
                ok: false,
                code: "NO_TEXT",
            });

            return;
        }

        if (extractedText.length > workerData.maxCharacters) {
            parentPort.postMessage({
                ok: false,
                code: "TEXT_TOO_LARGE",
            });

            return;
        }

        parentPort.postMessage({
            ok: true,
            paragraphs,
            extractedText,
        });
    })().catch(() => {
        parentPort.postMessage({
            ok: false,
            code: "INVALID_DOCX",
        });
    });
}

// Validate docx file
async function validateDocxBuffer(buffer, fileName) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new ExpressError(400, "A valid DOCX file is required.");
    }

    if (buffer.length > MAX_FILE_SIZE) {
        throw new ExpressError(413, "DOCX file size must not exceed 5 MB.");
    }

    if (typeof fileName !== "string" || !/\.docx$/i.test(fileName.trim())) {
        throw new ExpressError(415, "Only .docx Word documents are supported.");
    }

    const { fileTypeFromBuffer } = await import("file-type");

    const detected = await fileTypeFromBuffer(buffer);

    const recognizedDocx = detected?.mime === DOCX_MIME && detected?.ext === "docx";

    // DOCX is ZIP-based. Some detectors return ZIP.
    // Word structure is checked by the DOCX extractor.
    const possibleDocxArchive = detected?.mime === "application/zip" && detected?.ext === "zip";

    if (!recognizedDocx && !possibleDocxArchive) {
        throw new ExpressError(415, "File content is not a supported DOCX document.");
    }

    // Mammoth also validates Word document structure.
}

// Process docx in worker
function parseDocxInWorker(buffer, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new ExpressError(408, "DOCX processing cancelled."));

            return;
        }

        const worker = new Worker(__filename, {
            workerData: {
                task: "querynest-docx-extract",
                buffer,
                maxCharacters: MAX_EXTRACTED_CHARACTERS,
            },

            resourceLimits: {
                maxOldGenerationSizeMb: 128,
                maxYoungGenerationSizeMb: 32,
            },
        });

        let settled = false;

        const onAbort = () => finish(new ExpressError(408, "DOCX processing cancelled."));

        const timeout = setTimeout(() => {
            finish(new ExpressError(408, "DOCX extraction timed out."));
        }, EXTRACTION_TIMEOUT_MS);

        function finish(error, value) {
            if (settled) return;

            settled = true;

            clearTimeout(timeout);

            signal?.removeEventListener("abort", onAbort);

            worker.removeAllListeners();

            void worker.terminate().catch(() => {});

            if (error) {
                reject(error);
            } else {
                resolve(value);
            }
        }

        worker.on("message", (message) => {
            if (message?.ok === true) {
                finish(null, message);
            } else if (message?.code === "TEXT_TOO_LARGE") {
                finish(new ExpressError(413, "Extracted DOCX text exceeds the allowed limit."));
            } else if (message?.code === "NO_TEXT") {
                finish(new ExpressError(422, "DOCX contains no readable text."));
            } else {
                finish(new ExpressError(422, "DOCX file is damaged, encrypted, or unsupported."));
            }
        });

        worker.on("error", () => {
            finish(new ExpressError(422, "DOCX extraction failed."));
        });

        worker.on("exit", () => {
            finish(new ExpressError(422, "DOCX extraction exceeded resource limits."));
        });

        signal?.addEventListener("abort", onAbort, { once: true });

        if (signal?.aborted) {
            onAbort();
        }
    });
}

// Extract docx text
async function extractDocx(buffer, { fileName, signal } = {}) {
    if (signal?.aborted) {
        throw new ExpressError(408, "DOCX processing cancelled.");
    }

    await validateDocxBuffer(buffer, fileName);

    if (signal?.aborted) {
        throw new ExpressError(408, "DOCX processing cancelled.");
    }

    const result = await parseDocxInWorker(buffer, signal);

    return {
        fileType: "docx",
        mimeType: DOCX_MIME,
        sizeBytes: buffer.length,

        // DOCX does not have reliable page numbers.
        pageCount: null,

        paragraphs: result.paragraphs,
        paragraphCount: result.paragraphs.length,

        extractedText: result.extractedText,

        extractedCharCount: result.extractedText.length,
    };
}

// Exports
module.exports = {
    extractDocx,
};
