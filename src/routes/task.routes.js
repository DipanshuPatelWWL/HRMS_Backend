const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");

const {
    createTask,
    getMyTasks,
    getDepartmentTasks,
    getDepartmentMembers,
    getAllTasks,
    getAllDepartments,
    getSingleTask,
    updateTaskStatus,
    updateTask,
    deleteTask,
    getTaskStats,
    getDeptStats,
} = require("../controllers/task.controller");

// ── Stats ────────────────────────────────────────────────────────────────────
// HR / Manager / Superadmin — global stats with optional ?department= filter
router.get(
    "/stats",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getTaskStats
);

// TL — stats for their own department only
router.get(
    "/dept-stats",
    protect,
    allowRoles("tl"),
    getDeptStats
);

// ── Department helpers (TL) ──────────────────────────────────────────────────
// Returns list of users in TL's department (to populate assignee dropdown)
router.get(
    "/dept-members",
    protect,
    allowRoles("tl"),
    getDepartmentMembers
);

// TL views all tasks inside their department
router.get(
    "/department",
    protect,
    allowRoles("tl"),
    getDepartmentTasks
);

// ── HR helpers ───────────────────────────────────────────────────────────────
// Distinct departments list (for HR filter dropdown)
router.get(
    "/departments",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getAllDepartments
);

// ── Create ───────────────────────────────────────────────────────────────────
// HR / Manager / TL / Superadmin can create; TL is dept-restricted in controller
router.post(
    "/",
    protect,
    allowRoles("hr", "manager", "tl", "superadmin"),
    createTask
);

// ── Read ─────────────────────────────────────────────────────────────────────
// My tasks — every logged-in role can see tasks assigned to themselves
router.get(
    "/my",
    protect,
    allowRoles("employee", "tl", "manager", "hr", "superadmin"),
    getMyTasks
);

// All tasks — HR / Manager / Superadmin (supports ?department= filter)
router.get(
    "/",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getAllTasks
);

// Single task — all roles (controller enforces visibility rules)
router.get(
    "/:id",
    protect,
    getSingleTask
);

// ── Update ───────────────────────────────────────────────────────────────────
// Employee / TL update their own task status + work report
router.put(
    "/:id/status",
    protect,
    allowRoles("employee", "tl", "manager", "hr", "superadmin"),
    updateTaskStatus
);

// Full update — HR / Manager / TL / Superadmin (TL dept-restricted in controller)
router.put(
    "/:id",
    protect,
    allowRoles("hr", "manager", "tl", "superadmin"),
    updateTask
);

// ── Delete ───────────────────────────────────────────────────────────────────
// HR / Manager / TL / Superadmin (TL dept-restricted in controller)
router.delete(
    "/:id",
    protect,
    allowRoles("hr", "manager", "tl", "superadmin"),
    deleteTask
);

module.exports = router;