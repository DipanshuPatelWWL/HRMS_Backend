const Attendance = require("../models/attendance.model");
const User = require("../models/user.model");
const Holiday = require("../models/holiday.model");
const Leave = require("../models/leave.model");

// ─────────────────────────────────────────────
//  HELPER
// ─────────────────────────────────────────────
const isWeekend = (date) => {
    const day = new Date(date).getDay();
    return day === 0 || day === 6;
};


function round2(n) { return Math.round(n * 100) / 100; }

// ─────────────────────────────────────────────
//  GET MONTHLY SALARY
// ─────────────────────────────────────────────
const getMonthlySalary = async (req, res) => {
    try {
        const { userId } = req.params;
        const { month, year } = req.query;

        if (!month || !year) {
            return res.status(400).json({
                success: false,
                message: "month and year are required",
            });
        }

        // ── USER ──────────────────────────────────
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        // ── ACCESS CONTROL ────────────────────────
        if (req.user.role !== "hr" && req.user.role !== "manager") {
            if (req.user._id.toString() !== userId) {
                return res.status(403).json({
                    success: false,
                    message: "You can only view your own salary",
                });
            }

            if (!user.canViewSalary) {
                return res.status(403).json({
                    success: false,
                    message: "Salary not released by HR yet",
                });
            }

            const currentDate = new Date().getDate();
            if (currentDate < 10) {
                return res.status(403).json({
                    success: false,
                    message: "Salary is available after the 10th of each month",
                });
            }
        }

        // ── SALARY CHECK ──────────────────────────
        if (!user.salary || !user.salary.monthly) {
            return res.status(400).json({
                success: false,
                message: "Salary not set for this employee",
            });
        }

        // ── DATE RANGE ────────────────────────────
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 0, 23, 59, 59);

        const joiningDate = user.joiningDate ? new Date(user.joiningDate) : null;
        const start = (joiningDate && joiningDate > monthStart)
            ? new Date(joiningDate.getFullYear(), joiningDate.getMonth(), joiningDate.getDate())
            : monthStart;
        const end = monthEnd;

        // Total calendar days in month (used for perDay calculation)
        const totalCalendarDays = new Date(year, month, 0).getDate();

        // ── PER DAY SALARY ────────────────────────
        const perDay = round2(user.salary.monthly / totalCalendarDays);
        const halfDayPay = round2(perDay / 2);

        // ── HOLIDAYS ──────────────────────────────
        const holidays = await Holiday.find({
            date: { $gte: start, $lte: end },
        });

        const holidayDates = new Set(
            holidays.map(h => {
                const d = new Date(h.date);
                d.setHours(0, 0, 0, 0);
                return d.getTime();
            })
        );

        const holidayCount = holidays.length;

        // ── WEEKENDS ──────────────────────────────
        let totalWeekends = 0;
        for (let d = 1; d <= totalCalendarDays; d++) {
            const current = new Date(year, month - 1, d);
            if (isWeekend(current)) totalWeekends++;
        }

        // ── WORKING DAYS (Mon–Fri minus holidays) ─
        // Used only for absent calculation, NOT for perDay
        let workingDays = 0;
        for (let d = 1; d <= totalCalendarDays; d++) {
            const current = new Date(year, month - 1, d);
            current.setHours(0, 0, 0, 0);
            if (!isWeekend(current) && !holidayDates.has(current.getTime())) {
                workingDays++;
            }
        }

        // ── APPROVED LEAVES THIS MONTH ────────────
        const leaves = await Leave.find({
            user: userId,
            status: "approved",
            fromDate: { $lte: end },
            toDate: { $gte: start },
        });

        // Count only working-day leave days (exclude weekends & holidays within leave range)
        let leaveDays = 0;
        leaves.forEach(l => {
            const from = new Date(l.fromDate);
            const to = new Date(l.toDate);
            // Normalize to local midnight to avoid timezone boundary shifts
            from.setHours(0, 0, 0, 0);
            to.setHours(23, 59, 59, 999);
            for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
                const day = new Date(d);
                day.setHours(0, 0, 0, 0);
                if (
                    day >= start &&
                    day <= end &&
                    !isWeekend(day) &&
                    !holidayDates.has(day.getTime())
                ) {
                    leaveDays++;
                }
            }
        });

        // ── PAID vs UNPAID LEAVE ──────────────────
        // paidDays / unpaidDays are stored on the leave record at approval time
        let paidLeave = 0;
        let unpaidLeave = 0;

        leaves.forEach(l => {
            if (l.type === "casual") {
                paidLeave += l.paidDays || 0;
                unpaidLeave += l.unpaidDays || 0;
            } else {
                unpaidLeave += l.totalDays || 0;
            }
        });

        // ── ATTENDANCE ────────────────────────────
        const attendanceRecords = await Attendance.find({
            user: userId,
            date: { $gte: start, $lte: end },
        });

        let present = 0;
        let halfDays = 0;

        const leaveDaySet = new Set();
        leaves.forEach(l => {
            const from = new Date(l.fromDate);
            const to = new Date(l.toDate);
            from.setHours(0, 0, 0, 0);
            to.setHours(23, 59, 59, 999);
            for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
                const day = new Date(d);
                day.setHours(0, 0, 0, 0);
                if (day >= start && day <= end) {
                    leaveDaySet.add(day.getTime());
                }
            }
        });

        attendanceRecords.forEach(a => {
            const d = new Date(a.date);
            d.setHours(0, 0, 0, 0);

            if (isWeekend(d)) return;
            if (holidayDates.has(d.getTime())) return;
            if (leaveDaySet.has(d.getTime())) return;

            if (a.isHalfDay) halfDays++;
            else if (a.status === "present") present++;
        });


        // ── ABSENT ────────────────────────────────
        // Absent = working days not covered by present, half-days, or leaves
        const accountedDays = present + halfDays + leaveDaySet.size;
        const absent = Math.max(0, workingDays - accountedDays);

        // ── SALARY FORMULA ────────────────────────────────────
        //
        //  Start = full monthlySalary
        //  Deduct only:
        //    absentDays  × perDay
        //    halfDays    × halfDayPay
        //    unpaidLeave × perDay
        //
        //  Paid CL, weekends, holidays → no deduction
        //
        const absentAmt = round2(absent * perDay);
        const halfDayDeduct = round2(halfDays * halfDayPay);
        const unpaidLeaveAmt = round2(unpaidLeave * perDay);
        const totalDeductions = round2(absentAmt + halfDayDeduct + unpaidLeaveAmt);

        // If future month OR employee had zero presence (no present, no half days, no leave) → salary is 0
        const hasAnyPresence = present > 0 || halfDays > 0 || paidLeave > 0 || unpaidLeave > 0;

        const finalSalary = hasAnyPresence
            ? round2(Math.max(0, user.salary.monthly - totalDeductions))
            : 0;

        // ── RESPONSE ──────────────────────────────
        res.json({
            success: true,
            data: {
                name: user.name,
                employeeId: user.employeeId,
                monthlySalary: user.salary.monthly,
                perDaySalary: hasAnyPresence ? perDay : 0,
                halfDaySalary: hasAnyPresence ? halfDayPay : 0,
                presentDays: present,
                halfDays,
                leaveDays: leaveDaySet.size,
                paidLeave,
                unpaidLeave,
                absentDays: hasAnyPresence ? absent : 0,
                totalCalendarDays: hasAnyPresence ? totalCalendarDays : 0,
                totalWeekends: hasAnyPresence ? totalWeekends : 0,
                holidays: hasAnyPresence ? holidayCount : 0,
                totalWorkingDays: hasAnyPresence ? workingDays : 0,
                absentAmt: hasAnyPresence ? absentAmt : 0,
                halfDayDeduct: hasAnyPresence ? halfDayDeduct : 0,
                unpaidLeaveAmt: hasAnyPresence ? unpaidLeaveAmt : 0,
                totalDeductions: hasAnyPresence ? totalDeductions : 0,
                totalSalary: finalSalary,
            },
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


// ─────────────────────────────────────────────
//  UPDATE SALARY ACCESS (HR releases salary visibility)
// ─────────────────────────────────────────────
const updateSalaryAccess = async (req, res) => {
    try {
        const { canViewSalary } = req.body;

        if (typeof canViewSalary !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "canViewSalary must be true or false",
            });
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            { canViewSalary },
            { new: true }
        ).select("-password");

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        res.json({
            success: true,
            message: `Salary access ${canViewSalary ? "granted" : "revoked"}`,
            user,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


module.exports = { getMonthlySalary, updateSalaryAccess };