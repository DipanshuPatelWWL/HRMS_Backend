const moment = require("moment-timezone");
const Attendance = require("../models/attendance.model");
const Holiday = require("../models/holiday.model");
const Leave = require("../models/leave.model");
const User = require("../models/user.model");
const { getShiftConfig } = require("./attendanceEvaluation");

/**
 * Generates a complete attendance grid for a user over a date range.
 * Includes attendance records, leaves, holidays, and weekends.
 */
const getAttendanceGrid = async (userId, startDate, endDate) => {
    const start = moment(startDate).tz("Asia/Kolkata").startOf("day");
    const end = moment(endDate).tz("Asia/Kolkata").endOf("day");
    const today = moment().tz("Asia/Kolkata").startOf("day");

    const [attendance, holidays, leaves, user] = await Promise.all([
        Attendance.find({
            user: userId,
            date: { $gte: start.toDate(), $lte: end.toDate() }
        }).lean(),
        Holiday.find({ date: { $gte: start.toDate(), $lte: end.toDate() } }).lean(),
        Leave.find({
            user: userId,
            status: "approved",
            fromDate: { $lte: end.toDate() },
            toDate: { $gte: start.toDate() }
        }).lean(),
        User.findById(userId).select("joiningDate relievingDate exitDate createdAt shift").lean()
    ]);


    const attMap = new Map(
        attendance.map((a) => {
            const key = a.dateString
                ? moment(a.dateString).tz("Asia/Kolkata").format("YYYY-MM-DD")
                : moment(a.date).tz("Asia/Kolkata").format("YYYY-MM-DD");
            return [key, a];
        })
    );

    const holidayMap = new Map(
        holidays.map((h) => [
            moment(h.date)
                .tz("Asia/Kolkata")
                .format("YYYY-MM-DD"),
            h,
        ])
    );

    // Process leaves into a daily map
    const leaveMap = new Map();
    leaves.forEach(l => {
        let curr = moment(l.fromDate).tz("Asia/Kolkata").startOf("day");
        const lEnd = moment(l.toDate).tz("Asia/Kolkata").startOf("day");
        while (curr.isSameOrBefore(lEnd)) {
            leaveMap.set(curr.format("YYYY-MM-DD"), l);
            curr.add(1, "day");
        }
    });

    const grid = [];
    let curr = start.clone();

    // Effective dates
    const joiningDate = user?.joiningDate || user?.createdAt;
    const relievingDate = user?.relievingDate || user?.exitDate;
    const joiningMoment = joiningDate ? moment(joiningDate).tz("Asia/Kolkata").startOf("day") : null;
    const relievingMoment = relievingDate ? moment(relievingDate).tz("Asia/Kolkata").endOf("day") : null;

    while (curr.isSameOrBefore(end)) {
        const dateStr = curr.format("YYYY-MM-DD");
        const att = attMap.get(dateStr);
        const holiday = holidayMap.get(dateStr);
        const leave = leaveMap.get(dateStr);
        const isWeekend = curr.day() === 0 || curr.day() === 6;
        const isFuture = curr.isAfter(today);

        const isJoined = joiningMoment ? curr.isSameOrAfter(joiningMoment) : true;
        const isRelieved = relievingMoment ? curr.isAfter(relievingMoment) : false;

        let status = "absent";
        let displayStatus = "Absent";

        if (!isJoined) {
            status = "not_joined";
            displayStatus = "Not Joined";
        } else if (isRelieved) {
            status = "inactive";
            displayStatus = "Inactive";
        } else if (leave) {
            status = "leave";
            displayStatus = "Leave";
        } else if (holiday) {
            status = "holiday";
            displayStatus = "Holiday";
        } else if (isWeekend) {
            status = "weekend";
            displayStatus = "Weekend";
        } else if (att) {
            status = att.status || "present";
            displayStatus = status.charAt(0).toUpperCase() + status.slice(1).replace("-", " ");
            if (att.isHalfDay) displayStatus = "Half Day";
            if (att.isLate && !att.isHalfDay) displayStatus = "Late";
        } else if (isFuture) {
            status = "future";
            displayStatus = "Future";
        } else {
            status = "absent";
            displayStatus = "Absent";
        }

        grid.push({
            date: curr.toDate(),
            dateString: dateStr,
            status,
            displayStatus,
            punchIn: att?.punchIn || null,
            punchOut: att?.punchOut || null,
            workHours: att?.workHours || 0,
            isLate: att?.isLate || false,
            lateMinutes: att?.lateMinutes || 0,
            isHalfDay: att?.isHalfDay || false,
            isShortLeave: att?.isShortLeave || false,
            eightHourPassUsed: att?.eightHourPassUsed || false,
            mpoFlag: att?.mpoFlag || false,
            mpoResolved: att?.mpoResolved || false,
            mpoDetectedAt: att?.mpoDetectedAt || null,
            halfDayReason: att?.halfDayReason || "",
            holidayName: holiday?.name,
            leaveType: leave?.leaveType
        });

        curr.add(1, "day");
    }

    grid._shift = user?.shift;
    return grid;
};

