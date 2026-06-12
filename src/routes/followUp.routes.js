// followUp.routes.js

const express = require("express");
const router = express.Router();
const protect = require("../middleware/auth.middleware");
const {
    getFollowUps,
    completeFollowUp,
    snoozeFollowUp,
    addFollowUpDate,
    getFollowUpStats,
} = require("../controllers/followUp.controller");

router.use(protect);

// ── Follow-up dashboard ───────────────────────────────────────────────────────
router.get("/", getFollowUps);
router.get("/stats", getFollowUpStats);

// ── Per-lead follow-up actions ────────────────────────────────────────────────
router.post("/leads/:id/follow-up/complete", completeFollowUp);
router.post("/leads/:id/follow-up/snooze", snoozeFollowUp);
router.post("/leads/:id/follow-up/add", addFollowUpDate);

module.exports = router;