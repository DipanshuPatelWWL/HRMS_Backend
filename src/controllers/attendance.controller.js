const Attendance = require("../models/attendance.model");
const User = require("../models/user.model");
const Holiday = require("../models/holiday.model");
const Leave = require("../models/leave.model");
const { createNotification } = require("./notification.controller");
const { sendMail } = require("../services/emailClient");
const moment = require("moment-timezone");
const { evaluateAttendance, getShiftConfig, updateShortLeaveBalance } = require("../utils/attendanceEvaluation");
const attendanceService = require("../utils/attendanceService");
const isDev = process.env.NODE_ENV !== "production";

// ─────────────────────────────────────────────
//  OFFICE CONFIG
// ─────────────────────────────────────────────
const OFFICE_LAT = 28.615965009689685;
const OFFICE_LNG = 77.37918363418639;
const GEOFENCE_RADIUS = 50; // meters

const ALLOWED_DEVICES = [
    { deviceUUID: "03000200-0400-0500-0006-000700080009", productId: "00331-10000-00001-AA159", label: "Bhupendra Office PC" },
    { deviceUUID: "FF9C4A14-678F-6F64-7353-E89C2511E53C", productId: "00331-10000-00001-AA316", label: "Jahid Office PC" },
    { deviceUUID: "03000200-0400-0500-0006-000700080009", productId: "00331-10000-00001-AA620", label: "Santosh Office PC" },
    { deviceUUID: "03000200-0400-0500-0006-000700080009", productId: "00330-80000-00000-AA007", label: "Anjali Office PC" },
    { deviceUUID: "03000200-0400-0500-0006-000700080009", productId: "00331-10000-00001-AA351", label: "Rajesh Office PC" },
    // { deviceUUID: "BCCB94D0-B8C8-9A11-A0E7-047C16132135", productId: "00355-79631-62791-AAOEM", label: "Dinkar Office PC" },
    { deviceUUID: "03000200-0400-0500-0006-000700080009", productId: "00331-10000-00001-AA611", label: "Hemant Office PC" },
    { deviceUUID: "4C4C4544-0032-4D10-8043-B4C04F504C32", productId: "00342-50786-03990-AAOEM", label: "Dipanshu Office PC" },
    { deviceUUID: "03000200-0400-0500-0006-000700080009", productId: "00329-00000-00003-AA198", label: "Desk-3 Office PC" },
    { deviceUUID: "03000200-0400-0500-0006-000700080009", productId: "00330-80000-00000-AA681", label: "Bhupendra Office" },
    { deviceUUID: "03000200-0400-0500-0006-000700080009", productId: "00330-80000-00000-AA082", label: "Bhupendra Office" }
];

const MONTHLY_LATE_QUOTA = 3;
const GRACE_MINUTES_BEFORE_SHIFT_END = 10;
const MIN_WORK_HOURS = 9;
const LENIENCY_WORK_HOURS = 8;
const MONTHLY_8HR_PASS_LIMIT = 1;
const SHORT_LEAVE_WINDOW_OPEN = 17 * 60 + 59;
const SHORT_LEAVE_WINDOW_CLOSE = 18 * 60 + 45;

const formatTime = (date) => moment(date).tz("Asia/Kolkata").format("hh:mm a");

const isWeekend = (date) => {
    const day = moment(date).tz("Asia/Kolkata").day();
    return day === 0 || day === 6;
};

