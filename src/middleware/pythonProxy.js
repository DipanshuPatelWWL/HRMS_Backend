const axios = require("axios");

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000";
const PYTHON_API_KEY = process.env.PYTHON_ENGINE_API_KEY || "dev-secret-key-12345";
console.log(PYTHON_URL)

// Reusable axios instance for all Python service calls
const pythonClient = axios.create({
    baseURL: PYTHON_URL,
    timeout: 60000,
    headers: {
        "Content-Type": "application/json",
        "X-API-KEY": PYTHON_API_KEY
    },
});

// Health check — call this on Node startup to confirm Python is reachable
const checkPythonService = async () => {
    try {
        const res = await pythonClient.get("/health");
        if (res.data?.status === "ok") {
            console.log("✅ Python Lead Engine connected →", PYTHON_URL);
        }
    } catch (err) {
        if (err.response?.status === 403) {
            console.error("❌ Python Lead Engine authentication failed — check PYTHON_ENGINE_API_KEY");
        } else {
            console.warn("⚠️  Python Lead Engine not reachable at", PYTHON_URL, "— start it before using lead generation.");
        }
    }
};

module.exports = { pythonClient, checkPythonService };