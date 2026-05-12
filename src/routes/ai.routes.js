// ─── routes/ai.routes.js ─────────────────────────────────────────────────────

const express = require("express");
const router = express.Router();
const protect = require("../middleware/auth.middleware");
const aiRateLimit = require("../middleware/aiRateLimit");
const { askAI } = require("../controllers/ai.controller");

// Auth → Rate limit → Handler
router.post("/ask", protect, aiRateLimit, askAI);

module.exports = router;