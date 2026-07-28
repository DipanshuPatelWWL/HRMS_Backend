const moment = require("moment-timezone");
const Attendance = require("../models/attendance.model");
const User = require("../models/user.model");

const getShiftConfig = (shift) => {
    const s = shift || {};
    const startH = s.startHour ?? 10;
    const startM = s.startMinute ?? 0;
    const endH = s.endHour ?? 19;
    const endM = s.endMinute ?? 0;
    const grace = s.graceMinutes ?? 15;
    const halfAt = s.halfDayAfterMinutes ?? 30;

    const shiftStart = startH * 60 + startM;
    const lateTrigger = shiftStart + grace;
    const halfDayCutoff = shiftStart + halfAt;
    const shiftEnd = endH * 60 + endM;
    const isDefaultShift = (s.type === "default" || !s.type) && startH === 10 && startM === 0 && endH === 19 && endM === 0;
    const onTimeCutoffP2 = shiftStart + 5;

    return { shiftStart, lateTrigger, halfDayCutoff, shiftEnd, onTimeCutoffP2, isDefaultShift };
};

const updateShortLeaveBalance = async (userId, punchOutDate, action) => {
    const user = await User.findById(userId).select("leaveBalance");
    if (!user) return;

    const dateIST = moment(punchOutDate).tz("Asia/Kolkata");
    const month = dateIST.month() + 1;
    const year = dateIST.year();

    const sl = user.leaveBalance?.shortLeave || {};
    const isNewMonth = (sl.lastGrantedYear || year) < year || ((sl.lastGrantedYear || year) === year && (sl.lastGrantedMonth || month) < month);
    let used = isNewMonth ? 0 : (sl.used || 0);

    if (action === "deduct") used += 1;
    if (action === "restore") used = Math.max(0, used - 1);

    await User.findByIdAndUpdate(userId, {
        "leaveBalance.shortLeave.used": used,
        "leaveBalance.shortLeave.lastGrantedMonth": month,
        "leaveBalance.shortLeave.lastGrantedYear": year,
    });
};

