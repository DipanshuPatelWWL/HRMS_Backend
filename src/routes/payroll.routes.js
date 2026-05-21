const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");

const {
    generatePayroll,
    getAllPayrolls,
    markAsPaid,
    bulkMarkPaid,
    deletePayroll,
    getMyPayrolls,
    getPayroll,
    getPayrollStats,
    releasePayroll
} = require("../controllers/payroll.controller");

// ── Employee ─────────────────────────────────────────────
// Employee views own paid payslips
router.get(
    "/my",
    protect,
    allowRoles("employee", "tl", "manager", "hr", "superadmin"),
    getMyPayrolls
);

// ── HR / SuperAdmin ───────────────────────────────────────
// Summary stats for dashboard
router.get(
    "/stats",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getPayrollStats
);

// List all payrolls (with optional month/year/status filter)
router.get(
    "/all",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getAllPayrolls
);

// Generate payroll for one or all employees
router.post(
    "/generate",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    generatePayroll
);

router.put(
    "/bulk-mark-paid",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    bulkMarkPaid
);

// Mark single payroll as paid
router.put(
    "/:id/mark-paid",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    markAsPaid
);

// Delete draft payroll
router.delete(
    "/:id",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    deletePayroll
);

// Get single payroll (HR or owner)
router.get(
    "/:id",
    protect,
    allowRoles("employee", "tl", "manager", "hr", "superadmin"),
    getPayroll
);

router.put(
    "/:id/release",
    protect,
    allowRoles("hr", "manager"),
    releasePayroll
);

module.exports = router;