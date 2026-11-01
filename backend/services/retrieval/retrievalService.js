const mongoose = require("mongoose");

const Document = require("../../models/Document");
const DocumentChunk = require("../../models/DocumentChunk");
const ExpressError = require("../../utils/ExpressError");

const { embedSearchQuery } = require("./embeddingService");

// Retrieval settings
const MAX_DOCUMENTS = 3;
const MAX_QUERY_CHARACTERS = 6000;
const MAX_RESULTS = 8;
const DEFAULT_RESULTS = 6;

const MAX_CONTEXT_TOKENS = 3200;
const SOURCE_OVERHEAD_TOKENS = 50;

const SEARCH_TIMEOUT_MS = 15000;

// Validate object id
function parseObjectId(value, fieldName) {
    const id = value instanceof mongoose.Types.ObjectId ? value.toHexString() : value;

    if (typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id)) {
        throw new ExpressError(400, `Invalid ${fieldName}.`);
    }

    return new mongoose.Types.ObjectId(id);
}

// Validate query
function validateQuery(query) {
    if (typeof query !== "string") {
        throw new ExpressError(400, "Document search query is required.");
    }

    const normalized = query.replace(/\s+/g, " ").trim();

    if (!normalized || normalized.length > MAX_QUERY_CHARACTERS) {
        throw new ExpressError(400, "Invalid document search query length.");
    }

    return normalized;
}

// Validate document ids
function validateDocumentIds(documentIds) {
    if (!Array.isArray(documentIds)) {
        throw new ExpressError(400, "Document IDs must be an array.");
    }

    if (documentIds.length > MAX_DOCUMENTS) {
        throw new ExpressError(400, "Too many documents selected.");
    }

    const uniqueIds = new Map();

    for (const value of documentIds) {
        const id = parseObjectId(value, "document ID");

        uniqueIds.set(id.toHexString(), id);
    }

    return [...uniqueIds.values()];
}

// Validate result limit
function validateResultLimit(topK) {
    if (!Number.isSafeInteger(topK) || topK < 1 || topK > MAX_RESULTS) {
        throw new ExpressError(400, "Invalid document search result limit.");
    }

    return topK;
}

// Load accessible documents
async function getReadyDocuments({ userId, conversationId, documentIds }) {
    const filter = {
        userId,
        conversationId,
        status: "ready",
    };

    if (documentIds.length) {
        filter._id = {
            $in: documentIds,
        };
    }

    const documents = await Document.find(filter)
        .select("_id originalName fileType")
        .sort({ createdAt: -1, _id: -1 })
        .limit(MAX_DOCUMENTS + 1)
        .lean();

    if (documentIds.length && documents.length !== documentIds.length) {
        throw new ExpressError(404, "One or more documents are unavailable.");
    }

    if (!documents.length) {
        throw new ExpressError(409, "No processed documents are available in this conversation.");
    }

    if (documents.length > MAX_DOCUMENTS) {
        throw new ExpressError(409, "Conversation exceeds the supported document limit.");
    }

    return documents;
}

// Source label
function createSourceLabel({ fileName, fileType, pageNumber, sectionTitle, paragraphStart, paragraphEnd }) {
    if (fileType === "pdf" && Number.isSafeInteger(pageNumber)) {
        return `${fileName} — Page ${pageNumber}`;
    }

    if (fileType === "docx") {
        const location = [];

        if (sectionTitle) {
            location.push(sectionTitle);
        }

        if (Number.isSafeInteger(paragraphStart)) {
            const paragraphLabel =
                paragraphEnd > paragraphStart
                    ? `Paragraphs ${paragraphStart}-${paragraphEnd}`
                    : `Paragraph ${paragraphStart}`;

            location.push(paragraphLabel);
        }

        return location.length ? `${fileName} — ${location.join(", ")}` : fileName;
    }

    return fileName;
}