const toRad = (v) => (v * Math.PI) / 180;
const getDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const punchIn = async (req, res) => {
    try {
        const userId = req.user._id;
        const { deviceId, wifiSSID, isOfflinePunch, offlineTimestamp, deviceUUID, productId, lat, lng, accuracy } = req.body || {};

        const serverNow = moment().tz("Asia/Kolkata");
        let now = serverNow.clone();

        if (isOfflinePunch) {
            if (!offlineTimestamp) return res.status(400).json({ success: false, message: "Offline timestamp required" });
            const parsedOfflineTime = moment.tz(offlineTimestamp, "Asia/Kolkata");
            if (!parsedOfflineTime.isValid()) return res.status(400).json({ success: false, message: "Invalid offline timestamp" });
            const diffMinutes = serverNow.diff(parsedOfflineTime, "minutes");
            if (diffMinutes > 60) return res.status(400).json({ success: false, message: "Offline punch expired" });
            if (diffMinutes < -60) return res.status(400).json({ success: false, message: "Future timestamp not allowed" });
            now = parsedOfflineTime.clone();
        }

        const nowDate = now.toDate();
        const todayStart = now.clone().startOf("day").toDate();
        const todayEnd = now.clone().endOf("day").toDate();
        const todayString = now.clone().format("YYYY-MM-DD");
        const monthStart = now.clone().startOf("month").toDate();
        const monthEnd = now.clone().endOf("month").toDate();
        const totalMinutes = now.hour() * 60 + now.minute();

        if (now.day() === 0 || now.day() === 6) {
            return res.status(400).json({ success: false, message: "Office is closed on weekends" });
        }

        const [userDoc, holiday, leave, existing, lateCount] = await Promise.all([
            User.findById(userId).select("shift reportingTo email name").lean(),
            Holiday.findOne({ date: { $gte: todayStart, $lte: todayEnd } }).lean(),
            Leave.findOne({ user: userId, status: "approved", fromDate: { $lte: todayEnd }, toDate: { $gte: todayStart } }).lean(),
            Attendance.findOne({ user: userId, dateString: todayString }).select("_id punchOut").lean(),
            Attendance.countDocuments({ user: userId, date: { $gte: monthStart, $lte: monthEnd }, isLate: true })
        ]);

        if (holiday) return res.status(400).json({ success: false, message: `Today is a holiday: ${holiday.name}` });

        let isHalfDayLeaveOverride = false;
        if (leave) {
            const isHalfDayLeave = leave.leaveType === "half-day" || leave.halfDay === true;
            if (!isHalfDayLeave) return res.status(400).json({ success: false, message: "You are on approved leave" });
            isHalfDayLeaveOverride = true;
        }

        if (existing) {
            return res.status(400).json({ success: false, message: existing.punchOut ? "Attendance already completed for today" : "Already punched in — please punch out first" });
        }

        const sc = getShiftConfig(userDoc?.shift);
        const windowOpen = (sc.shiftStart - 60 + 1440) % 1440;
        const windowClose = (sc.shiftEnd + 60) % 1440;
        const inWindow = windowOpen <= windowClose ? totalMinutes >= windowOpen && totalMinutes <= windowClose : totalMinutes >= windowOpen || totalMinutes <= windowClose;

        if (!inWindow) {
            const fmt = (m) => { const h = Math.floor(m / 60) % 24; const mn = m % 60; const ap = h >= 12 ? "PM" : "AM"; return `${h % 12 || 12}:${String(mn).padStart(2, "0")} ${ap}`; };
            return res.status(400).json({ success: false, message: `Punch-in allowed only between ${fmt(windowOpen)} and ${fmt(windowClose)}` });
        }

        const clientIP = (req.socket?.remoteAddress || "").replace(/^::ffff:/, "");

        // ── Mobile Block ──────────────────────────────────────────────
        const ua = req.headers["user-agent"] || "";
        const clientType = req.headers["x-client-type"] || "";
        const isMobile = /android|iphone|ipad|ipod|opera mini|iemobile|mobile/i.test(ua);
        if (isMobile && clientType !== "electron") {
            return res.status(403).json({
                success: false,
                message: "Attendance from mobile devices is not allowed"
            });
        }

        // ── WFH Detection ─────────────────────────────────────────────
        const now2 = new Date();
        const wlc = userDoc?.workLocationConfig;
        const isWFH =
            userDoc?.workLocation === "wfh" &&
            wlc?.startDate && wlc?.endDate &&
            now2 >= new Date(wlc.startDate) &&
            now2 <= new Date(wlc.endDate);

        let verifiedBy = "device";

        if (isOfflinePunch) {
            verifiedBy = "offline";

        } else {
            // ── Primary: deviceToken verification ─────────────────────
            const { deviceToken } = req.body || {};

            const fullUser = await User.findById(userId)
                .select("approvedDevices")
                .lean();

            let matchedDevice = null;

            if (deviceToken) {
                matchedDevice = fullUser?.approvedDevices?.find(
                    d => d.deviceToken === deviceToken
                );

                if (!matchedDevice) {
                    return res.status(403).json({
                        success: false,
                        message: "Device token invalid or revoked. Please contact HR."
                    });
                }
            } else if (deviceUUID && productId) {
                // Fallback: agent hasn't persisted the token locally yet,
                // but the hardware identity already matches an approved device.
                matchedDevice = fullUser?.approvedDevices?.find(
                    d => d.deviceUUID === deviceUUID && d.productId === productId
                );
            }

            if (matchedDevice) {
                await User.updateOne(
                    { _id: userId, "approvedDevices.deviceToken": matchedDevice.deviceToken },
                    { $set: { "approvedDevices.$.lastUsedAt": new Date() } }
                );
                verifiedBy = "device";

            } else if (isWFH) {
                verifiedBy = "location";

            } else {
                return res.status(403).json({
                    success: false,
                    code: "DEVICE_NOT_APPROVED",
                    message: "Device not approved. You can request approval from HR to punch in from this device.",
                    device: {
                        deviceUUID: deviceUUID || "",
                        productId: productId || "",
                    }
                });
            }
        }

        const evalResult = await evaluateAttendance({
            userId,
            attendanceId: null,
            punchIn: nowDate,
            punchOut: null,
            isHalfDayLeaveOverride
        });

        const { isLate, isHalfDay, status, lateMinutes } = evalResult;

        let attendance;
        try {
            const { deviceToken, lat, lng, accuracy, deviceId, deviceUUID, productId, wifiSSID } = req.body || {};
            attendance = await Attendance.create({
                user: userId,
                date: todayStart,
                dateString: todayString,
                workLocation: isWFH ? "wfh" : "office",
                punchIn: nowDate,
                lateMinutes,
                isLate,
                isHalfDay,
                status,
                location: { lat, lng, accuracy },
                deviceId: deviceId || "",
                deviceUUID: deviceUUID || "",
                productId: productId || "",
                wifiSSID: wifiSSID || "",
                isOfflinePunch: !!isOfflinePunch,
                syncedAt: isOfflinePunch ? serverNow.toDate() : null,
                verifiedBy,
                clientIP,
            });
        } catch (err) {
            if (err.code === 11000) return res.status(400).json({ success: false, message: "Attendance already exists for today" });
            throw err;
        }

        const io = req.app.get("io");
        io.to(`user_${userId}`).emit("tracker:start", { attendanceId: attendance._id, timestamp: new Date() });

        res.status(201).json({ success: true, message: "Punch-in successful", attendance, lateQuotaUsed: isLate ? lateCount + 1 : lateCount, lateQuotaMax: MONTHLY_LATE_QUOTA });

        setImmediate(async () => {
            try {
                const employeeName = req.user.name || "An employee";
                const punchTime = formatTime(nowDate);
                let statusLabel = "✅ On Time";
                if (isHalfDay) statusLabel = "⚠️ Half Day";
                else if (isLate) statusLabel = `⏰ Late (+${lateMinutes}m)`;

                if ((isHalfDay || isLate) && userDoc?.email) {
                    let emailSubject = isHalfDay ? "⚠️ Half Day Marked" : "⏰ Late Arrival Recorded";
                    let emailHtml = `<p>Hi ${userDoc.name}, your punch-in at <b>${formatTime(nowDate)}</b> has been recorded as <b>${isHalfDay ? "Half Day" : "Late"}</b>.</p>`;

                    if (isHalfDay) {
                        emailSubject = "Late Arrival - Half Day Recovery Available";
                        emailHtml = `
                            <p>Hi ${userDoc.name},</p>
                            <p>You have reported after the permitted arrival time (<b>${formatTime(nowDate)}</b>) and your attendance is currently marked as <b>Half Day</b>.</p>
                            <p>If you complete the required working hours for today, the system will automatically convert your attendance to <b>Present + Late</b> during final attendance evaluation at punch-out.</p>
                            <p>No manual correction request is required.</p>
                        `;
                    }

                    sendMail({
                        to: userDoc.email,
                        subject: emailSubject,
                        html: emailHtml
                    }).catch(err => console.error("Email error:", err));
                }

                const notifyUsersRaw = await User.find({ $or: [{ role: { $in: ["hr", "manager", "admin"] } }, ...(userDoc?.reportingTo ? [{ _id: userDoc.reportingTo }] : [])] }).select("_id").lean();
                const notifyIdSet = new Set(notifyUsersRaw.map(u => u._id.toString()).filter(sid => sid !== userId.toString()));
                await Promise.allSettled([...notifyIdSet].map(sid => createNotification(io, sid, `${employeeName} Punched In`, `Punched in at ${punchTime} — ${statusLabel}`, "attendance", { userId, attendanceId: attendance._id, status, isLate, isHalfDay })));
            } catch (err) { console.error(err); }
        });
    } catch (error) {
        console.error("PunchIn Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const punchOut = async (req, res) => {
    try {
        const userId = req.user._id;
        const { isOfflinePunch, offlineTimestamp } = req.body || {};
        const serverNow = moment().tz("Asia/Kolkata");
        let now = serverNow.clone();

        if (isOfflinePunch) {
            if (!offlineTimestamp) return res.status(400).json({ success: false, message: "Offline timestamp required" });
            const parsedOfflineTime = moment.tz(offlineTimestamp, "Asia/Kolkata");
            if (!parsedOfflineTime.isValid()) return res.status(400).json({ success: false, message: "Invalid offline timestamp" });
            const diffMinutes = serverNow.diff(parsedOfflineTime, "minutes");
            if (diffMinutes > 60) return res.status(400).json({ success: false, message: "Offline punch expired" });
            if (diffMinutes < -60) return res.status(400).json({ success: false, message: "Future timestamp not allowed" });
            now = parsedOfflineTime.clone();
        }

        const nowDate = now.toDate();
        const todayString = now.clone().format("YYYY-MM-DD");
        const todayStart = now.clone().startOf("day").toDate();
        const todayEnd = now.clone().endOf("day").toDate();

        const userDocForOutTiming = await User.findById(userId).select("shift").lean();
        const scForOutTiming = getShiftConfig(userDocForOutTiming?.shift);
        const totalMinutesNowOut = now.hour() * 60 + now.minute();
        const outWindowOpen = (scForOutTiming.shiftStart - 60 + 1440) % 1440;
        const outWindowClose = (scForOutTiming.shiftEnd + 60) % 1440;
        const inOutWindow = outWindowOpen <= outWindowClose ? totalMinutesNowOut >= outWindowOpen && totalMinutesNowOut <= outWindowClose : totalMinutesNowOut >= outWindowOpen || totalMinutesNowOut <= outWindowClose;

        if (!inOutWindow) {
            const fmt = (m) => { const h = Math.floor(m / 60) % 24; const min = m % 60; const ap = h >= 12 ? "PM" : "AM"; return `${h % 12 || 12}:${String(min).padStart(2, "0")} ${ap}`; };
            return res.status(400).json({ success: false, message: `Punch-out allowed only between ${fmt(outWindowOpen)} and ${fmt(outWindowClose)}` });
        }

        if (now.day() === 0 || now.day() === 6) return res.status(400).json({ success: false, message: "Office is closed on weekends" });

        const holiday = await Holiday.findOne({ date: { $gte: todayStart, $lte: todayEnd } });
        if (holiday) return res.status(400).json({ success: false, message: `Today is a holiday: ${holiday.name}` });

        let attendance = await Attendance.findOne({ user: userId, dateString: todayString });
        if (!attendance || attendance.punchOut) {
            const yesterdayString = now.clone().subtract(1, "day").format("YYYY-MM-DD");
            const yesterdayAtt = await Attendance.findOne({ user: userId, dateString: yesterdayString, punchOut: null });
            if (yesterdayAtt) attendance = yesterdayAtt;
        }
        if (!attendance || attendance.punchOut) {
            const twoDaysAgoString = now.clone().subtract(2, "day").format("YYYY-MM-DD");
            const twoDaysAgoAtt = await Attendance.findOne({ user: userId, dateString: twoDaysAgoString, punchOut: null });
            if (twoDaysAgoAtt) attendance = twoDaysAgoAtt;
        }

        if (!attendance) return res.status(404).json({ success: false, message: "No punch-in found for today" });
        if (attendance.punchOut) return res.status(400).json({ success: false, message: "Already punched out" });
        if (moment(nowDate).isBefore(attendance.punchIn)) return res.status(400).json({ success: false, message: "Punch-out cannot be before punch-in" });

        const leave = await Leave.findOne({ user: userId, status: "approved", fromDate: { $lte: todayEnd }, toDate: { $gte: todayStart } }).lean();
        const isHalfDayLeaveOverride = leave ? (leave.leaveType === "half-day" || leave.halfDay === true) : false;

        const evalResult = await evaluateAttendance({
            userId,
            attendanceId: attendance._id,
            punchIn: attendance.punchIn,
            punchOut: nowDate,
            isHalfDayLeaveOverride
        });

        const workHours = evalResult.workHours;
        const roundedWorkHours = evalResult.workHours;
        const overtime = evalResult.overtime;

        let usedShortLeave = false;
        let used8HrPass = false;
        let halfDayReason = evalResult.halfDayReason;

        if (!attendance.isShortLeave && evalResult.isShortLeave) {
            usedShortLeave = true;
            await updateShortLeaveBalance(userId, nowDate, "deduct");
            User.findById(userId).select("email name").then(employee => {
                if (!employee) return;
                sendMail({
                    to: employee.email,
                    subject: "🕐 Short Leave Marked",
                    html: `<p>Hi ${employee.name},</p><p>Your punch-out at <b>${formatTime(nowDate)}</b> has been recorded as a <b>Short Leave</b>.</p><p>Hours Worked: <b>${roundedWorkHours} hrs</b></p><p>⚠️ Your monthly short leave quota (1/month) has been consumed. It will reset next month.</p>`,
                }).catch(err => console.error(err));
            }).catch(err => console.error(err));
        }

        if (!attendance.isHalfDay && evalResult.isHalfDay && !evalResult.isShortLeave) {
            User.findById(userId).select("email name").then(employee => {
                if (!employee) return;
                sendMail({
                    to: employee.email,
                    subject: "⚠️ Half Day Marked",
                    html: `<p>Hi ${employee.name},</p><p>Your attendance has been marked as <b>Half Day</b>.</p><p>Reason: <b>${halfDayReason || "Incomplete work hours"}</b></p><p>Punch Out: <b>${formatTime(nowDate)}</b> · Hours Worked: <b>${roundedWorkHours} hrs</b></p>`,
                }).catch(err => console.error(err));
            }).catch(err => console.error(err));
        }

        if (!attendance.eightHourPassUsed && evalResult.eightHourPassUsed) used8HrPass = true;

        attendance.isLate = evalResult.isLate;
        attendance.isHalfDay = evalResult.isHalfDay;
        attendance.status = evalResult.status;
        attendance.lateMinutes = evalResult.lateMinutes;
        attendance.isShortLeave = evalResult.isShortLeave;
        attendance.eightHourPassUsed = evalResult.eightHourPassUsed;

        attendance.punchOut = nowDate;
        attendance.workHours = workHours;
        attendance.overtime = overtime;
        attendance.isOfflinePunch = !!isOfflinePunch;
        if (isOfflinePunch) attendance.syncedAt = serverNow.toDate();

        await attendance.save();

        if (used8HrPass) {
            User.findById(userId).select("email name").then(employee => {
                if (!employee) return;
                sendMail({
                    to: employee.email,
                    subject: "✅ Full Day Marked (Monthly 8-Hour Pass Used)",
                    html: `<p>Hi ${employee.name},</p><p>You worked <b>${roundedWorkHours} hrs</b> today (punched out at <b>${formatTime(nowDate)}</b>).</p><p>Your attendance has been marked as <b>Full Day</b> using your monthly 8-hour pass.</p><p>⚠️ This pass has been used for this month and will reset next month.</p>`,
                }).catch(err => console.error(err));
            }).catch(err => console.error(err));
        }

        const io = req.app.get("io");
        io.to(`user_${userId}`).emit("tracker:stop", { attendanceId: attendance._id, timestamp: new Date() });

        const employeeName = req.user.name || "An employee";
        const punchTime = formatTime(nowDate);
        const hrs = Math.floor(workHours);
        const mins = Math.round((workHours - hrs) * 60);
        const workLabel = `${hrs}h ${mins}m worked`;
        const overtimeLabel = overtime > 0 ? ` · OT: ${Math.floor(overtime)}h ${Math.round((overtime % 1) * 60)}m` : "";
        const halfDayLabel = attendance.isShortLeave ? ` · 🕐 Short Leave` : attendance.isHalfDay ? ` · ⚠️ Half Day` : "";

        const employeeDoc = await User.findById(userId).select("reportingTo").lean();
        const notifyUsersRaw = await User.find({
            $or: [{ role: { $in: ["hr", "manager", "admin"] } }, ...(employeeDoc?.reportingTo ? [{ _id: employeeDoc.reportingTo }] : [])]
        }).select("_id");
        const notifyIdSet = new Set();
        for (const u of notifyUsersRaw) {
            const sid = u._id.toString();
            if (sid !== userId.toString()) notifyIdSet.add(sid);
        }

        await Promise.allSettled([...notifyIdSet].map(sid => createNotification(io, sid, `${employeeName} Punched Out`, `Punched out at ${punchTime} — ${workLabel}${overtimeLabel}${halfDayLabel}`, "attendance", { userId, attendanceId: attendance._id, workHours, overtime, isHalfDay: attendance.isHalfDay })));

        res.status(200).json({ success: true, message: "Punch-out successful", attendance });
    } catch (error) {
        console.error("PunchOut Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET TODAY'S ATTENDANCE
// ─────────────────────────────────────────────
const getTodayAttendance = async (req, res) => {
    try {
        const todayString = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");
        const attendance = await Attendance.findOne({
            user: req.user._id,
            dateString: todayString
        });

        const user = await User.findById(req.user._id).select("shift").lean();
        const sc = getShiftConfig(user?.shift);

        res.status(200).json({
            success: true,
            attendance,
            shiftEnd: sc.shiftEnd
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET MONTHLY ATTENDANCE
// ─────────────────────────────────────────────
const getMonthlyAttendance = async (req, res) => {
    try {
        const { month, year, userId: targetId } = req.query;
        const isAdmin = ["hr", "manager", "superadmin"].includes(req.user.role);
        const userId = (targetId && isAdmin) ? targetId : req.user._id;

        if (targetId && targetId.toString() !== req.user._id.toString() && !isAdmin) {
            return res.status(403).json({ success: false, message: "Unauthorized to view other's attendance" });
        }

        const m = parseInt(month);
        const y = parseInt(year);
        const startMoment = moment.tz(
            {
                year: y,
                month: m - 1,
                day: 1,
            },
            "Asia/Kolkata"
        );

        const startOfMonth = startMoment.clone().startOf("month");
        const endOfMonth = startMoment.clone().endOf("month");

        const data = await attendanceService.getAttendanceGrid(
            userId,
            startOfMonth.toDate(),
            endOfMonth.toDate()
        );

        const summary = attendanceService.calculateStats(data);

        res.status(200).json({
            success: true,
            data,
            summary
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET WEEKLY ATTENDANCE SUMMARY
// ─────────────────────────────────────────────
const getWeeklyAttendanceSummary = async (req, res) => {
    try {
        const start = moment().tz("Asia/Kolkata").subtract(7, "days").startOf("day").toDate();

        const validUsers = await User.find({ role: { $nin: ["superadmin", "manager"] } }).select("_id").lean();
        const validIds = validUsers.map(u => u._id);

        const data = await Attendance.aggregate([
            { $match: { date: { $gte: start }, user: { $in: validIds } } },
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET TEAM ATTENDANCE (TL)
// ─────────────────────────────────────────────
const getTeamAttendance = async (req, res) => {
    try {
        const { month, year, date } = req.query;
        const nowIST = moment().tz("Asia/Kolkata");

        const todayStr = date || nowIST.format("YYYY-MM-DD");
        const todayStart = moment.tz(todayStr, "Asia/Kolkata").startOf("day").toDate();
        const todayEnd = moment.tz(todayStr, "Asia/Kolkata").endOf("day").toDate();

        const m = parseInt(month) || (nowIST.month() + 1);
        const y = parseInt(year) || nowIST.year();
        const startOfMonth = moment
            .tz(
                {
                    year: y,
                    month: m - 1,
                    day: 1,
                },
                "Asia/Kolkata"
            )
            .startOf("month");

        const endOfMonth = startOfMonth.clone().endOf("month");

        const teamMembers = await User.find({
            reportingTo: req.user._id,
            status: "active"
        }).select("_id name employeeId department designation joiningDate createdAt shift").lean();
        const teamIds = teamMembers.map(m => m._id.toString());

        if (teamIds.length === 0) {
            return res.status(200).json({ success: true, todaySummary: [], teamMembers: [], monthlyGrid: [] });
        }

        const [attendanceToday, leavesToday, todayHolidays] = await Promise.all([
            Attendance.find({ user: { $in: teamIds }, dateString: todayStr }).lean(),
            Leave.find({ user: { $in: teamIds }, status: "approved", fromDate: { $lte: todayEnd }, toDate: { $gte: todayStart } }).lean(),
            Holiday.findOne({ date: { $gte: todayStart, $lte: todayEnd } }).lean()
        ]);

        const attMap = new Map(attendanceToday.map(a => [a.user.toString(), a]));
        const leaveMap = new Map(leavesToday.map(l => [l.user.toString(), l]));

        const todaySummary = teamMembers.map(u => {
            const att = attMap.get(u._id.toString());
            const leave = leaveMap.get(u._id.toString());
            const isWeekend = moment(todayStart).day() === 0 || moment(todayStart).day() === 6;
            const isFuture = moment(todayStart).isAfter(nowIST, "day");
            const joiningDate = u.joiningDate || u.createdAt;
            const isJoined = joiningDate ? moment(todayStart).isSameOrAfter(moment(joiningDate).tz("Asia/Kolkata").startOf("day")) : true;

            let attendanceStatus = "absent";
            if (!isJoined) attendanceStatus = "not_joined";
            else if (leave) attendanceStatus = "on_leave";
            else if (todayHolidays) attendanceStatus = "holiday";
            else if (isWeekend) attendanceStatus = "weekend";
            else if (att) {
                attendanceStatus = att.punchOut ? "punched_out" : "punched_in";
            } else if (isFuture) {
                attendanceStatus = "future";
            }

            return {
                ...u,
                punchIn: att?.punchIn,
                punchOut: att?.punchOut,
                workHours: att?.workHours,
                attendanceStatus,
                onLeave: !!leave,
                isLate: att?.isLate,
                isHalfDay: att?.isHalfDay,
                missedPunchOut: att?.missedPunchOut
            };
        });

        // Monthly Grid Calculation using centralized service
        const monthlyGrid = await Promise.all(teamMembers.map(async (u) => {
            const grid = await attendanceService.getAttendanceGrid(u._id, startOfMonth.toDate(), endOfMonth.toDate());
            const stats = attendanceService.calculateStats(grid);
            return {
                ...u,
                days: grid,
                stats
            };
        }));

        res.status(200).json({ success: true, todaySummary, teamMembers, monthlyGrid });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET HR ATTENDANCE OVERVIEW
// ─────────────────────────────────────────────
// NEW
const getHRAttendanceOverview = async (req, res) => {
    try {
        const { date, month, year } = req.query;
        const nowIST = moment().tz("Asia/Kolkata");
        const todayStr = date || nowIST.format("YYYY-MM-DD");
        const todayStart = moment.tz(todayStr, "Asia/Kolkata").startOf("day").toDate();
        const todayEnd = moment.tz(todayStr, "Asia/Kolkata").endOf("day").toDate();
        const isTodayWeekend = moment.tz(todayStr, "Asia/Kolkata").day() === 0 || moment.tz(todayStr, "Asia/Kolkata").day() === 6;

        const m = parseInt(month) || (nowIST.month() + 1);
        const y = parseInt(year) || nowIST.year();
        const monthStart = moment.tz(`${y}-${m}-01`, "YYYY-MM-DD", "Asia/Kolkata").startOf("month").toDate();
        const monthEnd = moment.tz(`${y}-${m}-01`, "YYYY-MM-DD", "Asia/Kolkata").endOf("month").toDate();

        const users = await User.find({
            status: "active",
            role: { $nin: ["superadmin", "manager"] }
        }).select("name employeeId department designation joiningDate shift").lean();
        const validUserIds = users.map(u => u._id);

        const [attendanceToday, leavesToday, monthlyAttendance, monthlyLeaves, todayHoliday] = await Promise.all([
            Attendance.find({ user: { $in: validUserIds }, dateString: todayStr }).lean(),
            Leave.find({ user: { $in: validUserIds }, status: "approved", fromDate: { $lte: todayEnd }, toDate: { $gte: todayStart } }).populate("user", "name").lean(),
            Attendance.find({ user: { $in: validUserIds }, date: { $gte: monthStart, $lte: monthEnd } }).lean(),
            Leave.find({ user: { $in: validUserIds }, status: "approved", fromDate: { $lte: monthEnd }, toDate: { $gte: monthStart } }).lean(),
            Holiday.findOne({ date: { $gte: todayStart, $lte: todayEnd } }).lean()
        ]);

        const attMap = new Map(attendanceToday.map(a => [a.user.toString(), a]));
        const leaveSet = new Set(leavesToday.map(l => l.user._id ? l.user._id.toString() : l.user.toString()));

        const todaySummary = users.map(u => {
            const att = attMap.get(u._id.toString());
            const onLeave = leaveSet.has(u._id.toString());
            let attendanceStatus = "absent";
            if (onLeave) attendanceStatus = "on_leave";
            else if (todayHoliday) attendanceStatus = "holiday";
            else if (isTodayWeekend) attendanceStatus = "weekend";
            else if (att) {
                attendanceStatus = att.punchOut ? "punched_out" : "punched_in";
            }

            return {
                ...u,
                punchIn: att?.punchIn,
                punchOut: att?.punchOut,
                workHours: att?.workHours,
                lateMinutes: att?.lateMinutes,
                isLate: att?.isLate,
                isHalfDay: att?.isHalfDay,
                attendanceStatus,
                onLeave
            };
        });

        // absentToday now derives from the same resolved status used in todaySummary,
        // so holidays/weekends never get counted as absent
        const absentToday = todaySummary.filter(e => e.attendanceStatus === "absent").length;

        const todayOverview = {
            totalActive: users.length,
            punchedIn: attendanceToday.filter(a => !a.punchOut && !a.missedPunchOut).length,
            punchedOut: attendanceToday.filter(a => a.punchOut).length,
            absentToday,
            onLeaveTodayCount: leavesToday.length,
            lateToday: attendanceToday.filter(a => a.isLate).length,
            missedPunchOut: attendanceToday.filter(a => a.missedPunchOut).length,
            isHoliday: !!todayHoliday,
            isWeekend: isTodayWeekend,
            holidayName: todayHoliday?.name || null
        };

        // Monthly stats aggregation using centralized service
        const monthlyStats = await Promise.all(users.map(async (u) => {
            const grid = await attendanceService.getAttendanceGrid(u._id, monthStart, monthEnd);
            const stats = attendanceService.calculateStats(grid);
            return {
                ...u,
                stats: {
                    ...stats,
                    presentDays: stats.present,
                    halfDays: stats.halfDay,
                    lateDays: stats.late,
                    leaveDays: stats.leave,
                    absentDays: stats.absent,
                }
            };
        }));

        res.status(200).json({ success: true, todaySummary, todayOverview, monthlyStats, leaves: leavesToday });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET DAY WISE ATTENDANCE
// ─────────────────────────────────────────────
const getDayWiseAttendance = async (req, res) => {
    try {
        const { date, search, department, status: statusFilter } = req.query;

        const queryDate = date
            ? moment.tz(date, "Asia/Kolkata").startOf("day")
            : moment().tz("Asia/Kolkata").startOf("day");

        const users = await User.find({
            status: "active",
            role: { $nin: ["superadmin", "manager"] }
        })
            .select("name employeeId department joiningDate createdAt shift")
            .lean();

        const data = await Promise.all(
            users.map(async (u) => {
                const grid = await attendanceService.getAttendanceGrid(
                    u._id,
                    queryDate.toDate(),
                    queryDate.toDate()
                );

                const day = grid?.[0] || {};
                let normalizedStatus = day.status || "absent";

                if (day.status === "on_leave") {
                    normalizedStatus = "leave";
                }

                if (day.status === "half-day" || day.isHalfDay) {
                    normalizedStatus = "halfday";
                }

                return {
                    ...u,
                    ...day,
                    status: normalizedStatus
                };
            })
        );

        // Filtering
        const filtered = data.filter((item) => {
            const matchesSearch =
                !search ||
                item.name?.toLowerCase().includes(search.toLowerCase()) ||
                item.employeeId?.toLowerCase().includes(search.toLowerCase());

            const matchesDept =
                !department ||
                department === "all" ||
                item.department === department;

            const matchesStatus =
                !statusFilter ||
                statusFilter === "all" ||
                item.status === statusFilter;

            return matchesSearch && matchesDept && matchesStatus;
        });

        const summary = {
            total: filtered.length,
            present: filtered.filter((a) => a.status === "present").length,
            late: filtered.filter((a) => a.status === "late").length,
            halfday: filtered.filter(
                (a) =>
                    a.status === "halfday" ||
                    a.status === "half-day" ||
                    a.isHalfDay
            ).length,
            absent: filtered.filter((a) => a.status === "absent").length,
            leave: filtered.filter(
                (a) =>
                    a.status === "leave" ||
                    a.status === "on_leave"
            ).length,
            holiday: filtered.filter((a) => a.status === "holiday").length,
            weekend: filtered.filter((a) => a.status === "weekend").length
        };

        res.status(200).json({
            success: true,
            data: filtered,
            summary,
            total: filtered.length
        });
    } catch (error) {
        console.error("Get Day Wise Attendance Error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    punchIn,
    punchOut,
    getTodayAttendance,
    getMonthlyAttendance,
    getWeeklyAttendanceSummary,
    getTeamAttendance,
    getHRAttendanceOverview,
    getDayWiseAttendance
};