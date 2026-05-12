const axios = require("axios");

const EMBEDDING_URL = process.env.OLLAMA_URL
    ? process.env.OLLAMA_URL.replace("/api/chat", "/api/embeddings")
    : "http://localhost:11434/api/embeddings";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "nomic-embed-text";

/**
 * Returns a numeric embedding vector for the given text.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
const generateEmbedding = async (text) => {
    const response = await axios.post(EMBEDDING_URL, {
        model: EMBEDDING_MODEL,
        prompt: text,
    });
    return response.data.embedding;
};

/**
 * Cosine similarity between two equal-length numeric arrays.
 * Returns a value between -1 and 1 (1 = identical direction).
 */
const cosineSimilarity = (a, b) => {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
};

module.exports = { generateEmbedding, cosineSimilarity };