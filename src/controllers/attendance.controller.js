const Attendance = require("../models/attendance.model");
const User = require("../models/user.model");
const Holiday = require("../models/holiday.model");
const Leave = require("../models/leave.model");

// ─────────────────────────────────────────────
//  OFFICE CONFIG
// ─────────────────────────────────────────────
const OFFICE_LAT = 28.61597;
const OFFICE_LNG = 77.37919;
const GEOFENCE_RADIUS = 50; // meters

// ─────────────────────────────────────────────
//  SHIFT TIMING (in minutes from midnight)
// ─────────────────────────────────────────────
const OFFICE_START = 10 * 60 + 0;   // 10:00 → shift starts
const LATE_TRIGGER = 10 * 60 + 15;  // 10:15 → after this, quota consumed (Phase 1)
const LATE_CUTOFF = 10 * 60 + 30;  // 10:30 → after this, half-day (quota NOT consumed)
const ONTIME_CUTOFF_P2 = 10 * 60 + 5;   // 10:05 → grace period when quota exhausted (Phase 2)
const MONTHLY_LATE_QUOTA = 3;

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
        const { lat, lng, accuracy, deviceId, wifiSSID, isOfflinePunch, offlineTimestamp } = req.body || {};

        const now = isOfflinePunch && offlineTimestamp ? new Date(offlineTimestamp) : new Date();

        // ✅ Weekend check — weekends are paid off, no punch needed
        if (isWeekend(now)) {
            return res.status(400).json({
                success: false,
                message: "Office is closed on weekends",
            });
        }

        const today = new Date(now);
        today.setHours(0, 0, 0, 0);

        // ✅ Holiday check — holidays are paid off, no punch needed
        const holiday = await Holiday.findOne({
            date: {
                $gte: today,
                $lte: new Date(today.getTime() + 86400000 - 1),
            },
        });

        if (holiday) {
            return res.status(400).json({
                success: false,
                message: `Today is a holiday: ${holiday.name}`,
            });
        }

        // ✅ Time restriction
        const hour = now.getHours();
        if (hour < 9 || hour > 21) {
            return res.status(400).json({
                success: false,
                message: "Punch allowed only between 9 AM to 9 PM",
            });
        }

        // ✅ Leave check
        const leave = await Leave.findOne({
            user: userId,
            status: "approved",
            fromDate: { $lte: today },
            toDate: { $gte: today },
        });

        if (leave) {
            return res.status(400).json({
                success: false,
                message: "You are on approved leave",
            });
        }

        // ✅ Geofence check
        if (!isOfflinePunch) {
            if (lat === undefined || lng === undefined) {
                return res.status(400).json({ success: false, message: "Location required" });
            }

            const dist = getDistance(lat, lng, OFFICE_LAT, OFFICE_LNG);

            if (dist > GEOFENCE_RADIUS) {
                return res.status(403).json({
                    success: false,
                    message: `You are ${Math.round(dist)}m away from office`,
                });
            }

            if (accuracy !== undefined && accuracy < 5) {
                return res.status(403).json({
                    success: false,
                    message: "Suspicious GPS detected",
                });
            }
        }

        // ✅ Duplicate check
        const existing = await Attendance.findOne({ user: userId, date: today });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: "Already punched in",
            });
        }

        // ─────────────────────────────────────────────
        //  LATE / HALF-DAY LOGIC
        //
        //  PHASE 1 (quota used < 3):
        //    ≤ 10:15           → On time,  quota unchanged
        //    10:16 – 10:30     → Late ✅,  1 quota slot consumed
        //    > 10:30           → Half day, quota NOT consumed
        //
        //  PHASE 2 (quota used = 3, exhausted):
        //    ≤ 10:05           → On time
        //    > 10:05           → Half day
        // ─────────────────────────────────────────────

        // Count late quota used this month (only isLate:true records, NOT half-days)
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        const lateCount = await Attendance.countDocuments({
            user: userId,
            date: { $gte: monthStart, $lte: monthEnd },
            isLate: true,
        });

        const totalMinutes = now.getHours() * 60 + now.getMinutes();

        let isLate = false;
        let isHalfDay = false;
        let status = "present";

        if (lateCount < MONTHLY_LATE_QUOTA) {
            // ── PHASE 1: quota still available ──
            if (totalMinutes <= LATE_TRIGGER) {
                // ≤ 10:15 → on time, quota untouched
                isLate = false;
                isHalfDay = false;
                status = "present";
            } else if (totalMinutes <= LATE_CUTOFF) {
                // 10:16 – 10:30 → late, consumes 1 quota slot
                isLate = true;
                isHalfDay = false;
                status = "present";
            } else {
                // > 10:30 → half-day, quota NOT consumed
                isLate = false;
                isHalfDay = true;
                status = "half-day";
            }
        } else {
            // ── PHASE 2: quota exhausted ──
            if (totalMinutes <= ONTIME_CUTOFF_P2) {
                // ≤ 10:05 → on time
                isLate = false;
                isHalfDay = false;
                status = "present";
            } else {
                // > 10:05 → half-day
                isLate = false;
                isHalfDay = true;
                status = "half-day";
            }
        }

        // Late minutes — only meaningful when late or half-day
        const shiftStart = new Date(today);
        shiftStart.setHours(10, 0, 0, 0);
        const lateMinutes = (isLate || isHalfDay)
            ? parseFloat(Math.max(0, (now - shiftStart) / (1000 * 60)).toFixed(2))
            : 0;

        // ✅ Save attendance
        const attendance = await Attendance.create({
            user: userId,
            date: today,
            punchIn: now,
            lateMinutes,
            isLate,
            isHalfDay,
            status,
            location: { lat, lng, accuracy },
            deviceId: deviceId || "",
            wifiSSID: wifiSSID || "",
            isOfflinePunch: !!isOfflinePunch,
            syncedAt: isOfflinePunch ? new Date() : null,
        });

        res.status(201).json({
            success: true,
            message: "Punch-in successful",
            attendance,
            lateQuotaUsed: isLate ? lateCount + 1 : lateCount,
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
//  PUNCH OUT
// ─────────────────────────────────────────────
const punchOut = async (req, res) => {
    try {
        const userId = req.user._id;
        const { isOfflinePunch, offlineTimestamp } = req.body || {};

        const now = isOfflinePunch && offlineTimestamp ? new Date(offlineTimestamp) : new Date();

        // ✅ Time restriction
        const hour = now.getHours();
        if (hour < 9 || hour > 21) {
            return res.status(400).json({
                success: false,
                message: "Punch-out allowed only between 9 AM to 9 PM",
            });
        }

        // ✅ Weekend check
        if (isWeekend(now)) {
            return res.status(400).json({
                success: false,
                message: "Office is closed on weekends",
            });
        }

        const today = new Date(now);
        today.setHours(0, 0, 0, 0);

        // ✅ Holiday check
        const holiday = await Holiday.findOne({
            date: {
                $gte: today,
                $lte: new Date(today.getTime() + 86400000 - 1),
            },
        });

        if (holiday) {
            return res.status(400).json({
                success: false,
                message: `Today is a holiday: ${holiday.name}`,
            });
        }

        // ✅ Find attendance record
        const attendance = await Attendance.findOne({ user: userId, date: today });

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

        // ✅ Work hours
        const workHours = parseFloat(
            ((now - attendance.punchIn) / (1000 * 60 * 60)).toFixed(2)
        );

        // ✅ Overtime (minutes beyond 7 PM)
        const shiftEnd = new Date(today);
        shiftEnd.setHours(19, 0, 0, 0);
        const overtime = parseFloat(
            Math.max(0, (now - shiftEnd) / (1000 * 60)).toFixed(2)
        );

        attendance.punchOut = now;
        attendance.workHours = workHours;
        attendance.overtime = overtime;
        attendance.isOfflinePunch = !!isOfflinePunch;
        attendance.syncedAt = isOfflinePunch ? new Date() : null;

        await attendance.save();

        res.status(200).json({
            success: true,
            message: "Punch-out successful",
            attendance,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


// ─────────────────────────────────────────────
//  HR OVERRIDE
// ─────────────────────────────────────────────
const overrideAttendance = async (req, res) => {
    try {
        const { id } = req.params;

        const attendance = await Attendance.findById(id);
        if (!attendance) {
            return res.status(404).json({
                success: false,
                message: "Attendance not found",
            });
        }

        attendance.isOverridden = true;
        attendance.status = "present";
        attendance.isHalfDay = false;
        attendance.isLate = false;
        attendance.lateMinutes = 0;
        attendance.overriddenBy = req.user._id;

        await attendance.save();

        res.status(200).json({
            success: true,
            message: "Attendance overridden by HR",
            attendance,
        });

    } catch (error) {
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

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const attendance = await Attendance.findOne({ user: userId, date: today });

        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);

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

        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0, 23, 59, 59);

        const data = await Attendance.find({
            user: req.user._id,
            date: { $gte: start, $lte: end },
        }).sort({ date: 1 });

        const lateQuotaUsed = data.filter(a => a.isLate).length;

        res.json({
            success: true,
            lateQuotaUsed,
            lateQuotaMax: MONTHLY_LATE_QUOTA,
            count: data.length,
            data,
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


module.exports = {
    punchIn,
    punchOut,
    overrideAttendance,
    getTodayAttendance,
    getMonthlyAttendance,
    getWeeklyAttendanceSummary,
};