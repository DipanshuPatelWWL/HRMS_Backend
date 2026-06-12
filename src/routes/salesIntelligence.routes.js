const express = require("express");
const router = express.Router();
const protect = require("../middleware/auth.middleware");
const {
    getLeads, getLeadById, createLead,
    generateLeads, updateLead, deleteLead, getStats,
    rescoreLead, rescoreAll,
    generateEmail, saveEmailDraft,
    generateProposal,
} = require("../controllers/salesIntelligence.controller");
const { analyzeWebsite, getWebsiteAnalysis, getTalkingPoints } = require("../controllers/websiteAnalysis.controller");
const { getDashboardStats } = require("../controllers/dashboardStats.controller");

router.use(protect);

// ── Stats ─────────────────────────────────────────────────────────────────────
router.get("/stats", getStats);

// ── Generation ────────────────────────────────────────────────────────────────
router.post("/leads/generate", generateLeads);
router.post("/leads/rescore-all", rescoreAll);

// ── Lead CRUD ─────────────────────────────────────────────────────────────────
router.get("/leads", getLeads);
router.get("/leads/:id", getLeadById);
router.post("/leads", createLead);
router.patch("/leads/:id", updateLead);
router.delete("/leads/:id", deleteLead);

// ── Per-lead scoring ──────────────────────────────────────────────────────────
router.post("/leads/:id/rescore", rescoreLead);

// ──  Email draft ────────────────────────────────────────────────────────
router.post("/leads/:id/generate-email", generateEmail);
router.patch("/leads/:id/email-draft", saveEmailDraft);
router.post("/leads/:id/generate-proposal", generateProposal);


// ── Website analysis ──────────────────
router.post("/leads/:id/analyze-website", analyzeWebsite);
router.get("/leads/:id/website-analysis", getWebsiteAnalysis);
router.post("/leads/:id/talking-points", getTalkingPoints);

// ── Website analysis ──────────────────
router.get("/dashboard", getDashboardStats);

module.exports = router;