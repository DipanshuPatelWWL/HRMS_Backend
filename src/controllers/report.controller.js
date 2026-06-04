const Attendance = require("../models/attendance.model");
const Leave = require("../models/leave.model");
const Payroll = require("../models/payroll.model");
const User = require("../models/user.model");
const Recruitment = require("../models/recruitment.model");
const Performance = require("../models/performance.model");
const Training = require("../models/training.model");
const moment = require("moment-timezone");


const getAttendanceReport = async (req, res) => {
    try {
        const { month, year } = req.query;

        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0, 23, 59, 59);

        const data = await Attendance.aggregate([
            {
                $match: {
                    date: { $gte: start, $lte: end },
                },
            },
            {
                $group: {
                    _id: "$user",
                    totalDays: { $sum: 1 },
                    present: {
                        $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] },
                    },
                    halfDays: {
                        $sum: { $cond: [{ $eq: ["$status", "half-day"] }, 1, 0] },
                    },
                },
            },
            {
                $lookup: {
                    from: "users",
                    localField: "_id",
                    foreignField: "_id",
                    as: "user",
                },
            },
            { $unwind: "$user" },
        ]);

        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


const getLeaveReport = async (req, res) => {
    try {
        const data = await Leave.aggregate([
            {
                $group: {
                    _id: "$type",
                    total: { $sum: 1 },
                    approved: {
                        $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] },
                    },
                    rejected: {
                        $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] },
                    },
                },
            },
        ]);

        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


