const { getEncoding } = require("js-tiktoken");

const Document = require("../../models/Document");
const DocumentChunk = require("../../models/DocumentChunk");

// Chunk configuration
const encoder = getEncoding("cl100k_base");

const segmenter = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
});

const { maxTokens, overlapTokens, maxCharacters } = DocumentChunk.CHUNKING_CONFIG;

const MAX_EXTRACTED_CHARACTERS = Document.MAX_EXTRACTED_CHARACTERS;

// Validate configuration
if (
    !Number.isSafeInteger(maxTokens) ||
    !Number.isSafeInteger(overlapTokens) ||
    !Number.isSafeInteger(maxCharacters) ||
    !Number.isSafeInteger(MAX_EXTRACTED_CHARACTERS) ||
    maxTokens < 2 ||
    overlapTokens < 0 ||
    overlapTokens >= maxTokens ||
    maxCharacters < 2 ||
    MAX_EXTRACTED_CHARACTERS < 1
) {
    throw new Error("Invalid document chunking configuration.");
}

// Normalize extracted text
function normalizeText(value) {
    if (typeof value !== "string") {
        throw new Error("Extracted document text must be a string.");
    }

    return value.replace(/\r\n?/g, "\n").replace(/\0/g, "").trim();
}

// Prepare pdf pages
function preparePdfGroups(pages) {
    if (!Array.isArray(pages) || pages.length === 0) {
        throw new Error("PDF pages are required for chunking.");
    }

    const groups = [];
    const seenPages = new Set();

    for (let index = 0; index < pages.length; index++) {
        const page = pages[index];

        const pageNumber = typeof page === "string" ? index + 1 : (page?.pageNumber ?? index + 1);

        const text = normalizeText(typeof page === "string" ? page : page?.text);

        if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || seenPages.has(pageNumber)) {
            throw new Error("Invalid or duplicate PDF page number.");
        }

        seenPages.add(pageNumber);

        if (!text) continue;

        groups.push({
            pageNumber,
            sectionTitle: null,
            units: [
                {
                    text,
                    paragraphNumber: null,
                },
            ],
        });
    }

    return groups;
}

// Prepare docx paragraphs
function prepareDocxGroups(paragraphs) {
    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
        throw new Error("DOCX paragraphs are required for chunking.");
    }

    const groups = [];
    let previousParagraphNumber = 0;

    for (let index = 0; index < paragraphs.length; index++) {
        const paragraph = paragraphs[index];

        const paragraphNumber = typeof paragraph === "string" ? index + 1 : (paragraph?.paragraphNumber ?? index + 1);

        const text = normalizeText(typeof paragraph === "string" ? paragraph : paragraph?.text);

        const sectionTitle =
            typeof paragraph === "string"
                ? null
                : paragraph?.sectionTitle == null
                  ? null
                  : normalizeText(paragraph.sectionTitle);

        if (!Number.isSafeInteger(paragraphNumber) || paragraphNumber <= previousParagraphNumber) {
            throw new Error("DOCX paragraph numbers must be increasing.");
        }

        if (sectionTitle !== null && sectionTitle.length > 250) {
            throw new Error("DOCX section title exceeds the allowed length.");
        }

        previousParagraphNumber = paragraphNumber;

        if (!text) continue;

        const previousGroup = groups[groups.length - 1];

        if (!previousGroup || previousGroup.sectionTitle !== sectionTitle) {
            groups.push({
                pageNumber: null,
                sectionTitle,
                units: [],
            });
        }

        groups[groups.length - 1].units.push({
            text,
            paragraphNumber,
        });
    }

    return groups;
}

// Build source positions
function buildSource(group) {
    const parts = [];
    const ranges = [];

    let offset = 0;

    for (const unit of group.units) {
        if (parts.length) {
            parts.push("\n\n");
            offset += 2;
        }

        const start = offset;

        parts.push(unit.text);
        offset += unit.text.length;

        ranges.push({
            start,
            end: offset,
            paragraphNumber: unit.paragraphNumber,
        });
    }

    return {
        text: parts.join(""),
        ranges,
    };
}

// Grapheme offsets
function getGraphemeOffsets(text) {
    const offsets = [0];

    let position = 0;

    for (const { segment } of segmenter.segment(text)) {
        position += segment.length;
        offsets.push(position);
    }

    return offsets;
}

// Count tokens
function countTokens(text) {
    return encoder.encode(text).length;
}

