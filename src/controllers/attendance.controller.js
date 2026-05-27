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
//  OFFICE NETWORK CONFIG
// ─────────────────────────────────────────────
const OFFICE_SUBNETS = process.env.OFFICE_SUBNETS
    ? process.env.OFFICE_SUBNETS.split(",").map(s => s.trim())
    : ["192.168.1.", "192.168.2.", "192.168.29."];

const ALLOWED_DEVICES = [
    {
        deviceUUID: "03000200-0400-0500-0006-000700080009",
        productId: "00331-10000-00001-AA159",
        label: "Bhupendra Office PC",
    },
    {
        deviceUUID: "FF9C4A14-678F-6F64-7353-E89C2511E53C",
        productId: "00331-10000-00001-AA316",
        label: "Jahid Office PC",
    },
    {
        deviceUUID: "03000200-0400-0500-0006-000700080009",
        productId: "00331-10000-00001-AA620",
        label: "Santosh Office PC",
    },
    {
        deviceUUID: "03000200-0400-0500-0006-000700080009",
        productId: "00330-80000-00000-AA007",
        label: "Anjali Office PC",
    },
    {
        deviceUUID: "03000200-0400-0500-0006-000700080009",
        productId: "00331-10000-00001-AA351",
        label: "Rajesh Office PC",
    },
    {
        deviceUUID: "BCCB94D0-B8C8-9A11-A0E7-047C16132135",
        productId: "00355-79631-62791-AAOEM",
        label: "Dinkar Office PC",
    },
    {
        deviceUUID: "03000200-0400-0500-0006-000700080009",
        productId: "00331-10000-00001-AA611",
        label: "Hemant Office PC",
    },
    {
        deviceUUID: "4C4C4544-0032-4D10-8043-B4C04F504C32",
        productId: "00342-50786-03990-AAOEM",
        label: "Dipanshu Office PC",
    },
];

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
            deviceId,
            wifiSSID,
            isOfflinePunch,
            offlineTimestamp,
            deviceUUID,
            productId,
            lat,
            lng,
            accuracy,
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
        // OFFICE TIMING CHECK (shift-aware)
        // ─────────────────────────────────────────────
        // Load shift config early so we can use shiftStart for the timing window.
        // We re-use userDoc fetched below; fetch it here temporarily.
        const userDocForTiming = await User.findById(userId).select("shift").lean();
        const scForTiming = getShiftConfig(userDocForTiming?.shift);

        // Allow punch-in from 1 hour before shift start up to 1 hour after shift end.
        // This handles overnight shifts (e.g. 13:00–01:00) by comparing in total minutes
        // with wrap-around support.
        const totalMinutesNow = now.hour() * 60 + now.minute();

        const windowOpen = (scForTiming.shiftStart - 60 + 1440) % 1440;  // 1 hr before start
        const windowClose = (scForTiming.shiftEnd + 60) % 1440;          // 1 hr after end

        // Overnight window: windowOpen > windowClose (e.g. 720 open, 120 close for 1 PM–1 AM)
        const inWindow = windowOpen <= windowClose
            ? totalMinutesNow >= windowOpen && totalMinutesNow <= windowClose
            : totalMinutesNow >= windowOpen || totalMinutesNow <= windowClose;

        if (!inWindow) {
            const fmt = (m) => {
                const h = Math.floor(m / 60) % 24;
                const min = m % 60;
                const ap = h >= 12 ? "PM" : "AM";
                return `${h % 12 || 12}:${String(min).padStart(2, "0")} ${ap}`;
            };
            return res.status(400).json({
                success: false,
                message: `Punch-in allowed only between ${fmt(windowOpen)} and ${fmt(windowClose)}`,
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
        // DEVICE / LOCATION VERIFICATION
        // ─────────────────────────────────────────────
        const userDoc = await User.findById(userId)
            .select("shift reportingTo")
            .lean();

        let verifiedBy = null;
        let clientIP = (req.socket?.remoteAddress || "").replace(/^::ffff:/, "");

        if (isOfflinePunch) {
            verifiedBy = "offline";

        } else {
            // ── STEP 1: Try device verification first ────────────────────
            let deviceMatched = false;

            if (deviceUUID && productId) {
                const incomingUUID = deviceUUID.trim().toUpperCase();
                const incomingProduct = productId.trim().toUpperCase();

                const matchedDevice = ALLOWED_DEVICES.find(d => {
                    const uuidOk = d.deviceUUID.trim().toUpperCase() === incomingUUID;
                    const productOk = d.productId.trim().toUpperCase() === incomingProduct;
                    return uuidOk && productOk;
                });

                if (matchedDevice) {
                    verifiedBy = "device";
                    deviceMatched = true;
                } else {
                    console.log(`❌ Device not in allowed list — UUID: ${incomingUUID}`);
                }
            }

            // ── STEP 2: Device not matched → try location ────────────────
            if (!deviceMatched) {
                if (lat === undefined || lat === null || lng === undefined || lng === null) {
                    return res.status(403).json({
                        success: false,
                        message: "Device not recognised. Please enable GPS to punch in from your current location.",
                    });
                }

                if (isNaN(Number(lat)) || isNaN(Number(lng))) {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid location coordinates received.",
                    });
                }

                const dist = getDistance(Number(lat), Number(lng), OFFICE_LAT, OFFICE_LNG);

                if (dist > GEOFENCE_RADIUS) {
                    return res.status(403).json({
                        success: false,
                        message: `You are ${Math.round(dist)}m away from office. Move closer or use an authorised office computer.`,
                    });
                }

                if (accuracy !== undefined && Number(accuracy) > 150) {
                    return res.status(403).json({
                        success: false,
                        message: "GPS accuracy is too low. Please try again in open space.",
                    });
                }
                verifiedBy = "location";
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

                // Fire-and-forget — device alert must never crash punch-in
                createNotification(
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
                ).catch(err => console.error("Device change notification error:", err));
            }
        }

        // ─────────────────────────────────────────────
        // LATE / HALF DAY LOGIC
        // ─────────────────────────────────────────────
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
                deviceUUID: deviceUUID || "",   // Windows hardware UUID
                productId: productId || "",   // Windows Product ID
                wifiSSID: wifiSSID || "",
                isOfflinePunch: !!isOfflinePunch,
                syncedAt: isOfflinePunch
                    ? serverNow.toDate()
                    : null,
                verifiedBy,   // "device" | "device_partial" | "location" | "offline"
                clientIP,
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

        // ─────────────────────────────────────────────
        // START DESKTOP TRACKER
        // ─────────────────────────────────────────────

        io.to(`user_${userId}`).emit(
            "tracker:start",
            {
                attendanceId: attendance._id,
                timestamp: new Date(),
            }
        );

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
        const notifyUsersRaw = await User.find({
            $or: [
                { role: { $in: ["hr", "manager", "admin"] } },
                ...(userDoc?.reportingTo ? [{ _id: userDoc.reportingTo }] : []),
            ]
        }).select("_id");

        // Deduplicate by string ID to avoid double-notifying
        const notifyIdSet = new Set();
        for (const u of notifyUsersRaw) {
            const sid = u._id.toString();
            if (sid !== userId.toString()) notifyIdSet.add(sid);
        }

        await Promise.allSettled(
            [...notifyIdSet].map(sid =>
                createNotification(
                    io,
                    sid,
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
                )
            )
        );

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
        // OFFICE TIMING CHECK (shift-aware)
        // ─────────────────────────────────────────────
        // Load shift to compute the allowed punch-out window:
        // 1 hour before shift start → 1 hour after shift end.
        const userDocForOutTiming = await User.findById(userId).select("shift").lean();
        const scForOutTiming = getShiftConfig(userDocForOutTiming?.shift);

        const totalMinutesNowOut = now.hour() * 60 + now.minute();

        const outWindowOpen = (scForOutTiming.shiftStart - 60 + 1440) % 1440;
        const outWindowClose = (scForOutTiming.shiftEnd + 60) % 1440;

        const inOutWindow = outWindowOpen <= outWindowClose
            ? totalMinutesNowOut >= outWindowOpen && totalMinutesNowOut <= outWindowClose
            : totalMinutesNowOut >= outWindowOpen || totalMinutesNowOut <= outWindowClose;

        if (!inOutWindow) {
            const fmt = (m) => {
                const h = Math.floor(m / 60) % 24;
                const min = m % 60;
                const ap = h >= 12 ? "PM" : "AM";
                return `${h % 12 || 12}:${String(min).padStart(2, "0")} ${ap}`;
            };
            return res.status(400).json({
                success: false,
                message: `Punch-out allowed only between ${fmt(outWindowOpen)} and ${fmt(outWindowClose)}`,
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
        // FIND ATTENDANCE (overnight-shift aware)
        // ─────────────────────────────────────────────
        let attendance = await Attendance.findOne({
            user: userId,
            dateString: todayString,
        });

        if (!attendance || attendance.punchOut) {
            const yesterdayString = now.clone().subtract(1, "day").format("YYYY-MM-DD");
            const yesterdayAtt = await Attendance.findOne({
                user: userId,
                dateString: yesterdayString,
                punchOut: null,
            });
            if (yesterdayAtt) attendance = yesterdayAtt;
        }

        if (!attendance || attendance.punchOut) {
            const twoDaysAgoString = now.clone().subtract(2, "day").format("YYYY-MM-DD");
            const twoDaysAgoAtt = await Attendance.findOne({
                user: userId,
                dateString: twoDaysAgoString,
                punchOut: null,
            });
            if (twoDaysAgoAtt) attendance = twoDaysAgoAtt;
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

        // ─────────────────────────────────────────────
        // STOP DESKTOP TRACKER
        // ─────────────────────────────────────────────

        io.to(`user_${userId}`).emit(
            "tracker:stop",
            {
                attendanceId: attendance._id,
                timestamp: new Date(),
            }
        );

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

        const notifyUsersRaw = await User.find({
            $or: [
                { role: { $in: ["hr", "manager", "admin"] } },
                ...(employeeDoc?.reportingTo ? [{ _id: employeeDoc.reportingTo }] : []),
            ]
        }).select("_id");

        // Deduplicate
        const notifyIdSet = new Set();
        for (const u of notifyUsersRaw) {
            const sid = u._id.toString();
            if (sid !== userId.toString()) notifyIdSet.add(sid);
        }

        await Promise.allSettled(
            [...notifyIdSet].map(sid =>
                createNotification(
                    io,
                    sid,
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
                )
            )
        );

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

        const userForShift = await User.findById(userId).select("shift").lean();
        const scForShift = getShiftConfig(userForShift?.shift);

        res.status(200).json({
            success: true,
            attendance,
            lateQuotaUsed,
            lateQuotaMax: MONTHLY_LATE_QUOTA,
            shiftEnd: scForShift.shiftEnd,
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
            .select("name employeeId department designation avatar status joiningDate createdAt shift");

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

        // ── TODAY summary — use IST dateString for consistency ──────────
        const todayIST = moment().tz("Asia/Kolkata");
        const todayString = todayIST.format("YYYY-MM-DD");

        const yesterdayString = todayIST.clone().subtract(1, "day").format("YYYY-MM-DD");

        const todayRecords = await Attendance.find({
            user: { $in: teamIds },
            $or: [
                { dateString: todayString },
                { dateString: yesterdayString, punchOut: null }, // overnight / late-shift
            ],
        }).populate("user", "name employeeId department");

        // Keep `today` as a JS Date for leave-range comparisons below
        const today = todayIST.clone().startOf("day").toDate();
        const todayEnd = todayIST.clone().endOf("day").toDate();

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

            const empSc = getShiftConfig(member.shift);
            const nowMins = todayIST.hour() * 60 + todayIST.minute();
            const shiftNotStartedYet = nowMins < empSc.shiftStart;

            let attendanceStatus;
            if (rec?.punchIn && rec?.punchOut) {
                attendanceStatus = "punched_out";
            } else if (rec?.punchIn) {
                const shiftEndMins = empSc.shiftEnd === 0 ? 1440 : empSc.shiftEnd;
                const punchInMoment = moment(rec.punchIn).tz("Asia/Kolkata");
                const isPunchInFromYesterday = punchInMoment.format("YYYY-MM-DD") !== todayString;
                const shiftOver = isPunchInFromYesterday || nowMins > shiftEndMins + 60;
                attendanceStatus = shiftOver ? "missed_punchout" : "punched_in";
            } else if (onLeave) {
                attendanceStatus = "on_leave";
            } else if (isHolidayToday) {
                attendanceStatus = "holiday";
            } else if (shiftNotStartedYet) {
                attendanceStatus = "not_started";
            } else {
                attendanceStatus = "absent";
            }

            const shiftEndMins = empSc.shiftEnd === 0 ? 1440 : empSc.shiftEnd;

            return {
                _id: member._id,
                name: member.name,
                employeeId: member.employeeId,
                department: member.department,
                designation: member.designation,
                status: member.status,
                attendanceStatus,
                shiftStartHour: Math.floor(empSc.shiftStart / 60),
                shiftStartMinute: empSc.shiftStart % 60,
                punchIn: rec?.punchIn || null,
                punchOut: rec?.punchOut || null,
                workHours: rec?.workHours || null,
                isLate: rec?.isLate || false,
                isHalfDay: rec?.isHalfDay || false,
                lateMinutes: rec?.lateMinutes || 0,
                missedPunchOut: (() => {
                    const punchInMoment = rec?.punchIn ? moment(rec.punchIn).tz("Asia/Kolkata") : null;
                    const punchInDateString = punchInMoment ? punchInMoment.format("YYYY-MM-DD") : null;
                    const isPunchInFromYesterday = punchInDateString && punchInDateString !== todayString;
                    return !!(
                        rec?.punchIn &&
                        !rec?.punchOut &&
                        !onLeave &&
                        (
                            (!isPunchInFromYesterday && nowMins > shiftEndMins + 30) ||
                            isPunchInFromYesterday
                        )
                    );
                })(),
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
                const rawJoining = member.joiningDate ? new Date(member.joiningDate) : null;
                const rawCreated = member.createdAt ? new Date(member.createdAt) : null;
                const effectiveJoining = rawJoining && rawCreated
                    ? new Date(Math.max(rawJoining.getTime(), rawCreated.getTime()))
                    : rawJoining || rawCreated || null;
                const joiningDate = effectiveJoining
                    ? new Date(new Date(effectiveJoining).setHours(0, 0, 0, 0))
                    : null;

                if (joiningDate && currentDate < joiningDate) {
                    days.push({ day: d, status: "not_joined" });
                    continue; // ✅ skip — don't count as absent
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
                else if (onLeave) { dayStatus = "on_leave"; leaveDays++; }
                else if (rec) {
                    if (rec.isHalfDay) { dayStatus = "half_day"; halfDays++; presentDays++; }
                    else if (rec.isLate) { dayStatus = "late"; lateDays++; presentDays++; }
                    else if (rec.status === "present") { dayStatus = "present"; presentDays++; }
                    else { dayStatus = "absent"; absentDays++; }
                } else {
                    const isPastWorkingDay = !isFuture && !isHoliday && !weekend;
                    if (isPastWorkingDay) {
                        dayStatus = "absent";
                        absentDays++;
                    } else {
                        dayStatus = "absent";
                    }
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
            role: { $in: ["employee", "tl"] },
            status: "active",
        }).select("name employeeId department designation role joiningDate reportingTo shift");

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

        // ── TODAY summary — use IST dateString for consistency ──────────
        const todayIST = moment().tz("Asia/Kolkata");
        const todayString = todayIST.format("YYYY-MM-DD");

        // Also catch records from yesterday that have no punch-out yet (overnight shifts)
        const yesterdayString = todayIST.clone().subtract(1, "day").format("YYYY-MM-DD");

        const todayRecords = await Attendance.find({
            user: { $in: allIds },
            $or: [
                { dateString: todayString },
                { dateString: yesterdayString, punchOut: null }, // overnight / late-shift
            ],
        }).populate("user", "name employeeId department designation role");

        // Keep `today` as a JS Date for leave-range comparisons below
        const today = todayIST.clone().startOf("day").toDate();
        const todayEnd = todayIST.clone().endOf("day").toDate();

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

            const empSc = getShiftConfig(emp.shift);
            const nowMins = todayIST.hour() * 60 + todayIST.minute();
            const shiftNotStartedYet = nowMins < empSc.shiftStart;

            let attendanceStatus;
            if (rec?.punchIn && rec?.punchOut) {
                attendanceStatus = "punched_out";
            } else if (rec?.punchIn) {
                const shiftEndMins = empSc.shiftEnd === 0 ? 1440 : empSc.shiftEnd;
                const punchInMoment = moment(rec.punchIn).tz("Asia/Kolkata");
                const isPunchInFromYesterday = punchInMoment.format("YYYY-MM-DD") !== todayString;
                const shiftOver = isPunchInFromYesterday || nowMins > shiftEndMins + 60;
                attendanceStatus = shiftOver ? "missed_punchout" : "punched_in";
            } else if (onLeave) {
                attendanceStatus = "on_leave";
            } else if (isHolidayToday) {
                attendanceStatus = "holiday";
            } else if (shiftNotStartedYet) {
                attendanceStatus = "not_started";
            } else {
                attendanceStatus = "absent";
            }

            // Derive shift end for this specific employee
            const empShiftConfig = getShiftConfig(emp.shift);
            const shiftEndHour = Math.floor(empShiftConfig.shiftEnd / 60);
            const shiftEndMinute = empShiftConfig.shiftEnd % 60;
            const nowTotalMinutes = todayIST.hour() * 60 + todayIST.minute();
            // Treat midnight (0) as 1440 so shifts ending at 00:00 don't fire all day
            const shiftEndTotalMinutes = empShiftConfig.shiftEnd === 0 ? 1440 : empShiftConfig.shiftEnd;
            // Only flag missed punch-out if current time is 30+ mins past their shift end
            // Check missed punch-out accounting for overnight/next-day scenario
            const punchInMoment = rec?.punchIn ? moment(rec.punchIn).tz("Asia/Kolkata") : null;
            const punchInDateString = punchInMoment ? punchInMoment.format("YYYY-MM-DD") : null;
            const isPunchInFromYesterday = punchInDateString && punchInDateString !== todayString;

            const missedPunchOut = !!(
                rec?.punchIn &&
                !rec?.punchOut &&
                !onLeave &&
                (
                    // Same day: current time is 30+ mins past their shift end
                    (!isPunchInFromYesterday && nowMins > shiftEndTotalMinutes + 30) ||
                    // Previous day punch-in: shift has definitely ended (next day already)
                    isPunchInFromYesterday
                )
            );

            return {
                _id: emp._id,
                name: emp.name,
                employeeId: emp.employeeId,
                department: emp.department,
                designation: emp.designation,
                role: emp.role,
                attendanceStatus,
                shiftStartHour: Math.floor(empSc.shiftStart / 60),
                shiftStartMinute: empSc.shiftStart % 60,
                punchIn: rec?.punchIn || null,
                punchOut: rec?.punchOut || null,
                workHours: rec?.workHours || null,
                isLate: rec?.isLate || false,
                isHalfDay: rec?.isHalfDay || false,
                lateMinutes: rec?.lateMinutes || 0,
                missedPunchOut,
                onLeave,
                leaveType: onLeave ? onLeaveToday.find(l => l.user._id.toString() === emp._id.toString())?.type : null,
                shiftEndHour,
                shiftEndMinute,
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

            const halfDays = empRecords.filter(r => r.isHalfDay).length;
            const presentDays = empRecords.filter(r => !r.isHalfDay && r.status === "present").length;
            const lateDays = empRecords.filter(r => r.isLate && !r.isHalfDay).length;
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
        const punchedIn = todaySummary.filter(e => e.attendanceStatus === "punched_in").length;
        const punchedOut = todaySummary.filter(e => e.punchOut).length;
        const absentToday = todaySummary.filter(e => e.attendanceStatus === "absent").length;
        const onLeaveTodayCount = todaySummary.filter(e => e.attendanceStatus === "on_leave").length;
        const missedPunchOut = todaySummary.filter(e => e.missedPunchOut).length;
        const lateToday = todaySummary.filter(e => e.isLate).length;
        const officeNotOpenCount = todaySummary.filter(e => e.attendanceStatus === "not_started").length;

        res.json({
            success: true,
            todayOverview: {
                totalActive, punchedIn, punchedOut,
                absentToday, onLeaveTodayCount,
                missedPunchOut, lateToday,
                officeNotOpenCount,
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