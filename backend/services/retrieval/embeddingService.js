
const { GoogleGenAI } = require("@google/genai");
const { getEncoding } = require("js-tiktoken");
const { setTimeout: delay } = require("node:timers/promises");

const {
    EMBEDDING_CONFIG,
    getAIProviderConfig,
} = require("../../config/aiProviders");

// ================== EMBEDDING SETTINGS ==================
const EMBEDDING_BATCH_SIZE = 8;
const MAX_INPUT_TOKENS = 1800;
const MAX_TEXT_CHARACTERS = 8000;
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 30000;

const encoder = getEncoding("cl100k_base");

// ================== VALIDATE EMBEDDING CONFIG ==================
function validateEmbeddingConfig() {
    if (
        EMBEDDING_CONFIG.model !== "gemini-embedding-001" ||
        !Number.isSafeInteger(EMBEDDING_CONFIG.dimensions) ||
        EMBEDDING_CONFIG.dimensions !== 768
    ) {
        throw new Error(
            "Unsupported document embedding configuration."
        );
    }
}

// ================== VALIDATE INPUT TEXT ==================
function validateText(text) {
    if (
        typeof text !== "string" ||
        !text.trim()
    ) {
        throw new Error(
            "Embedding text cannot be empty."
        );
    }

    const value = text.trim();

    if (
        value.length > MAX_TEXT_CHARACTERS ||
        encoder.encode(value).length > MAX_INPUT_TOKENS
    ) {
        throw new Error(
            "Embedding text exceeds the supported limit."
        );
    }

    return value;
}

// ================== NORMALIZE EMBEDDING ==================
function normalizeEmbedding(values) {
    if (
        !Array.isArray(values) ||
        values.length !== EMBEDDING_CONFIG.dimensions ||
        !values.every(Number.isFinite)
    ) {
        throw new Error(
            "Gemini returned an invalid embedding vector."
        );
    }

    const magnitude = Math.sqrt(
        values.reduce(
            (sum, value) => sum + value * value,
            0
        )
    );

    if (
        !Number.isFinite(magnitude) ||
        magnitude <= 0
    ) {
        throw new Error(
            "Gemini returned an empty embedding vector."
        );
    }

    return values.map(
        (value) => value / magnitude
    );
}

// ================== RETRYABLE API ERRORS ==================
function isRetryableError(error) {
    const status = Number(
        error?.status ??
        error?.statusCode ??
        error?.response?.status
    );

    return (
        status === 408 ||
        status === 429 ||
        (status >= 500 && status <= 599)
    );
}

// ================== CALL GEMINI EMBEDDINGS ==================
async function requestEmbeddings({
    texts,
    taskType,
    title,
    signal,
}) {
    validateEmbeddingConfig();

    if (signal?.aborted) {
        throw new Error(
            "Document processing cancelled."
        );
    }

    // ================== INITIALIZE GEMINI ==================
    const { apiKey } = getAIProviderConfig("gemini");

    const client = new GoogleGenAI({
        apiKey,
    });

    // ================== REQUEST CONFIGURATION ==================
    const config = {
        taskType,
        outputDimensionality:
            EMBEDDING_CONFIG.dimensions,
        abortSignal: signal,
        httpOptions: {
            timeout: REQUEST_TIMEOUT_MS,
        },
    };

    if (
        taskType === "RETRIEVAL_DOCUMENT" &&
        title
    ) {
        config.title = title;
    }

    let lastError;

    // ================== RETRY REQUEST ==================
    for (
        let attempt = 0;
        attempt <= MAX_RETRIES;
        attempt++
    ) {
        if (signal?.aborted) {
            throw new Error(
                "Document processing cancelled."
            );
        }

        try {
            const response =
                await client.models.embedContent({
                    model: EMBEDDING_CONFIG.model,
                    contents: texts,
                    config,
                });

            // ================== VALIDATE RESPONSE ==================
            if (
                !Array.isArray(response?.embeddings) ||
                response.embeddings.length !== texts.length
            ) {
                throw new Error(
                    "Gemini returned an incomplete embedding batch."
                );
            }

            // ================== NORMALIZE VECTORS ==================
            return response.embeddings.map(
                (item) =>
                    normalizeEmbedding(item?.values)
            );

        } catch (error) {
            lastError = error;

            if (
                signal?.aborted ||
                !isRetryableError(error) ||
                attempt === MAX_RETRIES
            ) {
                throw error;
            }

            // ================== RETRY DELAY ==================
            await delay(
                1000 * 2 ** attempt,
                undefined,
                { signal }
            );
        }
    }

    throw lastError;
}

// ================== EMBED DOCUMENT CHUNKS ==================
async function embedDocumentChunks(
    chunks,
    { title, signal } = {}
) {
    // ================== VALIDATE CHUNKS ==================
    if (
        !Array.isArray(chunks) ||
        chunks.length === 0
    ) {
        throw new Error(
            "Document chunks are required."
        );
    }

    if (
        title != null &&
        (
            typeof title !== "string" ||
            title.length > 255
        )
    ) {
        throw new Error(
            "Invalid document title."
        );
    }

    const texts = chunks.map(
        (chunk) => validateText(chunk?.text)
    );

    const embeddings = [];

    // ================== PROCESS CHUNKS IN BATCHES ==================
    for (
        let index = 0;
        index < texts.length;
        index += EMBEDDING_BATCH_SIZE
    ) {
        const batch = texts.slice(
            index,
            index + EMBEDDING_BATCH_SIZE
        );

        const vectors = await requestEmbeddings({
            texts: batch,
            taskType: "RETRIEVAL_DOCUMENT",
            title: title?.trim() || undefined,
            signal,
        });

        embeddings.push(...vectors);
    }

    // ================== ATTACH EMBEDDINGS ==================
    return chunks.map((chunk, index) => ({
        ...chunk,
        embeddingModel: EMBEDDING_CONFIG.model,
        embedding: embeddings[index],
    }));
}

// ================== EMBED SEARCH QUERY ==================
async function embedSearchQuery(
    query,
    { signal } = {}
) {
    const text = validateText(query);

    const [vector] = await requestEmbeddings({
        texts: [text],
        taskType: "RETRIEVAL_QUERY",
        signal,
    });

    return vector;
}

// ================== EXPORTS ==================
module.exports = {
    embedDocumentChunks,
    embedSearchQuery,
};
