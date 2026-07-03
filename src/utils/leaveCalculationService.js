const moment = require("moment-timezone");
const attendanceService = require("./attendanceService");

/**
 * Calculates leave deductions considering the sandwich policy.
 * 
 * Logic:
 * If a weekend or holiday is "sandwiched" between two leave days, it counts as leave.
 * 
 * Intervening non-working days (weekends/holidays) are counted as leaves ONLY IF:
 * 1. SANDWICH_POLICY_ENABLED is true.
 * 2. There is an approved leave immediately before the non-working period.
 * 3. There is an approved leave immediately after the non-working period.
 * 
 * @param {string} userId - The user ID.
 * @param {Date} startDate - Start of the month/range.
 * @param {Date} endDate - End of the month/range.
 */
const calculateDeductibleLeaves = async (userId, startDate, endDate) => {
    const grid = await attendanceService.getAttendanceGrid(userId, startDate, endDate);
    const isSandwichEnabled = process.env.SANDWICH_POLICY_ENABLED === "true";

    if (!isSandwichEnabled) {
        // Just return standard leave count
        return grid.filter(day => day.status === "leave").length;
    }

    let deductibleCount = 0;
    const processedGrid = grid.map(day => ({ ...day, isDeducted: false }));

    for (let i = 0; i < processedGrid.length; i++) {
        const current = processedGrid[i];

        // 1. Direct Leave is always deducted
        if (current.status === "leave") {
            current.isDeducted = true;
            deductibleCount++;
            continue;
        }

        // 2. Check for Sandwich (Weekend or Holiday)
        if (current.status === "weekend" || current.status === "holiday") {
            // Check backwards for nearest non-sandwich day
            let prevLeave = false;
            for (let j = i - 1; j >= 0; j--) {
                if (processedGrid[j].status === "leave") {
                    prevLeave = true;
                    break;
                }
                if (processedGrid[j].status !== "weekend" && processedGrid[j].status !== "holiday") {
                    break;
                }
            }

            // Check forwards for nearest non-sandwich day
            let nextLeave = false;
            for (let k = i + 1; k < processedGrid.length; k++) {
                if (processedGrid[k].status === "leave") {
                    nextLeave = true;
                    break;
                }
                if (processedGrid[k].status !== "weekend" && processedGrid[k].status !== "holiday") {
                    break;
                }
            }

            if (prevLeave && nextLeave) {
                current.isDeducted = true;
                deductibleCount++;
            }
        }
    }

    return {
        totalDeductedDays: deductibleCount,
        breakdown: processedGrid.map(d => ({
            date: d.dateString,
            status: d.status,
            isDeductedAsLeave: d.isDeducted
        }))
    };
};

/**
 * Calculates Loss of Pay (LOP) days.
 * LOP = (Working Days - Worked Days - Sandwich Adjusted Leaves)
 * But a simpler way: LOP = Absent Days + (Sandwich effect on unpaid leaves if any)
 * Actually, for this system: LOP = Absent Days. 
 * Sandwich only affects Leave Balance deduction.
 * 
 * However, if leave balance is exhausted, Sandwich leaves become LOP.
 */
const calculatePayrollDays = async (userId, month, year) => {
    const startOfMonth = moment.tz(`${year}-${String(month).padStart(2, "0")}-01`, "Asia/Kolkata").startOf("month").toDate();
    const endOfMonth = moment(startOfMonth).endOf("month").toDate();

    const grid = await attendanceService.getAttendanceGrid(userId, startOfMonth, endOfMonth);
    const sandwichData = await calculateDeductibleLeaves(userId, startOfMonth, endOfMonth);

    const stats = attendanceService.calculateStats(grid);

    // Total days in month (excluding not_joined and future)
    const todayStr = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");
    const activeDays = grid.filter(d => d.dateString <= todayStr && d.status !== "not_joined" && d.status !== "inactive");

    // LOP Days = Absent Days + (Sandwich Days that are not covered by leave balance)
    // For simplicity in this requirement, we return the sandwich-adjusted leave count
    // and the raw absent count. The payroll logic will combine them.

    return {
        workedDays: stats.workedDays,
        absentDays: stats.absent,
        halfDays: stats.halfDay,
        leaveDaysWithSandwich: sandwichData.totalDeductedDays,
        actualLeaveDays: stats.leave,
        sandwichDaysAdded: sandwichData.totalDeductedDays - stats.leave,
        workingDays: stats.workingDays,
        attendancePercentage: stats.attendancePercentage,
        sandwichBreakdown: sandwichData.breakdown
    };
};

module.exports = {
    calculateDeductibleLeaves,
    calculatePayrollDays
};
