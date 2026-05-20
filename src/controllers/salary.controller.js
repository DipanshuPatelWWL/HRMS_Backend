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
        const isAdminViewer = req.user.role === "hr" || req.user.role === "manager";

        if (!isAdminViewer) {
            // Anyone can only view their own salary
            if (req.user._id.toString() !== userId) {
                return res.status(403).json({
                    success: false,
                    message: "You can only view your own salary",
                });
            }

            // TL: always allowed to see their salary (no canViewSalary gate)
            if (req.user.role !== "tl") {
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

        // ── SALARY STRUCTURE ──────────────────────
        const gross = user.salary.monthly;
        const structure = user.salary.structure || {};
        const deductionConfig = user.salary.deductions || {};

        // Build component breakdown
        const components = {
            basic: { label: "Basic Salary", enabled: structure.basic?.enabled ?? true, percent: structure.basic?.percent ?? 40 },
            hra: { label: "HRA", enabled: structure.hra?.enabled ?? true, percent: structure.hra?.percent ?? 20 },
            specialAllowance: { label: "Special Allowance", enabled: structure.specialAllowance?.enabled ?? true, percent: structure.specialAllowance?.percent ?? 25 },
            conveyance: { label: "Conveyance / Internet", enabled: structure.conveyance?.enabled ?? true, percent: structure.conveyance?.percent ?? 10 },
            otherAllowance: { label: "Other Allowance", enabled: structure.otherAllowance?.enabled ?? true, percent: structure.otherAllowance?.percent ?? 5 },
        };

        // Calculate each enabled component amount
        const componentAmounts = {};
        let totalPercent = 0;
        for (const [key, comp] of Object.entries(components)) {
            if (comp.enabled) {
                componentAmounts[key] = round2((comp.percent / 100) * gross);
                totalPercent += comp.percent;
            } else {
                componentAmounts[key] = 0;
            }
        }

        // Basic salary (needed for PF calculation)
        const basicSalary = componentAmounts.basic || 0;

        // Gross earnings = sum of all enabled components
        // If percents don't add up to 100, pro-rate the remainder into gross
        const grossEarnings = round2(
            Object.values(componentAmounts).reduce((sum, v) => sum + v, 0)
        );

        // ── STATUTORY DEDUCTIONS ─────────────────
        const pfEnabled = deductionConfig.pf?.enabled ?? false;
        const esiEnabled = deductionConfig.esi?.enabled ?? false;
        const ptEnabled = deductionConfig.professionalTax?.enabled ?? false;

        const pfPercent = deductionConfig.pf?.percent ?? 12;
        const esiPercent = deductionConfig.esi?.percent ?? 0.75;
        const ptFixed = deductionConfig.professionalTax?.fixedAmount ?? 0;

        const pfAmount = pfEnabled ? round2((pfPercent / 100) * basicSalary) : 0;
        const esiAmount = esiEnabled ? round2((esiPercent / 100) * grossEarnings) : 0;
        const ptAmount = ptEnabled ? round2(ptFixed) : 0;

        const totalStatutoryDeductions = round2(pfAmount + esiAmount + ptAmount);

        // ── PER DAY SALARY ────────────────────────
        // perDay is based on gross (before statutory deductions)
        // divided by calendar days in month
        const perDay = round2(gross / totalCalendarDays);
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
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const current = new Date(d);
            if (isWeekend(current)) totalWeekends++;
        }

        // ── WORKING DAYS (Mon–Fri minus holidays) ─
        // Used only for absent calculation, NOT for perDay
        let workingDays = 0;
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const current = new Date(d);
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
        const accountedDays = present + (halfDays * 0.5) + leaveDaySet.size
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
        // ── ATTENDANCE DEDUCTIONS ─────────────────
        // Based on gross monthly (before statutory deductions)
        const absentAmt = round2(absent * perDay);
        const halfDayDeduct = round2(halfDays * halfDayPay);
        const unpaidLeaveAmt = round2(unpaidLeave * perDay);
        const totalAttendanceDeductions = round2(absentAmt + halfDayDeduct + unpaidLeaveAmt);

        // ── TOTAL DEDUCTIONS ──────────────────────
        // Attendance deductions + statutory deductions
        const totalDeductions = round2(totalAttendanceDeductions + totalStatutoryDeductions);

        // ── FINAL SALARY ──────────────────────────
        const hasAnyPresence = present > 0 || halfDays > 0 || paidLeave > 0 || unpaidLeave > 0;

        const finalSalary = hasAnyPresence
            ? round2(Math.max(0, gross - totalDeductions))
            : 0;

        // ── RESPONSE ──────────────────────────────
        res.json({
            success: true,
            data: {
                name: user.name,
                employeeId: user.employeeId,
                monthlySalary: gross,

                // ── Salary Structure Breakdown ──
                salaryStructure: hasAnyPresence ? {
                    basic: { label: "Basic Salary", enabled: components.basic.enabled, percent: components.basic.percent, amount: componentAmounts.basic },
                    hra: { label: "HRA", enabled: components.hra.enabled, percent: components.hra.percent, amount: componentAmounts.hra },
                    specialAllowance: { label: "Special Allowance", enabled: components.specialAllowance.enabled, percent: components.specialAllowance.percent, amount: componentAmounts.specialAllowance },
                    conveyance: { label: "Conveyance / Internet", enabled: components.conveyance.enabled, percent: components.conveyance.percent, amount: componentAmounts.conveyance },
                    otherAllowance: { label: "Other Allowance", enabled: components.otherAllowance.enabled, percent: components.otherAllowance.percent, amount: componentAmounts.otherAllowance },
                } : null,
                grossEarnings: hasAnyPresence ? grossEarnings : 0,

                // ── Statutory Deductions ──
                statutoryDeductions: hasAnyPresence ? {
                    pf: { enabled: pfEnabled, percent: pfPercent, amount: pfAmount, label: "Provident Fund (PF)" },
                    esi: { enabled: esiEnabled, percent: esiPercent, amount: esiAmount, label: "ESI" },
                    professionalTax: { enabled: ptEnabled, fixedAmount: ptFixed, amount: ptAmount, label: "Professional Tax" },
                } : null,
                totalStatutoryDeductions: hasAnyPresence ? totalStatutoryDeductions : 0,

                // ── Attendance ──
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

                // ── Deduction Breakdown ──
                absentAmt: hasAnyPresence ? absentAmt : 0,
                halfDayDeduct: hasAnyPresence ? halfDayDeduct : 0,
                unpaidLeaveAmt: hasAnyPresence ? unpaidLeaveAmt : 0,
                totalAttendanceDeductions: hasAnyPresence ? totalAttendanceDeductions : 0,
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



// ─────────────────────────────────────────────
//  UPDATE SALARY STRUCTURE (HR configures per employee)
//  PUT /salary/:userId/structure
// ─────────────────────────────────────────────
const updateSalaryStructure = async (req, res) => {
    try {
        const { userId } = req.params;
        const { structure, deductions } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // ── Validate structure percents add up to 100 ──
        if (structure) {
            const keys = ["basic", "hra", "specialAllowance", "conveyance", "otherAllowance"];
            let total = 0;
            for (const key of keys) {
                if (structure[key]?.enabled) {
                    const pct = Number(structure[key].percent || 0);
                    if (pct < 0 || pct > 100) {
                        return res.status(400).json({ success: false, message: `Invalid percent for ${key}` });
                    }
                    total += pct;
                }
            }
            if (Math.round(total) !== 100) {
                return res.status(400).json({
                    success: false,
                    message: `Enabled component percents must add up to 100% (currently ${total}%)`,
                });
            }
            user.salary.structure = structure;
        }

        if (deductions) {
            // Validate PF percent
            if (deductions.pf?.enabled && (deductions.pf.percent < 0 || deductions.pf.percent > 100)) {
                return res.status(400).json({ success: false, message: "Invalid PF percent" });
            }
            // Validate PF number (UAN = 12 digits OR old format — loose check)
            if (deductions.pf?.enabled && deductions.pf.pfNumber) {
                const pfNum = deductions.pf.pfNumber.trim().toUpperCase();
                if (pfNum.length < 5) {
                    return res.status(400).json({ success: false, message: "Invalid PF / UAN number" });
                }
                deductions.pf.pfNumber = pfNum;
            }

            // Validate ESI percent
            if (deductions.esi?.enabled && (deductions.esi.percent < 0 || deductions.esi.percent > 100)) {
                return res.status(400).json({ success: false, message: "Invalid ESI percent" });
            }
            // Validate ESI number (17 digits)
            if (deductions.esi?.enabled && deductions.esi.esiNumber) {
                const esiNum = deductions.esi.esiNumber.trim();
                if (!/^\d{17}$/.test(esiNum)) {
                    return res.status(400).json({ success: false, message: "ESI number must be exactly 17 digits" });
                }
                deductions.esi.esiNumber = esiNum;
            }

            user.salary.deductions = deductions;
        }

        await user.save();

        res.json({
            success: true,
            message: "Salary structure updated successfully",
            salaryStructure: user.salary,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = { getMonthlySalary, updateSalaryAccess, updateSalaryStructure };