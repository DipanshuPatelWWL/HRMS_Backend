const Attendance = require("../models/attendance.model");
const User = require("../models/user.model");
const Holiday = require("../models/holiday.model");
const Leave = require("../models/leave.model");
const { createNotification } = require("./notification.controller");
const { sendMail } = require("../services/emailClient");
const moment = require("moment-timezone");
const isDev = process.env.NODE_ENV !== "production";
// ─────────────────────────────────────────────
//  OFFICE CONFIG
// ─────────────────────────────────────────────
const OFFICE_LAT = 28.615965009689685;
const OFFICE_LNG = 77.37918363418639;
const GEOFENCE_RADIUS = 50; // meters

// ─────────────────────────────────────────────
//  SHIFT TIMING (in minutes from midnight)
// ─────────────────────────────────────────────
const OFFICE_START = 10 * 60 + 0;   // 10:00 → shift starts
const LATE_TRIGGER = 10 * 60 + 15;  // 10:15 → after this, quota consumed (Phase 1)
const LATE_CUTOFF = 10 * 60 + 30;  // 10:30 → after this, half-day (quota NOT consumed)
const ONTIME_CUTOFF_P2 = 10 * 60 + 5;   // 10:05 → grace period when quota exhausted (Phase 2)
const MONTHLY_LATE_QUOTA = 3;
const SHIFT_END_MINUTES = 17 * 60;
const MIN_WORK_HOURS = 9;
const LENIENCY_WORK_HOURS = 8;
const GRACE_MINUTES_BEFORE_SHIFT_END = 10;
const MONTHLY_8HR_PASS_LIMIT = 1;

const formatTime = (date) =>
    moment(date).tz("Asia/Kolkata").format("hh:mm a");



// ── Derive shift config for a user ──────────────────────────────────
// Returns timing constants derived from the user's shift document.
// If shift.type === "default" the classic 10–19 + quota rules apply.
const getShiftConfig = (shift) => {
    const s = shift || {};
    const startH = s.startHour ?? 10;
    const startM = s.startMinute ?? 0;
    const endH = s.endHour ?? 19;
    const endM = s.endMinute ?? 0;
    const grace = s.graceMinutes ?? 15;  // late trigger
    const halfAt = s.halfDayAfterMinutes ?? 30;  // half-day trigger

    const shiftStart = startH * 60 + startM;
    const lateTrigger = shiftStart + grace;
    const halfDayCutoff = shiftStart + halfAt;
    const shiftEnd = endH * 60 + endM;

    // quota rules only apply to the DEFAULT 10:00–19:00 shift
    const isDefaultShift =
        (s.type === "default" || !s.type) &&
        startH === 10 && startM === 0 &&
        endH === 19 && endM === 0;

    // Phase-2 grace (quota exhausted): 5 min after shift start
    const onTimeCutoffP2 = shiftStart + 5;

    return {
        shiftStart,
        lateTrigger,
        halfDayCutoff,
        shiftEnd,
        onTimeCutoffP2,
        isDefaultShift,
    };
};

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
const isWeekend = (date) => {
    const day = new Date(date).getDay();
    return day === 0 || day === 6;
};

const toRad = (v) => (v * Math.PI) / 180;

const getDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};


