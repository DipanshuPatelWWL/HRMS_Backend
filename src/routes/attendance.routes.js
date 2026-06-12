const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");

const {
    punchIn,
    punchOut,
    getTodayAttendance,
    getMonthlyAttendance,
    getWeeklyAttendanceSummary,
    getTeamAttendance,
    getHRAttendanceOverview,
    getDayWiseAttendance
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


router.get("/today", protect, getTodayAttendance);
router.get("/monthly", protect, getMonthlyAttendance);
router.get("/weekly-summary", protect, allowRoles("hr", "manager", "superadmin"), getWeeklyAttendanceSummary);
router.get("/team", protect, allowRoles("tl"), getTeamAttendance);
router.get("/hr-overview", protect, allowRoles("hr", "manager", "superadmin"), getHRAttendanceOverview);
router.get("/day-wise", protect, allowRoles("hr", "manager", "superadmin"), getDayWiseAttendance);

module.exports = router;