const getPayrollReport = async (req, res) => {
    try {
        const { month, year } = req.query;

        const data = await Payroll.aggregate([
            {
                $match: {
                    month: Number(month),
                    year: Number(year),
                },
            },
            {
                $group: {
                    _id: null,
                    totalSalary: { $sum: "$netSalary" },
                    totalEmployees: { $sum: 1 },
                },
            },
        ]);

        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


const getEmployeeStats = async (req, res) => {
    try {
        const total = await User.countDocuments();
        const active = await User.countDocuments({ status: "active" });
        const inactive = await User.countDocuments({ status: "inactive" });

        res.json({
            success: true,
            data: { total, active, inactive },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


const getMyDashboardStats = async (req, res) => {
    try {
        const userId = req.user._id;

        const attendance = await Attendance.find({ user: userId });
        const present = attendance.filter(a => a.status === "present").length;
        const total = attendance.length;
        const percentage = total ? ((present / total) * 100).toFixed(1) : 0;
        const lateDays = attendance.filter(a => a.isLate).length;

        const leaves = await Leave.find({ user: userId, status: "approved" });
        const leaveCount = leaves.length;

        res.json({
            success: true,
            data: {
                attendancePercentage: percentage,
                leavesTaken: leaveCount,
                lateDays,
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};


const getHRDashboardStats = async (req, res) => {
    try {

        // ── Present today — use IST dateString to match how punchIn saves ──
        const moment = require("moment-timezone");
        const todayIST = moment().tz("Asia/Kolkata");
        const todayString = todayIST.format("YYYY-MM-DD");
        // ── Payroll count this month ─────────────────────────────────
        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();

        const [
            totalEmployees,
            pendingLeaves,
            presentToday,
            payrollCount
        ] = await Promise.all([
            User.countDocuments({
                role: { $in: ["employee", "tl", "hr", "manager"] },
                status: { $ne: "terminated" },
            }),

            Leave.countDocuments({
                status: "pending",
            }),

            Attendance.countDocuments({
                dateString: todayString,
                status: { $in: ["present", "half-day"] },
            }),

            Payroll.countDocuments({
                month: currentMonth,
                year: currentYear,
            })
        ]);




        const [
            payrollAgg,
            openPositionsAgg,
            perfAgg,
            trainings
        ] = await Promise.all([
            Payroll.aggregate([
                { $match: { month: currentMonth, year: currentYear } },
                { $group: { _id: null, total: { $sum: "$netSalary" } } }
            ]),

            Recruitment.aggregate([
                { $match: { status: "open" } },
                {
                    $group: {
                        _id: null,
                        total: {
                            $sum: {
                                $subtract: ["$openings", "$filled"]
                            }
                        }
                    }
                }
            ]),

            Performance.aggregate([
                { $match: { quarter } },
                { $group: { _id: null, avg: { $avg: "$score" } } }
            ]),

            Training.find({ status: "active" })
        ]);


        const payrollTotal = payrollAgg[0]?.total || 0;

        // ── Open positions ───────────────────────────────────────────

        const openPositions = openPositionsAgg[0]?.total || 0;

        // ── Avg performance this quarter ─────────────────────────────
        const quarter = `Q${Math.ceil(currentMonth / 3)} ${currentYear}`;


        const avgPerformance = perfAgg[0]?.avg
            ? parseFloat(perfAgg[0].avg.toFixed(1))
            : null;

        // ── Training completion rate ──────────────────────────────────

        const totalCourses = trainings.length;
        let trainingCompletion = null;

        if (totalCourses > 0) {
            const totalAssigned = trainings.reduce((s, t) => s + t.assignedTo.length, 0);
            const totalCompleted = trainings.reduce((s, t) => s + t.completedBy.length, 0);
            trainingCompletion = totalAssigned > 0
                ? parseFloat(((totalCompleted / totalAssigned) * 100).toFixed(1))
                : 0;
        }

        // ── Employee turnover (last 30 days) ─────────────────────────
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const inactive30 = await User.countDocuments({
            role: { $in: ["employee", "tl", "hr", "manager"] },
            status: "inactive",
            updatedAt: { $gte: thirtyDaysAgo },
        });
        const turnoverRate = totalEmployees > 0
            ? parseFloat(((inactive30 / totalEmployees) * 100).toFixed(1))
            : 0;

        // ── Recent pending leaves preview ────────────────────────────
        const [
            recentLeaves,
            topPerformers,
            payrollSummaryAgg,
            allUsers
        ] = await Promise.all([
            Leave.find({ status: "pending" })
                .populate("user", "name email employeeId")
                .limit(5)
                .sort({ createdAt: -1 }),

            Performance.find({ quarter })
                .populate("user", "name employeeId department")
                .sort({ score: -1 })
                .limit(5),

            Payroll.aggregate([
                { $match: { month: currentMonth, year: currentYear } },
                {
                    $group: {
                        _id: null,
                        grossTotal: { $sum: "$basicSalary" },
                        deductionsTotal: { $sum: "$deductions" },
                        netTotal: { $sum: "$netSalary" },
                        count: { $sum: 1 }
                    }
                }
            ]),

            User.find({
                role: { $in: ["employee", "tl", "hr", "manager"] }
            }).select("name dob joiningDate employeeId")
        ]);

        const payrollSummary = payrollSummaryAgg[0] || null;

        const todayD = new Date();
        const upcoming = [];

        allUsers.forEach(u => {
            // Birthday
            if (u.dob) {
                const bday = new Date(u.dob);
                const thisYear = new Date(todayD.getFullYear(), bday.getMonth(), bday.getDate());
                const diff = Math.ceil((thisYear - todayD) / (1000 * 60 * 60 * 24));
                if (diff >= 0 && diff <= 7) {
                    upcoming.push({
                        name: u.name,
                        type: "birthday",
                        date: thisYear.toISOString(),
                        diff,
                        employeeId: u.employeeId,
                    });
                }
            }
            // Work anniversary
            if (u.joiningDate) {
                const jDate = new Date(u.joiningDate);
                const anniv = new Date(todayD.getFullYear(), jDate.getMonth(), jDate.getDate());
                const diff = Math.ceil((anniv - todayD) / (1000 * 60 * 60 * 24));
                const years = todayD.getFullYear() - jDate.getFullYear();
                if (diff >= 0 && diff <= 7 && years > 0) {
                    upcoming.push({
                        name: u.name,
                        type: "anniversary",
                        date: anniv.toISOString(),
                        diff,
                        years,
                        employeeId: u.employeeId,
                    });
                }
            }
        });

        upcoming.sort((a, b) => a.diff - b.diff);

        // ── Send response ────────────────────────────────────────────
        res.json({
            success: true,
            data: {
                // Row 1 cards
                totalEmployees,
                presentToday,
                pendingLeaves,
                openPositions,
                // Row 2 cards
                payrollTotal,
                payrollCount,
                avgPerformance,
                trainingCompletion,
                totalCourses,
                turnoverRate,
                // Sections
                quarter,
                recentLeaves,
                topPerformers,
                payrollSummary,
                upcoming,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = {
    getAttendanceReport,
    getLeaveReport,
    getPayrollReport,
    getEmployeeStats,
    getMyDashboardStats,
    getHRDashboardStats,
};