// Find chunk end
function findChunkEnd(text, offsets, start) {
    let low = start + 1;

    let high = Math.min(offsets.length - 1, start + maxCharacters);

    let best = start;

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);

        const candidate = text.slice(offsets[start], offsets[middle]);

        if (candidate.length <= maxCharacters && countTokens(candidate) <= maxTokens) {
            best = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    if (best === start) {
        throw new Error("Unable to fit document text into a chunk.");
    }

    return best;
}

// Prefer word boundaries
function findNaturalEnd(text, offsets, start, end) {
    const tokenCount = countTokens(text.slice(offsets[start], offsets[end]));

    if (tokenCount < maxTokens * 0.65) {
        return end;
    }

    const minimum = start + Math.floor((end - start) * 0.85);

    for (let index = end - 1; index >= minimum; index--) {
        const current = text.slice(offsets[index], offsets[index + 1]);

        if (/\s|[.!?;।。]/u.test(current)) {
            return index + 1;
        }
    }

    return end;
}

// Find overlap start
function findOverlapStart(text, offsets, start, end) {
    if (overlapTokens === 0) {
        return end;
    }

    let low = start + 1;
    let high = end - 1;
    let best = end;

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);

        const suffix = text.slice(offsets[middle], offsets[end]);

        if (countTokens(suffix) <= overlapTokens) {
            best = middle;
            high = middle - 1;
        } else {
            low = middle + 1;
        }
    }

    return best;
}

// Chunk source group
function chunkSourceGroup(group, fileType, nextIndex) {
    const { text, ranges } = buildSource(group);
    const offsets = getGraphemeOffsets(text);

    const chunks = [];
    let start = 0;

    while (start < offsets.length - 1) {
        const maxEnd = findChunkEnd(text, offsets, start);

        const end = findNaturalEnd(text, offsets, start, maxEnd);

        const startOffset = offsets[start];
        const endOffset = offsets[end];

        const chunkText = text.slice(startOffset, endOffset).trim();

        if (chunkText) {
            const matched = ranges.filter((range) => range.start < endOffset && range.end > startOffset);

            if (!matched.length) {
                throw new Error("Chunk source reference could not be resolved.");
            }

            const tokenCount = countTokens(chunkText);

            if (tokenCount < 1 || tokenCount > maxTokens || chunkText.length > maxCharacters) {
                throw new Error("Document chunk exceeds allowed limits.");
            }

            chunks.push({
                chunkIndex: nextIndex + chunks.length,

                fileType,
                text: chunkText,
                tokenCount,

                pageNumber: group.pageNumber,
                sectionTitle: group.sectionTitle,

                paragraphStart: fileType === "docx" ? matched[0].paragraphNumber : null,

                paragraphEnd: fileType === "docx" ? matched[matched.length - 1].paragraphNumber : null,
            });
        }

        if (end === offsets.length - 1) {
            break;
        }

        const overlapStart = findOverlapStart(text, offsets, start, end);

        // Always move forward to avoid infinite loops.
        start = overlapStart > start ? overlapStart : end;
    }

    return {
        chunks,
        extractedCharCount: text.length,
        extractedTokenCount: countTokens(text),
    };
}

// Chunk document text
// PDF: pages = [{ pageNumber: 1, text: "..." }]
// DOCX: paragraphs = [{
//     paragraphNumber: 1,
//     sectionTitle: "Skills",
//     text: "..."
// }]
function chunkDocumentText({ fileType, pages, paragraphs } = {}) {
    if (!["pdf", "docx"].includes(fileType)) {
        throw new Error("Only PDF and DOCX files are supported.");
    }

    const groups = fileType === "pdf" ? preparePdfGroups(pages) : prepareDocxGroups(paragraphs);

    if (!groups.length) {
        throw new Error("Document contains no extractable text.");
    }

    const results = groups.map(buildSource);

    const extractedCharCount = results.reduce((sum, result) => sum + result.text.length, 0);

    if (extractedCharCount > MAX_EXTRACTED_CHARACTERS) {
        throw new Error("Extracted document text exceeds the allowed limit.");
    }

    const chunks = [];
    let extractedTokenCount = 0;

    for (const group of groups) {
        const result = chunkSourceGroup(group, fileType, chunks.length);

        chunks.push(...result.chunks);

        extractedTokenCount += result.extractedTokenCount;
    }

    if (!chunks.length) {
        throw new Error("Document contains no indexable text.");
    }

    return {
        chunks,
        chunkCount: chunks.length,
        extractedCharCount,
        extractedTokenCount,
    };
}

// Exports
module.exports = {
    chunkDocumentText,
};
