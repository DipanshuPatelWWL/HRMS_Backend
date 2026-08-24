const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");

const {
    applyCorrection,
    getMyCorrections,
    getAllCorrections,
    reviewCorrection,
    deleteCorrection,
    getCorrectionStats,
} = require("../controllers/attendanceCorrection.controller");

// ── Stats — HR only ───────────────────────────────────────────────────────────
router.get(
    "/stats",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getCorrectionStats
);

// ── Submit a correction request (any employee / tl / manager) ─────────────────
router.post(
    "/",
    protect,
    allowRoles("employee", "tl", "manager", "hr", "superadmin"),
    applyCorrection
);

// ── My requests — employee self-view ─────────────────────────────────────────
router.get(
    "/my",
    protect,
    allowRoles("employee", "tl", "manager", "hr", "superadmin"),
    getMyCorrections
);

// ── All requests — HR / Manager ───────────────────────────────────────────────
router.get(
    "/",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getAllCorrections
);

// ── HR reviews (approve or reject) ───────────────────────────────────────────
router.put(
    "/:id/review",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    reviewCorrection
);

// ── Delete a request ──────────────────────────────────────────────────────────
router.delete(
    "/:id",
    protect,
    deleteCorrection
);

module.exports = router;