// ─────────────────────────────────────────────
//  PUNCH IN
// ─────────────────────────────────────────────
const punchIn = async (req, res) => {
    try {
        const userId = req.user._id;

        const {
            lat,
            lng,
            accuracy,
            deviceId,
            wifiSSID,
            isOfflinePunch,
            offlineTimestamp,
        } = req.body || {};

        // ─────────────────────────────────────────────
        // INDIA TIMEZONE
        // ─────────────────────────────────────────────
        const serverNow = moment().tz("Asia/Kolkata");

        // Offline timestamp validation
        let now = serverNow.clone();

        if (isOfflinePunch) {

            if (!offlineTimestamp) {
                return res.status(400).json({
                    success: false,
                    message: "Offline timestamp required",
                });
            }

            const parsedOfflineTime = moment
                .tz(offlineTimestamp, "Asia/Kolkata");

            if (!parsedOfflineTime.isValid()) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid offline timestamp",
                });
            }

            // Allow only last 2 hours offline sync
            const diffMinutes = serverNow.diff(parsedOfflineTime, "minutes");

            if (diffMinutes > 120) {
                return res.status(400).json({
                    success: false,
                    message: "Offline punch expired",
                });
            }

            // Prevent future timestamps
            if (diffMinutes < 0) {
                return res.status(400).json({
                    success: false,
                    message: "Future timestamp not allowed",
                });
            }

            now = parsedOfflineTime.clone();
        }

        const nowDate = now.toDate();

        // Attendance date
        const todayStart = now.clone().startOf("day").toDate();
        const todayEnd = now.clone().endOf("day").toDate();
        const todayString = now.clone().format("YYYY-MM-DD");

        // ─────────────────────────────────────────────
        // OFFICE TIMING CHECK
        // ─────────────────────────────────────────────
        const hour = now.hour();

        if (hour < 9 || hour >= 21) {
            return res.status(400).json({
                success: false,
                message: "Punch allowed only between 9 AM to 9 PM",
            });
        }

        // ─────────────────────────────────────────────
        // WEEKEND CHECK
        // ─────────────────────────────────────────────
        if (now.day() === 0 || now.day() === 6) {
            return res.status(400).json({
                success: false,
                message: "Office is closed on weekends",
            });
        }

        // ─────────────────────────────────────────────
        // HOLIDAY CHECK
        // ─────────────────────────────────────────────
        const holiday = await Holiday.findOne({
            date: {
                $gte: todayStart,
                $lte: todayEnd,
            },
        });

        if (holiday) {
            return res.status(400).json({
                success: false,
                message: `Today is a holiday: ${holiday.name}`,
            });
        }

        // ─────────────────────────────────────────────
        // LEAVE CHECK
        // ─────────────────────────────────────────────
        // FIX #14: only block full-day leaves; half-day leaves allow punch-in (mark isHalfDay automatically)
        const leave = await Leave.findOne({
            user: userId,
            status: "approved",
            fromDate: { $lte: todayEnd },
            toDate: { $gte: todayStart },
        });

        if (leave) {
            const isHalfDayLeave = leave.leaveType === "half-day" || leave.halfDay === true;
            if (!isHalfDayLeave) {
                return res.status(400).json({
                    success: false,
                    message: "You are on approved leave",
                });
            }
            // Half-day leave: allow punch-in but pre-mark isHalfDay
            // This flag will be picked up below when saving the attendance record
            req._halfDayLeave = true;
        }

        // ─────────────────────────────────────────────
        // GEOFENCE CHECK
        // ─────────────────────────────────────────────
        if (!isOfflinePunch) {

            if (lat === undefined || lat === null || lng === undefined || lng === null) {
                return res.status(400).json({
                    success: false,
                    message: "Location coordinates are required. Please enable GPS and try again.",
                });
            }

            if (isNaN(Number(lat)) || isNaN(Number(lng))) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid location coordinates received.",
                });
            }

            const dist = getDistance(
                lat,
                lng,
                OFFICE_LAT,
                OFFICE_LNG
            );

            if (dist > GEOFENCE_RADIUS) {
                return res.status(403).json({
                    success: false,
                    message: `You are ${Math.round(dist)}m away from office`,
                });
            }

            if (
                accuracy !== undefined &&
                Number(accuracy) > 150
            ) {
                return res.status(403).json({
                    success: false,
                    message: "Low GPS accuracy detected",
                });
            }
        }

        // ─────────────────────────────────────────────
        // DUPLICATE CHECK
        // ─────────────────────────────────────────────
        const existing = await Attendance.findOne({
            user: userId,
            dateString: todayString,
        });

        if (existing) {
            return res.status(400).json({
                success: false,
                message: existing.punchOut
                    ? "Attendance already completed for today"
                    : "Already punched in — please punch out first",
            });
        }

        // ─────────────────────────────────────────────
        // DEVICE VALIDATION
        // ─────────────────────────────────────────────
        if (deviceId) {

            const lastAttendance = await Attendance
                .findOne({ user: userId })
                .sort({ createdAt: -1 });

            if (
                lastAttendance &&
                lastAttendance.deviceId &&
                lastAttendance.deviceId !== deviceId
            ) {
                const io = req.app.get("io");

                await createNotification(
                    io,
                    userId,
                    "⚠️ Device Changed",
                    `${req.user.name} used a new device for attendance`,
                    "security",
                    {
                        userId,
                        oldDevice: lastAttendance.deviceId,
                        newDevice: deviceId,
                    }
                );
            }
        }

        // ─────────────────────────────────────────────
        // LATE / HALF DAY LOGIC
        // ─────────────────────────────────────────────

        // ── Load user's shift config ──────────────────────────────────
        const userDoc = await User.findById(userId)
            .select("shift reportingTo")
            .lean();
        const sc = getShiftConfig(userDoc?.shift);

        const monthStart = now.clone().startOf("month").toDate();
        const monthEnd = now.clone().endOf("month").toDate();

        const lateCount = await Attendance.countDocuments({
            user: userId,
            date: { $gte: monthStart, $lte: monthEnd },
            isLate: true,
        });

        // FIX #1: removed duplicate `const now = rawNow` re-declaration
        // `now` is already the correct IST moment from the top of punchIn
        const totalMinutes = now.hour() * 60 + now.minute();

        let isLate = false;
        let isHalfDay = false;
        let status = "present";

        if (sc.isDefaultShift) {
            // ── DEFAULT 10:00–19:00 shift: full 3-quota logic ──────────
            if (lateCount < MONTHLY_LATE_QUOTA) {
                // Phase 1
                if (totalMinutes <= sc.lateTrigger) {
                    // on time
                } else if (totalMinutes <= sc.halfDayCutoff) {
                    isLate = true;
                    status = "present";
                } else {
                    isHalfDay = true;
                    status = "half-day";
                }
            } else {
                // Phase 2 — quota exhausted
                if (totalMinutes <= sc.onTimeCutoffP2) {
                    // on time (within 5-min grace)
                } else {
                    isHalfDay = true;
                    status = "half-day";
                }
            }
        } else {
            // ── CUSTOM shift: simple late / half-day, NO quota ──────────
            if (totalMinutes <= sc.lateTrigger) {
                // on time
            } else if (totalMinutes <= sc.halfDayCutoff) {
                isLate = true;
                status = "present";
            } else {
                isHalfDay = true;
                status = "half-day";
            }
        }

        // ─────────────────────────────────────────────
        // LATE MINUTES
        // ─────────────────────────────────────────────
        // FIX #3: derive shift start from sc.shiftStart (minutes from midnight) not hardcoded 10:00
        const shiftStartHour = Math.floor(sc.shiftStart / 60);
        const shiftStartMinute = sc.shiftStart % 60;

        const shiftStart = now.clone()
            .hour(shiftStartHour)
            .minute(shiftStartMinute)
            .second(0);

        const lateMinutes =
            isLate
                ? Math.max(0, now.diff(shiftStart, "minutes"))
                : 0;

        // ─────────────────────────────────────────────
        // SAVE ATTENDANCE
        // ─────────────────────────────────────────────
        let attendance;

        try {
            if (req._halfDayLeave) {
                isHalfDay = true;
                status = "half-day";
            }

            attendance = await Attendance.create({
                user: userId,
                date: todayStart,
                dateString: todayString,
                punchIn: nowDate,
                lateMinutes,
                isLate,
                isHalfDay,
                status,
                location: {
                    lat,
                    lng,
                    accuracy,
                },
                deviceId: deviceId || "",
                wifiSSID: wifiSSID || "",
                isOfflinePunch: !!isOfflinePunch,
                syncedAt: isOfflinePunch
                    ? serverNow.toDate()
                    : null,
            });

        } catch (err) {

            // Handle duplicate race condition
            if (err.code === 11000) {
                return res.status(400).json({
                    success: false,
                    message: "Attendance already exists for today",
                });
            }

            throw err;
        }

        // ─────────────────────────────────────────────
        // EMAIL ALERT
        // ─────────────────────────────────────────────
        if (isHalfDay || isLate) {
            User.findById(userId).select("email name").then(employee => {
                if (!employee) return;
                sendMail({
                    to: employee.email,
                    subject: isHalfDay
                        ? "⚠️ Half Day Marked"
                        : "⏰ Late Arrival Recorded",
                    html: `
                <p>
                    Hi ${employee.name},
                    your punch-in at
                    <b>${formatTime(nowDate)}</b>
                    has been recorded as
                    <b>${isHalfDay ? "Half Day" : "Late"}</b>.
                </p>
            `,
                }).catch(err => console.error("Email error (punchIn):", err));
            }).catch(err => console.error("User fetch error (punchIn):", err));
        }

        // ─────────────────────────────────────────────
        // HR / MANAGER NOTIFICATIONS
        // ─────────────────────────────────────────────
        const io = req.app.get("io");

        const employeeName =
            req.user.name || "An employee";

        const punchTime = formatTime(nowDate);

        let statusLabel = "✅ On Time";

        if (isHalfDay) {
            statusLabel = "⚠️ Half Day";
        } else if (isLate) {
            statusLabel = `⏰ Late (+${lateMinutes}m)`;
        }

        // ─────────────────────────────────────────────
        // HR / TL / MANAGER NOTIFICATIONS ONLY
        // ─────────────────────────────────────────────
        const notifyUsers = await User.find({
            $or: [
                { role: { $in: ["hr", "manager", "admin"] } },
                { _id: userDoc?.reportingTo }
            ]
        }).select("_id");

        for (const notifyUser of notifyUsers) {
            // Don't send to self
            if (notifyUser._id.toString() === userId.toString()) {
                continue;
            }

            await createNotification(
                io,
                notifyUser._id,
                `${employeeName} Punched In`,
                `Punched in at ${punchTime} — ${statusLabel}`,
                "attendance",
                {
                    userId,
                    attendanceId: attendance._id,
                    status,
                    isLate,
                    isHalfDay,
                }
            );
        }

        // ─────────────────────────────────────────────
        // SUCCESS RESPONSE
        // ─────────────────────────────────────────────
        res.status(201).json({
            success: true,
            message: "Punch-in successful",

            attendance,

            lateQuotaUsed:
                isLate
                    ? lateCount + 1
                    : lateCount,

            lateQuotaMax:
                MONTHLY_LATE_QUOTA,
        });

    } catch (error) {

        console.error("PunchIn Error:", error);

        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


const punchOut = async (req, res) => {
    try {

        const userId = req.user._id;

        const {
            isOfflinePunch,
            offlineTimestamp,
        } = req.body || {};

        // ─────────────────────────────────────────────
        // INDIA TIMEZONE
        // ─────────────────────────────────────────────
        const serverNow = moment().tz("Asia/Kolkata");

        let now = serverNow.clone();

        // ─────────────────────────────────────────────
        // OFFLINE VALIDATION
        // ─────────────────────────────────────────────
        if (isOfflinePunch) {

            if (!offlineTimestamp) {
                return res.status(400).json({
                    success: false,
                    message: "Offline timestamp required",
                });
            }

            const parsedOfflineTime = moment
                .tz(offlineTimestamp, "Asia/Kolkata");

            if (!parsedOfflineTime.isValid()) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid offline timestamp",
                });
            }

            // Max 2 hours old
            const diffMinutes =
                serverNow.diff(parsedOfflineTime, "minutes");

            if (diffMinutes > 120) {
                return res.status(400).json({
                    success: false,
                    message: "Offline punch expired",
                });
            }

            // Prevent future timestamps
            if (diffMinutes < 0) {
                return res.status(400).json({
                    success: false,
                    message: "Future timestamp not allowed",
                });
            }

            now = parsedOfflineTime.clone();
        }

        const nowDate = now.toDate();

        const todayString = now.clone().format("YYYY-MM-DD");
        const todayStart = now.clone().startOf("day").toDate();
        const todayEnd = now.clone().endOf("day").toDate();

        // ─────────────────────────────────────────────
        // OFFICE TIMING CHECK
        // ─────────────────────────────────────────────
        const hour = now.hour();

        if (hour < 9 || hour >= 21) {
            return res.status(400).json({
                success: false,
                message: "Punch-out allowed only between 9 AM to 9 PM",
            });
        }

        // ─────────────────────────────────────────────
        // WEEKEND CHECK
        // ─────────────────────────────────────────────
        if (now.day() === 0 || now.day() === 6) {
            return res.status(400).json({
                success: false,
                message: "Office is closed on weekends",
            });
        }

        // ─────────────────────────────────────────────
        // HOLIDAY CHECK
        // ─────────────────────────────────────────────
        const holiday = await Holiday.findOne({
            date: {
                $gte: todayStart,
                $lte: todayEnd,
            },
        });

        if (holiday) {
            return res.status(400).json({
                success: false,
                message: `Today is a holiday: ${holiday.name}`,
            });
        }

        // ─────────────────────────────────────────────
        // FIND ATTENDANCE
        // ─────────────────────────────────────────────
        let attendance = await Attendance.findOne({
            user: userId,
            dateString: todayString,
        });

        if (!attendance) {
            const yesterdayString = now.clone().subtract(1, "day").format("YYYY-MM-DD");
            attendance = await Attendance.findOne({
                user: userId,
                dateString: yesterdayString,
                punchOut: null,
            });
        }

        if (!attendance) {
            return res.status(404).json({
                success: false,
                message: "No punch-in found for today",
            });
        }

        if (attendance.punchOut) {
            return res.status(400).json({
                success: false,
                message: "Already punched out",
            });
        }

        // ─────────────────────────────────────────────
        // INVALID TIME CHECK
        // ─────────────────────────────────────────────
        if (moment(nowDate).isBefore(attendance.punchIn)) {
            return res.status(400).json({
                success: false,
                message: "Punch-out cannot be before punch-in",
            });
        }

        // ─────────────────────────────────────────────
        // WORK HOURS
        // ─────────────────────────────────────────────
        const workHours = parseFloat(
            (
                (nowDate - attendance.punchIn)
                / (1000 * 60 * 60)
            ).toFixed(2)
        );

        // FIX #9: declare at function scope so email and all downstream blocks access it safely
        const roundedWorkHours = parseFloat(workHours.toFixed(2));

        // ─────────────────────────────────────────────
        // LOAD SHIFT CONFIG  (needed for overtime + half-day)
        // ─────────────────────────────────────────────
        const userDocOut = await User.findById(userId).select("shift").lean();
        const scOut = getShiftConfig(userDocOut?.shift);

        // ─────────────────────────────────────────────
        // OVERTIME
        // ─────────────────────────────────────────────
        // FIX #7: derive shift end from scOut config instead of hardcoded 19:00
        const shiftEndHour = Math.floor(scOut.shiftEnd / 60);
        const shiftEndMinute = scOut.shiftEnd % 60;

        const shiftEnd = now
            .clone()
            .hour(shiftEndHour)
            .minute(shiftEndMinute)
            .second(0);

        const overtimeMinutes = Math.max(0, now.diff(shiftEnd, "minutes"));
        const overtime = parseFloat((overtimeMinutes / 60).toFixed(2));

        // ─────────────────────────────────────────────
        // HALF DAY LOGIC
        // ─────────────────────────────────────────────
        const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
        const rawNowDate = now.toDate();
        const nowIST = new Date(rawNowDate.getTime() + IST_OFFSET_MS);
        const punchOutMinutes = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();

        const alreadyHalfDay = attendance.isHalfDay;

        const earlyExit = punchOutMinutes < scOut.shiftEnd;
        const shortHours = roundedWorkHours < MIN_WORK_HOURS;

        // FIX #6: use integer minutes to avoid floating point boundary errors
        const totalWorkedMinutes = Math.round(workHours * 60);
        const withinGrace = totalWorkedMinutes >= (MIN_WORK_HOURS * 60 - GRACE_MINUTES_BEFORE_SHIFT_END);

        // Rule 2: Monthly 8-hour pass — once per month if >= 8 hrs
        const monthStartForPass = now.clone().startOf("month").toDate();
        const monthEndForPass = now.clone().endOf("month").toDate();

        const eightHourPassUsedCount = await Attendance.countDocuments({
            user: userId,
            date: { $gte: monthStartForPass, $lte: monthEndForPass },
            eightHourPassUsed: true,
        });

        const qualifiesFor8HrPass =
            eightHourPassUsedCount < MONTHLY_8HR_PASS_LIMIT &&
            roundedWorkHours >= LENIENCY_WORK_HOURS;

        let halfDayReason = "";
        let usedGrace = false;
        let used8HrPass = false;

        if (!alreadyHalfDay && shortHours) {
            if (withinGrace) {
                // Within 10-min grace — full day, no pass consumed
                usedGrace = true;
            } else if (qualifiesFor8HrPass) {
                // Monthly 8-hour pass applied
                used8HrPass = true;
            } else {
                // No leniency — mark half day
                attendance.isHalfDay = true;
                attendance.status = "half-day";

                if (earlyExit && shortHours) {
                    halfDayReason = `Early exit at ${formatTime(nowDate)} and worked only ${roundedWorkHours} hrs (min ${MIN_WORK_HOURS} hrs required)`;
                } else {
                    halfDayReason = `Worked only ${roundedWorkHours} hrs (minimum ${MIN_WORK_HOURS} hrs required)`;
                }

                User.findById(userId).select("email name").then(employee => {
                    if (!employee) return;
                    sendMail({
                        to: employee.email,
                        subject: "⚠️ Half Day Marked",
                        html: `
                    <p>Hi ${employee.name},</p>
                    <p>Your attendance has been marked as <b>Half Day</b>.</p>
                    <p>Reason: <b>${halfDayReason}</b></p>
                    <p>Punch Out: <b>${formatTime(nowDate)}</b> · Hours Worked: <b>${roundedWorkHours} hrs</b></p>
                `,
                    }).catch(err => console.error("Email error (punchOut):", err));
                }).catch(err => console.error("User fetch error (punchOut):", err));
            }
        }

        // Save pass flag on attendance record
        if (used8HrPass) {
            attendance.eightHourPassUsed = true;
        }
        // ─────────────────────────────────────────────
        // SAVE
        // ─────────────────────────────────────────────
        attendance.punchOut = nowDate;

        attendance.workHours = workHours;

        attendance.overtime = overtime;

        attendance.isOfflinePunch =
            !!isOfflinePunch;

        if (isOfflinePunch) {
            attendance.syncedAt = serverNow.toDate();
        }

        await attendance.save();

        // ─────────────────────────────────────────────
        // 8-HOUR PASS NOTIFICATION
        // ─────────────────────────────────────────────
        if (used8HrPass) {
            User.findById(userId).select("email name").then(employee => {
                if (!employee) return;
                sendMail({
                    to: employee.email,
                    subject: "✅ Full Day Marked (Monthly 8-Hour Pass Used)",
                    html: `
                <p>Hi ${employee.name},</p>
                <p>You worked <b>${roundedWorkHours} hrs</b> today (punched out at <b>${formatTime(nowDate)}</b>).</p>
                <p>Your attendance has been marked as <b>Full Day</b> using your monthly 8-hour pass.</p>
                <p>⚠️ This pass has been used for this month and will reset next month.</p>
            `,
                }).catch(err => console.error("Email error (8hr pass):", err));
            }).catch(err => console.error("User fetch error (8hr pass):", err));
        }

        // ─────────────────────────────────────────────
        // NOTIFICATIONS
        // ─────────────────────────────────────────────
        const io = req.app.get("io");

        const employeeName =
            req.user.name || "An employee";

        const punchTime =
            formatTime(nowDate);

        const hrs = Math.floor(workHours);

        const mins = Math.round(
            (workHours - hrs) * 60
        );

        const workLabel =
            `${hrs}h ${mins}m worked`;

        const overtimeLabel =
            overtime > 0
                ? ` · OT: ${Math.floor(overtime)}h ${Math.round((overtime % 1) * 60)}m`
                : "";

        const halfDayLabel =
            attendance.isHalfDay
                ? ` · ⚠️ Half Day`
                : "";

        // ─────────────────────────────────────────────
        // HR / TL / MANAGER NOTIFICATIONS ONLY
        // ─────────────────────────────────────────────
        const employeeDoc = await User.findById(userId)
            .select("reportingTo")
            .lean();

        const notifyUsers = await User.find({
            $or: [
                { role: { $in: ["hr", "manager", "admin"] } },
                { _id: employeeDoc?.reportingTo }
            ]
        }).select("_id");

        for (const notifyUser of notifyUsers) {

            // Don't notify self
            if (notifyUser._id.toString() === userId.toString()) {
                continue;
            }

            await createNotification(
                io,
                notifyUser._id,
                `${employeeName} Punched Out`,
                `Punched out at ${punchTime} — ${workLabel}${overtimeLabel}${halfDayLabel}`,
                "attendance",
                {
                    userId,
                    attendanceId: attendance._id,
                    workHours,
                    overtime,
                    isHalfDay: attendance.isHalfDay,
                }
            );
        }

        // ─────────────────────────────────────────────
        // SUCCESS RESPONSE
        // ─────────────────────────────────────────────
        res.status(200).json({
            success: true,
            message: "Punch-out successful",
            attendance,
        });

    } catch (error) {

        console.error("PunchOut Error:", error);

        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


// ─────────────────────────────────────────────
//  GET TODAY'S ATTENDANCE
// ─────────────────────────────────────────────
const getTodayAttendance = async (req, res) => {
    try {
        const userId = req.user._id;

        //  IST — matches how punchIn saves the date
        const nowIST = moment().tz("Asia/Kolkata");
        const todayString = nowIST.clone().format("YYYY-MM-DD");
        const todayEnd = nowIST.clone().endOf("day").toDate();

        const attendance = await Attendance.findOne({
            user: userId,
            dateString: todayString,
        });

        const monthStart = nowIST.clone().startOf("month").toDate();
        const monthEnd = nowIST.clone().endOf("month").toDate();

        const lateQuotaUsed = await Attendance.countDocuments({
            user: userId,
            date: { $gte: monthStart, $lte: monthEnd },
            isLate: true,
        });

        res.status(200).json({
            success: true,
            attendance,
            lateQuotaUsed,
            lateQuotaMax: MONTHLY_LATE_QUOTA,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


// ─────────────────────────────────────────────
//  GET MONTHLY ATTENDANCE
// ─────────────────────────────────────────────

const getMonthlyAttendance = async (req, res) => {
    try {
        const { month, year } = req.query;

        if (!month || !year) {
            return res.status(400).json({
                success: false,
                message: "month and year are required",
            });
        }

        // ✅ Get user joining date
        const user = await User.findById(req.user._id).select("joiningDate createdAt");

        const rawJoining = user?.joiningDate ? new Date(user.joiningDate) : null;
        const rawCreated = user?.createdAt ? new Date(user.createdAt) : null;
        const effectiveStart = rawJoining && rawCreated
            ? new Date(Math.max(rawJoining.getTime(), rawCreated.getTime()))
            : rawJoining || rawCreated || null;
        const joiningDate = effectiveStart
            ? new Date(new Date(effectiveStart).setHours(0, 0, 0, 0))
            : null;

        const start = moment.tz(`${year}-${String(month).padStart(2, '0')}-01`, "Asia/Kolkata").startOf("month").toDate();
        const end = moment.tz(`${year}-${String(month).padStart(2, '0')}-01`, "Asia/Kolkata").endOf("month").toDate();

        // ✅ Get actual attendance records
        const records = await Attendance.find({
            user: req.user._id,
            date: { $gte: start, $lte: end },
        }).sort({ date: 1 });

        // ✅ Get holidays
        const holidays = await Holiday.find({
            date: { $gte: start, $lte: end },
        });

        // Maps
        const recordMap = {};
        records.forEach(r => {
            const d = new Date(r.date);
            recordMap[d.getDate()] = r;
        });

        const holidayMap = {};
        holidays.forEach(h => {
            const d = new Date(h.date);
            holidayMap[d.getDate()] = h;
        });

        const isWeekend = (date) => {
            const day = date.getDay();
            return day === 0 || day === 6;
        };

        const daysInMonth = new Date(year, month, 0).getDate();
        const fullData = [];

        for (let i = 1; i <= daysInMonth; i++) {
            const currentDate = new Date(year, month - 1, i);

            // 🚫 IMPORTANT: Skip before joining date
            if (joiningDate && currentDate < joiningDate) {
                continue;
            }

            // ✅ Priority logic
            if (recordMap[i]) {
                fullData.push(recordMap[i]);
            }
            else if (holidayMap[i]) {
                fullData.push({
                    _id: `holiday-${i}`,
                    date: currentDate,
                    status: "holiday",
                });
            }
            else if (isWeekend(currentDate)) {
                fullData.push({
                    _id: `weekend-${i}`,
                    date: currentDate,
                    status: "weekend",
                });
            }
            else {
                const isFuture = currentDate > new Date();
                if (isFuture) continue;
                fullData.push({
                    _id: `absent-${i}`,
                    date: currentDate,
                    status: "absent",
                    punchIn: null,
                    punchOut: null,
                    workHours: 0,
                    isLate: false,
                    isHalfDay: false,
                });
            }
        }

        const lateQuotaUsed = records.filter(a => a.isLate).length;

        const totalWorkHours = parseFloat(
            records.reduce((sum, r) => sum + (r.workHours || 0), 0).toFixed(2)
        );
        const totalLateMinutes = Math.round(
            records
                .filter(r => r.isLate)
                .reduce((sum, r) => sum + (r.lateMinutes || 0), 0)
        );
        const workedDays = records.filter(r => r.workHours > 0).length;
        const avgDailyHours = workedDays
            ? parseFloat((totalWorkHours / workedDays).toFixed(2))
            : 0;

        res.json({
            success: true,
            lateQuotaUsed,
            lateQuotaMax: MONTHLY_LATE_QUOTA,
            count: fullData.length,
            data: fullData,
            summary: {
                totalWorkHours,
                totalLateMinutes,
                avgDailyHours,
                workedDays,
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
//  GET WEEKLY ATTENDANCE SUMMARY (HR dashboard)
// ─────────────────────────────────────────────
const getWeeklyAttendanceSummary = async (req, res) => {
    try {
        const now = new Date();
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;

        const mon = new Date(now);
        mon.setDate(now.getDate() + diff);
        mon.setHours(0, 0, 0, 0);

        const totalEmployees = await User.countDocuments({
            role: { $in: ["employee", "tl", "manager"] },
            status: "active",
        });

        const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
        const result = [];

        for (let i = 0; i < 5; i++) {
            const start = new Date(mon);
            start.setDate(mon.getDate() + i);
            const end = new Date(start);
            end.setHours(23, 59, 59, 999);

            const present = await Attendance.countDocuments({
                date: { $gte: start, $lte: end },
                status: { $in: ["present", "half-day"] },
            });

            result.push({
                day: days[i],
                date: start.toISOString().split("T")[0],
                present,
                absent: Math.max(0, totalEmployees - present),
            });
        }

        res.json({ success: true, data: result });

    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};




const getTeamAttendance = async (req, res) => {
    try {
        const tlId = req.user._id;
        const { month, year, view = "daily" } = req.query;

        if (!month || !year) {
            return res.status(400).json({ success: false, message: "month and year are required" });
        }

        // Get all employees under this TL
        const teamMembers = await User.find({ reportingTo: tlId })
            .select("name employeeId department designation avatar status joiningDate");

        if (!teamMembers.length) {
            return res.json({ success: true, data: [], teamMembers: [], message: "No team members assigned" });
        }

        const teamIds = teamMembers.map(m => m._id);

        const start = moment.tz(`${year}-${String(month).padStart(2, '0')}-01`, "Asia/Kolkata").startOf("month").toDate();
        const end = moment.tz(`${year}-${String(month).padStart(2, '0')}-01`, "Asia/Kolkata").endOf("month").toDate();

        // Get all attendance records for team this month
        const records = await Attendance.find({
            user: { $in: teamIds },
            date: { $gte: start, $lte: end },
        }).populate("user", "name employeeId department designation").sort({ date: 1 });

        // Get holidays this month
        const holidays = await Holiday.find({ date: { $gte: start, $lte: end } });
        const holidayDates = new Set(holidays.map(h => new Date(h.date).getDate()));

        // Get leaves for team this month
        const leaves = await Leave.find({
            user: { $in: teamIds },
            status: "approved",
            fromDate: { $lte: end },
            toDate: { $gte: start },
        }).populate("user", "name employeeId");

        // ── TODAY summary ──────────────────────────────
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayEnd = new Date(today);
        todayEnd.setHours(23, 59, 59, 999);

        const todayRecords = await Attendance.find({
            user: { $in: teamIds },
            date: { $gte: today, $lte: todayEnd },
        }).populate("user", "name employeeId department");

        // Who is on leave today
        const onLeaveToday = leaves.filter(l => {
            const from = new Date(l.fromDate);
            const to = new Date(l.toDate);
            from.setHours(0, 0, 0, 0);
            to.setHours(23, 59, 59, 999);
            return today >= from && today <= to;
        });

        const onLeaveTodayIds = new Set(onLeaveToday.map(l => l.user._id.toString()));

        // Build today summary per member
        const todayRecordMap = {};
        todayRecords.forEach(r => { todayRecordMap[r.user._id.toString()] = r; });

        const todaySummary = teamMembers.map(member => {
            const rec = todayRecordMap[member._id.toString()];
            const onLeave = onLeaveTodayIds.has(member._id.toString());
            const isHolidayToday = isWeekend(today) || holidayDates.has(today.getDate());

            let attendanceStatus = "absent";
            if (isHolidayToday) attendanceStatus = "holiday";
            else if (onLeave) attendanceStatus = "on_leave";
            else if (rec?.punchIn && rec?.punchOut) attendanceStatus = rec.isHalfDay ? "half_day" : "present";
            else if (rec?.punchIn && !rec?.punchOut) attendanceStatus = "punched_in";
            else if (rec?.status === "absent") attendanceStatus = "absent";

            return {
                _id: member._id,
                name: member.name,
                employeeId: member.employeeId,
                department: member.department,
                designation: member.designation,
                status: member.status,
                attendanceStatus,
                punchIn: rec?.punchIn || null,
                punchOut: rec?.punchOut || null,
                workHours: rec?.workHours || null,
                isLate: rec?.isLate || false,
                isHalfDay: rec?.isHalfDay || false,
                lateMinutes: rec?.lateMinutes || 0,
                missedPunchOut: rec?.punchIn && !rec?.punchOut && new Date().getHours() >= 19,
                onLeave,
            };
        });

        // ── Monthly grid per member ─────────────────────
        const daysInMonth = new Date(year, month, 0).getDate();

        // Group records by userId
        const recordsByUser = {};
        records.forEach(r => {
            const uid = r.user._id.toString();
            if (!recordsByUser[uid]) recordsByUser[uid] = {};
            recordsByUser[uid][new Date(r.date).getDate()] = r;
        });

        const monthlyGrid = teamMembers.map(member => {
            const uid = member._id.toString();
            const memberRecords = recordsByUser[uid] || {};
            const memberLeaves = leaves.filter(l => l.user._id.toString() === uid);

            let presentDays = 0, absentDays = 0, halfDays = 0, lateDays = 0, leaveDays = 0;

            const days = [];
            for (let d = 1; d <= daysInMonth; d++) {
                const currentDate = new Date(year, month - 1, d);
                const joiningDate = member.joiningDate ? new Date(new Date(member.joiningDate).setHours(0, 0, 0, 0)) : null;

                if (joiningDate && currentDate < joiningDate) {
                    days.push({ day: d, status: "not_joined" });
                    continue;
                }

                const rec = memberRecords[d];
                const isHoliday = holidayDates.has(d);
                // FIX #15: construct date in IST before checking weekend to avoid UTC server timezone shift
                const currentDateIST = moment.tz(
                    `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
                    "Asia/Kolkata"
                );
                const weekend = currentDateIST.day() === 0 || currentDateIST.day() === 6;
                const isFuture = currentDate > new Date();

                const onLeave = memberLeaves.some(l => {
                    const from = new Date(l.fromDate); from.setHours(0, 0, 0, 0);
                    const to = new Date(l.toDate); to.setHours(23, 59, 59, 999);
                    return currentDate >= from && currentDate <= to;
                });

                let dayStatus = "absent";
                if (isFuture) dayStatus = "future";
                else if (isHoliday) dayStatus = "holiday";
                else if (weekend) dayStatus = "weekend";
                else if (onLeave) { dayStatus = "leave"; leaveDays++; }
                else if (rec) {
                    if (rec.isHalfDay) { dayStatus = "half_day"; halfDays++; }
                    else if (rec.isLate) { dayStatus = "late"; lateDays++; presentDays++; }
                    else if (rec.status === "present") { dayStatus = "present"; presentDays++; }
                    else { dayStatus = "absent"; absentDays++; }
                } else {
                    dayStatus = "absent";
                    absentDays++;
                }

                days.push({ day: d, status: dayStatus, punchIn: rec?.punchIn, punchOut: rec?.punchOut });
            }

            return {
                _id: member._id,
                name: member.name,
                employeeId: member.employeeId,
                department: member.department,
                designation: member.designation,
                stats: { presentDays, absentDays, halfDays, lateDays, leaveDays },
                days,
            };
        });

        res.json({
            success: true,
            todaySummary,
            monthlyGrid,
            teamMembers,
            holidays: holidays.map(h => ({ date: h.date, name: h.name })),
            month: Number(month),
            year: Number(year),
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  GET ALL EMPLOYEES ATTENDANCE OVERVIEW — HR
//  GET /attendance/hr-overview?month=5&year=2026
// ─────────────────────────────────────────────
const getHRAttendanceOverview = async (req, res) => {
    try {
        const { month, year } = req.query;

        if (!month || !year) {
            return res.status(400).json({ success: false, message: "month and year are required" });
        }

        const start = moment.tz(`${year}-${String(month).padStart(2, '0')}-01`, "Asia/Kolkata").startOf("month").toDate();
        const end = moment.tz(`${year}-${String(month).padStart(2, '0')}-01`, "Asia/Kolkata").endOf("month").toDate();

        // All active employees + tl + managers
        // FIX #8: added "manager" to role filter — was silently excluded before
        const allEmployees = await User.find({
            role: { $in: ["employee", "tl", "manager"] },
            status: "active",
        }).select("name employeeId department designation role joiningDate reportingTo");

        const allIds = allEmployees.map(e => e._id);

        // All attendance records this month
        const records = await Attendance.find({
            user: { $in: allIds },
            date: { $gte: start, $lte: end },
        }).populate("user", "name employeeId department role").sort({ date: 1 });

        // Holidays
        const holidays = await Holiday.find({ date: { $gte: start, $lte: end } });
        const holidayDates = new Set(holidays.map(h => new Date(h.date).getDate()));

        // Leaves
        const leaves = await Leave.find({
            user: { $in: allIds },
            status: "approved",
            fromDate: { $lte: end },
            toDate: { $gte: start },
        }).populate("user", "name employeeId department");

        // ── TODAY summary ──────────────────────────────
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayEnd = new Date(today);
        todayEnd.setHours(23, 59, 59, 999);

        const todayRecords = await Attendance.find({
            user: { $in: allIds },
            date: { $gte: today, $lte: todayEnd },
        }).populate("user", "name employeeId department designation role");

        // Who is on leave today
        const onLeaveToday = leaves.filter(l => {
            const from = new Date(l.fromDate); from.setHours(0, 0, 0, 0);
            const to = new Date(l.toDate); to.setHours(23, 59, 59, 999);
            return today >= from && today <= to;
        });

        const onLeaveTodayIds = new Set(onLeaveToday.map(l => l.user._id.toString()));
        const todayRecordMap = {};
        todayRecords.forEach(r => { todayRecordMap[r.user._id.toString()] = r; });

        const isHolidayToday = isWeekend(today) || holidayDates.has(today.getDate());

        const todaySummary = allEmployees.map(emp => {
            const rec = todayRecordMap[emp._id.toString()];
            const onLeave = onLeaveTodayIds.has(emp._id.toString());

            let attendanceStatus = "absent";
            if (isHolidayToday) attendanceStatus = "holiday";
            else if (onLeave) attendanceStatus = "on_leave";
            else if (rec?.punchIn && rec?.punchOut) attendanceStatus = rec.isHalfDay ? "half_day" : "present";
            else if (rec?.punchIn && !rec?.punchOut) attendanceStatus = "punched_in";
            else attendanceStatus = "absent";

            return {
                _id: emp._id,
                name: emp.name,
                employeeId: emp.employeeId,
                department: emp.department,
                designation: emp.designation,
                role: emp.role,
                attendanceStatus,
                punchIn: rec?.punchIn || null,
                punchOut: rec?.punchOut || null,
                workHours: rec?.workHours || null,
                isLate: rec?.isLate || false,
                isHalfDay: rec?.isHalfDay || false,
                lateMinutes: rec?.lateMinutes || 0,
                missedPunchOut: rec?.punchIn && !rec?.punchOut && new Date().getHours() >= 19,
                onLeave,
                leaveType: onLeave ? onLeaveToday.find(l => l.user._id.toString() === emp._id.toString())?.type : null,
            };
        });

        // ── Monthly stats per employee ──────────────────
        const recordsByUser = {};
        records.forEach(r => {
            const uid = r.user._id.toString();
            if (!recordsByUser[uid]) recordsByUser[uid] = [];
            recordsByUser[uid].push(r);
        });

        const monthlyStats = allEmployees.map(emp => {
            const uid = emp._id.toString();
            const empRecords = recordsByUser[uid] || [];
            const empLeaves = leaves.filter(l => l.user._id.toString() === uid);

            const presentDays = empRecords.filter(r => r.status === "present" && !r.isHalfDay).length;
            const halfDays = empRecords.filter(r => r.isHalfDay).length;
            const lateDays = empRecords.filter(r => r.isLate).length;
            const absentDays = empRecords.filter(r => r.status === "absent").length;
            const leaveDays = empLeaves.reduce((acc, l) => {
                const from = new Date(l.fromDate);
                const to = new Date(l.toDate);
                const diff = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
                return acc + diff;
            }, 0);

            const totalWorkHours = parseFloat(
                empRecords.reduce((sum, r) => sum + (r.workHours || 0), 0).toFixed(2)
            );
            const totalLateMinutes = Math.round(empRecords.reduce((sum, r) => sum + (r.lateMinutes || 0), 0));
            const workedDays = empRecords.filter(r => r.workHours > 0).length;
            const avgDailyHours = workedDays
                ? parseFloat((totalWorkHours / workedDays).toFixed(2))
                : 0;

            return {
                _id: emp._id,
                name: emp.name,
                employeeId: emp.employeeId,
                department: emp.department,
                designation: emp.designation,
                role: emp.role,
                stats: {
                    presentDays, halfDays, lateDays, absentDays, leaveDays,
                    totalWorkHours, totalLateMinutes, avgDailyHours, workedDays,
                },
            };
        });

        // ── Overall today counts ────────────────────────
        const totalActive = allEmployees.length;
        const punchedIn = todaySummary.filter(e => e.attendanceStatus === "punched_in" || e.attendanceStatus === "present" || e.attendanceStatus === "half_day").length;
        const punchedOut = todaySummary.filter(e => e.punchOut).length;
        const absentToday = todaySummary.filter(e => e.attendanceStatus === "absent").length;
        const onLeaveTodayCount = todaySummary.filter(e => e.attendanceStatus === "on_leave").length;
        const missedPunchOut = todaySummary.filter(e => e.missedPunchOut).length;
        const lateToday = todaySummary.filter(e => e.isLate).length;

        res.json({
            success: true,
            todayOverview: {
                totalActive, punchedIn, punchedOut,
                absentToday, onLeaveTodayCount,
                missedPunchOut, lateToday,
            },
            todaySummary,
            monthlyStats,
            leaves: leaves.map(l => ({
                _id: l._id,
                user: { name: l.user.name, employeeId: l.user.employeeId, department: l.user.department },
                type: l.type,
                fromDate: l.fromDate,
                toDate: l.toDate,
                status: l.status,
            })),
            holidays: holidays.map(h => ({ date: h.date, name: h.name })),
            month: Number(month),
            year: Number(year),
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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
};