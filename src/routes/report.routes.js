const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");

const {
    getAttendanceReport,
    getLeaveReport,
    getPayrollReport,
    getEmployeeStats,
    getMyDashboardStats,
    getHRDashboardStats,
} = require("../controllers/report.controller");


router.get("/attendance", protect, allowRoles("hr", "manager", "superadmin"), getAttendanceReport);
router.get("/leave", protect, allowRoles("hr", "superadmin", "tl"), getLeaveReport);
router.get("/payroll", protect, allowRoles("hr", "manager", "superadmin"), getPayrollReport);
router.get("/employees", protect, allowRoles("hr", "manager", "superadmin"), getEmployeeStats);
router.get("/dashboard", protect, getMyDashboardStats);
router.get("/hr-dashboard", protect, allowRoles("hr", "manager", "superadmin"), getHRDashboardStats);

module.exports = router;