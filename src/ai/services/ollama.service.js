// ─── src/ai/services/ollama.service.js ───────────────────────────────────────

const axios = require("axios");
const SYSTEM_PROMPT = require("../prompts/system.prompt");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/chat";
const MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";
const TIMEOUT_MS = 12_000;

/**
 * Sends a question + context to Ollama and returns the model's reply.
 *
 * @param {string} question  - The raw user question
 * @param {string} context   - Pre-built context string (employee data, company info, etc.)
 * @returns {Promise<string>}
 */
const askOllama = async (question, context = "") => {
    const response = await axios.post(
        OLLAMA_URL,
        {
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content: SYSTEM_PROMPT,
                },
                {
                    role: "user",
                    content:
                        `=== PROVIDED CONTEXT ===\n${context}\n\n` +
                        `=== EMPLOYEE QUESTION ===\n${question}`,
                },
            ],
            stream: false,
        },
        { timeout: TIMEOUT_MS }
    );

    return response.data?.message?.content || "I couldn't generate a response.";
};

module.exports = askOllama;