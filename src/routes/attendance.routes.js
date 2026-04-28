const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");

const {
    punchIn,
    punchOut,
    overrideAttendance,
    getTodayAttendance,
    getMonthlyAttendance,
    getWeeklyAttendanceSummary
} = require("../controllers/attendance.controller");

router.post(
    "/punch-in",
    protect,
    allowRoles("employee", "tl", "manager", "hr"),
    punchIn
);

router.post(
    "/punch-out",
    protect,
    allowRoles("employee", "tl", "manager", "hr"),
    punchOut
);

router.put(
    "/override/:id",
    protect,
    allowRoles("hr", "superadmin"),
    overrideAttendance
);

router.get("/today", protect, getTodayAttendance);
router.get("/monthly", protect, getMonthlyAttendance);
router.get("/weekly-summary", protect, allowRoles("hr", "superadmin"), getWeeklyAttendanceSummary);

module.exports = router;