/**
 * Calculates summary stats from an attendance grid.
 */
const calculateStats = (grid) => {
    const stats = {
        present: 0,
        late: 0,
        halfDay: 0,
        absent: 0,
        leave: 0,
        holiday: 0,
        weekend: 0,
        missingPunchOut: 0,
        dataAnomalyDays: 0,
        totalWorkHours: 0,
        totalLateMinutes: 0,
        workedDays: 0,
        attendancePercentage: 0,
        workingDays: 0,
        expectedShiftHours: 9,
        compliancePercentage: 0
    };

    const todayStr = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");
    let completedPresentDays = 0;
    stats.totalWorkHours = 0;

    grid.forEach(day => {
        // Only count stats for past and today
        if (day.dateString > todayStr) return;
        if (day.status === "not_joined" || day.status === "inactive") return;

        const isPresentType = ["present", "late", "half-day", "short-leave"].includes(day.status);
        const isCompleted = !!(day.punchIn && day.punchOut);
        const isToday = day.dateString === todayStr;
        let bucketed = false;

        if (isPresentType && isCompleted) {
            // Fully completed day — counts toward Present/Late/HalfDay AND hours
            completedPresentDays++;
            stats.totalWorkHours += day.workHours || 0;
            stats.workedDays++;
            stats.totalLateMinutes += day.lateMinutes || 0;
            if (day.isHalfDay) stats.halfDay++;
            else if (day.isLate) stats.late++;
            else stats.present++;
            bucketed = true;
        } else if (isPresentType && day.punchIn && !day.punchOut && isToday) {
            // Still punched in today — don't count as a "Full Day" yet
            stats.inProgress = (stats.inProgress || 0) + 1;
            bucketed = true;
        } else if (isPresentType && day.punchIn && !day.punchOut && !isToday) {
            stats.missingPunchOut = (stats.missingPunchOut || 0) + 1;
            stats.workedDays++;
            bucketed = true;
        } else if (isPresentType) {
            stats.workedDays++;
            if (day.isHalfDay) stats.halfDay++;
            else if (day.isLate) stats.late++;
            else stats.present++;
            bucketed = true;
        } else if (day.status === "missing_punch_out" && day.mpoResolved !== true) {
            stats.missingPunchOut = (stats.missingPunchOut || 0) + 1;
            bucketed = true;
        } else if (day.status === "absent") {
            stats.absent++;
            bucketed = true;
        } else if (day.status === "leave") {
            stats.leave++;
            bucketed = true;
        } else if (day.status === "holiday") {
            stats.holiday++;
            bucketed = true;
        } else if (day.status === "weekend") {
            stats.weekend++;
            bucketed = true;
        }

        if (!bucketed && day.status !== "not_joined" && day.status !== "inactive" && day.status !== "future") {
            stats.absent++;
            stats.dataAnomalyDays = (stats.dataAnomalyDays || 0) + 1;
        }

        // Working days are days that are not weekend and not holiday
        if (day.status !== "weekend" && day.status !== "holiday" && day.status !== "not_joined" && day.status !== "inactive") {
            stats.workingDays++;
        }
    });

    stats.completedPresentDays = completedPresentDays;

    const effectivePresent = stats.present + stats.late + (stats.halfDay * 0.5);
    stats.attendancePercentage = stats.workingDays > 0
        ? parseFloat(((effectivePresent / stats.workingDays) * 100).toFixed(2))
        : 0;

    stats.avgDailyHours = completedPresentDays > 0
        ? parseFloat((stats.totalWorkHours / completedPresentDays).toFixed(2))
        : 0;

    // Shift compliance calculation
    const sc = getShiftConfig(grid._shift);
    const shiftDurationMinutes = sc.shiftEnd > sc.shiftStart ? sc.shiftEnd - sc.shiftStart : (1440 - sc.shiftStart) + sc.shiftEnd;
    stats.expectedShiftHours = parseFloat((shiftDurationMinutes / 60).toFixed(2));

    stats.compliancePercentage = stats.expectedShiftHours > 0
        ? parseFloat(((stats.avgDailyHours / stats.expectedShiftHours) * 100).toFixed(2))
        : 0;

    return stats;
};

module.exports = {
    getAttendanceGrid,
    calculateStats
};
