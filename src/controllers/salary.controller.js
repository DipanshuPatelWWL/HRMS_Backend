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
        if (req.user.role !== "hr" && req.user.role !== "superadmin") {
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
        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0, 23, 59, 59);

        // Total calendar days in month (used for perDay calculation)
        const totalCalendarDays = new Date(year, month, 0).getDate();

        // ── PER DAY SALARY ────────────────────────
        // Divide by total calendar days because weekends + holidays are also paid.
        // This ensures present+weekends+holidays+leaves always sums back to monthly.
        const perDay = Number((user.salary.monthly / totalCalendarDays).toFixed(2));
        const halfDayPay = Number((perDay / 2).toFixed(2));

        // ── HOLIDAYS ──────────────────────────────
        const holidays = await Holiday.find({
            date: { $gte: start, $lte: end },
        });

        const holidayDates = holidays.map(h => {
            const d = new Date(h.date);
            d.setHours(0, 0, 0, 0);
            return d.getTime();
        });

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
            if (!isWeekend(current) && !holidayDates.includes(current.getTime())) {
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
            for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
                const day = new Date(d);
                day.setHours(0, 0, 0, 0);
                if (
                    day >= start &&
                    day <= end &&
                    !isWeekend(day) &&
                    !holidayDates.includes(day.getTime())
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
            paidLeave += l.paidDays || 0;
            unpaidLeave += l.unpaidDays || 0;
        });

        // ── ATTENDANCE ────────────────────────────
        const attendanceRecords = await Attendance.find({
            user: userId,
            date: { $gte: start, $lte: end },
        });

        let present = 0;
        let halfDays = 0;

        attendanceRecords.forEach(a => {
            const d = new Date(a.date);
            d.setHours(0, 0, 0, 0);

            // Skip weekends — they are auto-paid, not counted as present
            if (isWeekend(d)) return;

            // Skip holidays — they are auto-paid
            if (holidayDates.includes(d.getTime())) return;

            // Skip leave days — already counted in paidLeave / unpaidLeave
            const isOnLeave = leaves.some(l => {
                const from = new Date(l.fromDate);
                const to = new Date(l.toDate);
                from.setHours(0, 0, 0, 0);
                to.setHours(23, 59, 59, 999);
                return d >= from && d <= to;
            });
            if (isOnLeave) return;

            if (a.isHalfDay) halfDays++;
            else if (a.status === "present") present++;
        });

        // ── ABSENT ────────────────────────────────
        // Absent = working days not covered by present, half-days, or leaves
        const accountedDays = present + halfDays + leaveDays;
        const absent = Math.max(0, workingDays - accountedDays);

        // ── SALARY FORMULA ────────────────────────
        //
        //  Paid days  = present + paid leaves + holidays + weekends
        //  Half days  = halfDays * 0.5 perDay
        //  Deductions = unpaid leaves + absents
        //
        const totalSalary =
            ((present + paidLeave + holidayCount + totalWeekends) * perDay) +
            (halfDays * halfDayPay) -
            (unpaidLeave * perDay) -
            (absent * perDay);

        const finalSalary = Number(Math.max(0, totalSalary).toFixed(2));

        // ── RESPONSE ──────────────────────────────
        res.json({
            success: true,
            data: {
                name: user.name,
                employeeId: user.employeeId,
                monthlySalary: user.salary.monthly,
                perDaySalary: perDay,
                halfDaySalary: halfDayPay,

                // Attendance breakdown
                presentDays: present,
                halfDays,
                leaveDays,
                paidLeave,
                unpaidLeave,
                absentDays: absent,

                // Calendar info
                totalCalendarDays,
                totalWeekends,
                holidays: holidayCount,
                totalWorkingDays: workingDays,

                // Final
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