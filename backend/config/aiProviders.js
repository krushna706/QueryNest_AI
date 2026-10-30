
const AI_PROVIDERS = {
    // ================== GROQ CONFIGURATION ==================
    groq: {
        name: "Groq",
        model: "openai/gpt-oss-120b",
        apiKeyEnv: "GROQ_API_KEY",
    },

    // ================== GEMINI CONFIGURATION ==================
    gemini: {
        name: "Gemini",
        model: "gemini-3.5-flash-lite",
        apiKeyEnv: "GEMINI_API_KEY",
    },
};

// ================== DEFAULT AI PROVIDER ==================
// Prefer Groq for general chat and coding tasks.
// Final provider selection will happen in aiRouter.js.
const DEFAULT_AI_PROVIDER = "groq";

// ================== EMBEDDING CONFIGURATION ==================
// Generate embeddings for document chunks and user questions.
const EMBEDDING_CONFIG = {
    provider: "gemini",
    model: "gemini-embedding-001",
    dimensions: 768,
};

// ================== GET AI PROVIDER CONFIGURATION ==================
// Read and validate credentials only when a provider is needed.
function getAIProviderConfig(provider) {
    const config = AI_PROVIDERS[provider];

    // Reject unsupported AI providers.
    if (!config) {
        throw new Error("Unsupported AI provider.");
    }

    // Read API key from backend environment variables.
    const apiKey = process.env[config.apiKeyEnv]?.trim();

    if (!apiKey) {
        throw new Error(`${config.apiKeyEnv} is missing in environment configuration.`);
    }

    return {
        name: config.name,
        model: config.model,
        apiKey,
    };
}

// ================== EXPORTS ==================
module.exports = {
    AI_PROVIDERS,
    DEFAULT_AI_PROVIDER,
    EMBEDDING_CONFIG,
    getAIProviderConfig,
};