// Format search matches
function formatSearchResults(matches, documents, userId, conversationId, topK) {
    const documentMap = new Map(documents.map((document) => [String(document._id), document]));

    const chunks = [];
    const sources = [];

    let usedContextTokens = 0;

    for (const match of matches) {
        if (chunks.length >= topK) {
            break;
        }

        if (String(match.userId) !== String(userId) || String(match.conversationId) !== String(conversationId)) {
            continue;
        }

        const document = documentMap.get(String(match.documentId));

        if (!document) {
            continue;
        }

        if (
            typeof match.text !== "string" ||
            !match.text.trim() ||
            !Number.isSafeInteger(match.tokenCount) ||
            match.tokenCount < 1 ||
            !Number.isFinite(match.score)
        ) {
            continue;
        }

        const requiredTokens = match.tokenCount + SOURCE_OVERHEAD_TOKENS;

        if (usedContextTokens + requiredTokens > MAX_CONTEXT_TOKENS) {
            continue;
        }

        const fileName = String(document.originalName)
            .replace(/[\r\n\t]/g, " ")
            .trim();

        const fileType = document.fileType;

        const pageNumber = fileType === "pdf" ? (match.pageNumber ?? null) : null;

        const sectionTitle = fileType === "docx" ? (match.sectionTitle ?? null) : null;

        const paragraphStart = fileType === "docx" ? (match.paragraphStart ?? null) : null;

        const paragraphEnd = fileType === "docx" ? (match.paragraphEnd ?? null) : null;

        const citationId = `S${chunks.length + 1}`;

        const label = createSourceLabel({
            fileName,
            fileType,
            pageNumber,
            sectionTitle,
            paragraphStart,
            paragraphEnd,
        });

        const source = {
            citationId,
            chunkId: String(match._id),
            documentId: String(document._id),
            fileName,
            fileType,
            label,
            pageNumber,
            sectionTitle,
            paragraphStart,
            paragraphEnd,
            score: match.score,
            text: match.text.trim(),
        };

        chunks.push({
            sourceId: citationId,
            documentId: source.documentId,
            chunkId: source.chunkId,
            text: source.text,
            tokenCount: match.tokenCount,
            score: match.score,
            source,
        });

        sources.push(source);

        usedContextTokens += requiredTokens;
    }

    return {
        chunks,
        sources,
        usedContextTokens,
    };
}

// Build ai document context
function buildDocumentContext(chunks) {
    if (!chunks.length) {
        return "";
    }

    return chunks
        .map((chunk) => {
            const { source } = chunk;

            const reference = {
                citationId: source.citationId,
                fileName: source.fileName,
                fileType: source.fileType,
                pageNumber: source.pageNumber,
                sectionTitle: source.sectionTitle,
                paragraphStart: source.paragraphStart,
                paragraphEnd: source.paragraphEnd,
            };

            // JSON encoding keeps source boundaries explicit.
            return [
                `[${chunk.sourceId}]`,
                `Source: ${JSON.stringify(reference)}`,
                `Content: ${JSON.stringify(chunk.text)}`,
            ].join("\n");
        })
        .join("\n\n");
}

// Retrieve document context
async function retrieveDocumentContext({
    userId,
    conversationId,
    query,
    documentIds = [],
    topK = DEFAULT_RESULTS,
    signal,
} = {}) {
    const ownerId = parseObjectId(userId, "user ID");

    const chatId = parseObjectId(conversationId, "conversation ID");

    const searchQuery = validateQuery(query);

    const selectedIds = validateDocumentIds(documentIds);

    const resultLimit = validateResultLimit(topK);

    if (signal?.aborted) {
        throw new Error("Document retrieval cancelled.");
    }

    const documents = await getReadyDocuments({
        userId: ownerId,
        conversationId: chatId,
        documentIds: selectedIds,
    });

    const queryVector = await embedSearchQuery(searchQuery, { signal });

    if (signal?.aborted) {
        throw new Error("Document retrieval cancelled.");
    }

    const allowedDocumentIds = documents.map((document) => document._id);

    // Fetch extra matches so token-budget filtering
    // does not unnecessarily reduce final results.
    const fetchLimit = Math.min(resultLimit * 2, MAX_RESULTS * 2);

    const numCandidates = Math.max(100, fetchLimit * 12);

    const pipeline = [
        {
            $vectorSearch: {
                index: DocumentChunk.VECTOR_INDEX_NAME,
                path: "embedding",
                queryVector,
                numCandidates,
                limit: fetchLimit,

                filter: {
                    userId: ownerId,
                    conversationId: chatId,
                    documentId: {
                        $in: allowedDocumentIds,
                    },
                },
            },
        },

        {
            $project: {
                _id: 1,
                userId: 1,
                conversationId: 1,
                documentId: 1,
                fileType: 1,
                chunkIndex: 1,
                text: 1,
                tokenCount: 1,
                pageNumber: 1,
                sectionTitle: 1,
                paragraphStart: 1,
                paragraphEnd: 1,

                score: {
                    $meta: "vectorSearchScore",
                },
            },
        },
    ];

    const matches = await DocumentChunk.aggregate(pipeline)
        .option({
            maxTimeMS: SEARCH_TIMEOUT_MS,
        })
        .exec();

    if (signal?.aborted) {
        throw new Error("Document retrieval cancelled.");
    }

    const result = formatSearchResults(matches, documents, ownerId, chatId, resultLimit);

    return {
        query: searchQuery,
        documentIds: documents.map((document) => String(document._id)),
        chunks: result.chunks,
        sources: result.sources,
        contextText: buildDocumentContext(result.chunks),
        estimatedContextTokens: result.usedContextTokens,
        hasRelevantContext: result.chunks.length > 0,
    };
}

// Exports
module.exports = {
    retrieveDocumentContext,
};