const evaluateAttendance = async ({ userId, attendanceId, punchIn, punchOut, isHalfDayLeaveOverride = false }) => {
    const user = await User.findById(userId).select("shift leaveBalance").lean();
    const sc = getShiftConfig(user?.shift);

    let isLate = false;
    let isHalfDay = isHalfDayLeaveOverride;
    let status = isHalfDayLeaveOverride ? "half-day" : "present";
    let lateMinutes = 0;
    let workHours = 0;
    let overtime = 0;
    let isShortLeave = false;
    let eightHourPassUsed = false;
    let halfDayReason = "";

    if (!punchIn) return { isLate, isHalfDay, status, lateMinutes, workHours, overtime, isShortLeave, eightHourPassUsed, halfDayReason };

    const punchInIST = moment(punchIn).tz("Asia/Kolkata");
    const todayStr = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");
    const attendanceDateStr = punchInIST.format("YYYY-MM-DD");
    const isPastDay = attendanceDateStr < todayStr;

    // 1. Missing Punch Out (MPO) detection for past days
    if (isPastDay && !punchOut) {
        return {
            isLate: false,
            isHalfDay: false,
            status: "absent",
            lateMinutes: 0,
            workHours: 0,
            overtime: 0,
            isShortLeave: false,
            eightHourPassUsed: false,
            halfDayReason: "Missing Punch Out",
            mpoFlag: true,
            mpoResolved: false
        };
    }

    const totalMinutes = punchInIST.hour() * 60 + punchInIST.minute();

    // 1. Morning Logic
    if (!isHalfDayLeaveOverride) {
        const monthStart = punchInIST.clone().startOf("month").toDate();
        const monthEnd = punchInIST.clone().endOf("month").toDate();

        const filter = {
            user: userId,
            date: { $gte: monthStart, $lte: monthEnd },
            isLate: true
        };
        if (attendanceId) filter._id = { $ne: attendanceId };
        const lateCount = await Attendance.countDocuments(filter);

        if (sc.isDefaultShift) {
            if (lateCount < 3) {
                if (totalMinutes <= sc.lateTrigger) { /* on time */ }
                else if (totalMinutes <= sc.halfDayCutoff) { isLate = true; status = "present"; }
                else { isHalfDay = true; status = "half-day"; }
            } else {
                if (totalMinutes > sc.onTimeCutoffP2) { isHalfDay = true; status = "half-day"; }
            }
        } else {
            if (totalMinutes > sc.lateTrigger && totalMinutes <= sc.halfDayCutoff) { isLate = true; status = "present"; }
            else if (totalMinutes > sc.halfDayCutoff) { isHalfDay = true; status = "half-day"; }
        }

        const shiftStartMnt = punchInIST.clone().hour(Math.floor(sc.shiftStart / 60)).minute(sc.shiftStart % 60).second(0);
        lateMinutes = (isLate || isHalfDay) ? parseFloat(Math.max(0, punchInIST.diff(shiftStartMnt, "minutes")).toFixed(2)) : 0;
    }

    // 2. Evening Logic
    if (punchOut) {
        const punchOutIST = moment(punchOut).tz("Asia/Kolkata");
        workHours = parseFloat(((punchOutIST - punchInIST) / 3600000).toFixed(2));
        const roundedWorkHours = workHours;

        const shiftEndMnt = punchOutIST.clone().hour(Math.floor(sc.shiftEnd / 60)).minute(sc.shiftEnd % 60).second(0);
        const overtimeMinutes = Math.max(0, punchOutIST.diff(shiftEndMnt, "minutes"));
        overtime = parseFloat((overtimeMinutes / 60).toFixed(2));

        const punchOutTotalMinutes = punchOutIST.hour() * 60 + punchOutIST.minute();
        const earlyExit = punchOutTotalMinutes < sc.shiftEnd;
        const shortHours = roundedWorkHours < 8.40;
        const totalWorkedMinutes = Math.round(workHours * 60);
        const withinGrace = totalWorkedMinutes >= (8.40 * 60 - 10);

        const shiftDurationMinutes = sc.shiftEnd > sc.shiftStart ? sc.shiftEnd - sc.shiftStart : (1440 - sc.shiftStart) + sc.shiftEnd;
        const shiftCompleted = totalWorkedMinutes >= (shiftDurationMinutes - 10);

        // ── LATE RECOVERY LOGIC ──────────────────────────────────────────
        // If employee was marked Half-Day purely due to morning late arrival,
        // optimistically convert it to Present+Late and let evening logic evaluate 
        // if they completed the required minimum working hours.
        let wasMorningHalfDay = false;
        if (isHalfDay && !isHalfDayLeaveOverride) {
            wasMorningHalfDay = true;
            isHalfDay = false;
            isLate = true;
            status = "present";
        }

        if (!isHalfDay && shortHours && !withinGrace && !shiftCompleted) {
            let leniencyApplied = false;

            // A. Check Short Leave
            const isInShortLeaveWindow = sc.isDefaultShift && punchOutTotalMinutes > (17 * 60 + 59) && punchOutTotalMinutes < (18 * 60 + 45);
            if (isInShortLeaveWindow) {
                const nowMonth = punchOutIST.month() + 1;
                const nowYear = punchOutIST.year();
                const sl = user.leaveBalance?.shortLeave || {};
                const isNewMonth = (sl.lastGrantedYear || nowYear) < nowYear || ((sl.lastGrantedYear || nowYear) === nowYear && (sl.lastGrantedMonth || nowMonth) < nowMonth);
                const slUsed = isNewMonth ? 0 : (sl.used || 0);

                if (slUsed < 1) {
                    isShortLeave = true;
                    status = "short-leave";
                    leniencyApplied = true;
                }
            }

            // B. Check 8-Hour Pass
            if (!leniencyApplied && roundedWorkHours >= 8) {
                const monthStartPass = punchOutIST.clone().startOf("month").toDate();
                const monthEndPass = punchOutIST.clone().endOf("month").toDate();
                const passesFilter = {
                    user: userId,
                    date: { $gte: monthStartPass, $lte: monthEndPass },
                    eightHourPassUsed: true
                };
                if (attendanceId) passesFilter._id = { $ne: attendanceId };
                const passesUsed = await Attendance.countDocuments(passesFilter);

                if (passesUsed < 1) {
                    eightHourPassUsed = true;
                    leniencyApplied = true;
                }
            }

            // C. Fallback: Half Day
            if (!leniencyApplied) {
                isHalfDay = true;
                status = "half-day";
                if (wasMorningHalfDay) {
                    halfDayReason = `Arrived late and worked only ${roundedWorkHours} hrs`;
                } else {
                    halfDayReason = earlyExit ? `Early exit and worked only ${roundedWorkHours} hrs` : `Worked only ${roundedWorkHours} hrs`;
                }
            }
        }
    }

    return {
        isLate, isHalfDay, status, lateMinutes, workHours, overtime,
        isShortLeave, eightHourPassUsed, halfDayReason
    };
};

module.exports = { evaluateAttendance, getShiftConfig, updateShortLeaveBalance };