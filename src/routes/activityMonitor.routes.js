const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");

const {
    logActivity,
    getDailyReport,
    getLiveStatus,
    getAppUsage,
    getMyActivity,
    getAppDetailReport,
    requestCapture,
    uploadCapture,
    getCaptureHistory,
} = require("../controllers/activityMonitor.controller");

// ── Electron desktop agent ────────────────────────────────────────────
// Called by the Electron app every 30 seconds with activity batch
router.post(
    "/log",
    protect,
    allowRoles("employee", "tl", "manager", "hr", "superadmin"),
    logActivity
);

// ── Employee: view own activity ───────────────────────────────────────
router.get(
    "/my-activity",
    protect,
    allowRoles("employee", "tl", "manager", "hr", "superadmin"),
    getMyActivity
);

// ── Admin / HR: live dashboard ────────────────────────────────────────
// Returns current active app for every punched-in employee
router.get(
    "/live",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getLiveStatus
);

// ── Admin / HR: daily full report for one employee ───────────────────
// GET /api/activity-monitor/report/:userId?date=YYYY-MM-DD
router.get(
    "/report/:userId",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getDailyReport
);

// ── Admin / HR: app usage breakdown for one employee ─────────────────
// GET /api/activity-monitor/app-usage/:userId?date=YYYY-MM-DD
router.get(
    "/app-usage/:userId",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getAppUsage
);

router.get(
    "/app-detail/:userId",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getAppDetailReport
);


// ── HR: trigger remote capture ────────────────────────────────────────
router.post(
    "/capture-request/:userId",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    requestCapture
);

// ── Electron: upload captured images ─────────────────────────────────
router.post(
    "/capture-upload",
    protect,
    allowRoles("employee", "tl", "manager", "hr", "superadmin"),
    uploadCapture
);

// ── HR: get capture history for employee ─────────────────────────────
router.get(
    "/captures/:userId",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getCaptureHistory
);


module.exports = router;