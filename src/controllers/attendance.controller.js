const Attendance = require("../models/attendance.model");
const User = require("../models/user.model");
const Holiday = require("../models/holiday.model");
const Leave = require("../models/leave.model");
const { createNotification, broadcastNotification } = require("./notification.controller");
const { sendMail } = require("../services/emailClient");

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
const SHIFT_END_MINUTES = 17 * 60;

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

const formatTime = (date) =>
    new Date(date).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });


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

        // ✅ FIX: Always use REAL server date as the date key — never the offline timestamp
        // This prevents duplicate records when offline punch date differs from server date
        const today = new Date();
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
        const todayEnd = new Date(today);
        todayEnd.setHours(23, 59, 59, 999);

        const existing = await Attendance.findOne({
            user: userId,
            $or: [
                { date: today },
                { punchIn: { $gte: today, $lte: todayEnd } },
            ],
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

        if (isHalfDay || isLate) {
            const employee = await User.findById(userId).select("email name");
            await sendMail({
                to: employee.email,
                subject: isHalfDay ? "⚠️ Half Day Marked" : "⏰ Late Arrival Recorded",
                html: `<p>Hi ${employee.name}, your punch-in at <b>${formatTime(now)}</b> has been recorded as <b>${isHalfDay ? "Half Day" : "Late"}</b>.</p>`
            });
        }


        // ── Notify HR ────────────────────────────────────────────────────────
        const io = req.app.get("io");
        const employeeName = req.user.name || "An employee";
        const punchTime = formatTime(now);

        // Build a smart status label for HR
        let statusLabel = "✅ On Time";
        if (isHalfDay) statusLabel = "⚠️ Half Day";
        else if (isLate) statusLabel = `⏰ Late (+${lateMinutes}m)`;

        await broadcastNotification(
            io,
            ["hr", "manager"],                              // who gets it
            `${employeeName} Punched In`,                   // title
            `Punched in at ${punchTime} — ${statusLabel}`,  // message
            "attendance",                                    // type
            { userId, attendanceId: attendance._id, status, isLate, isHalfDay }
        );

        // ── Also notify TL of the employee (if reportingTo is set) ──────────
        const employeeDoc = await User.findById(userId).select("reportingTo").lean();
        if (employeeDoc?.reportingTo) {
            await createNotification(
                io,
                employeeDoc.reportingTo,
                `${employeeName} Punched In`,
                `Punched in at ${punchTime} — ${statusLabel}`,
                "attendance",
                { userId, attendanceId: attendance._id, status }
            );
        }

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
// const punchOut = async (req, res) => {
//     try {
//         const userId = req.user._id;
//         const { isOfflinePunch, offlineTimestamp } = req.body || {};

//         const now = isOfflinePunch && offlineTimestamp ? new Date(offlineTimestamp) : new Date();

//         // ✅ Time restriction
//         const hour = now.getHours();
//         if (hour < 9 || hour > 21) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Punch-out allowed only between 9 AM to 9 PM",
//             });
//         }

//         // ✅ Weekend check
//         if (isWeekend(now)) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Office is closed on weekends",
//             });
//         }

//         const today = new Date();
//         today.setHours(0, 0, 0, 0);

//         // ✅ Holiday check
//         const holiday = await Holiday.findOne({
//             date: {
//                 $gte: today,
//                 $lte: new Date(today.getTime() + 86400000 - 1),
//             },
//         });

//         if (holiday) {
//             return res.status(400).json({
//                 success: false,
//                 message: `Today is a holiday: ${holiday.name}`,
//             });
//         }

//         // ✅ Find attendance record
//         const attendance = await Attendance.findOne({ user: userId, date: today });

//         if (!attendance) {
//             return res.status(404).json({
//                 success: false,
//                 message: "No punch-in found for today",
//             });
//         }

//         if (attendance.punchOut) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Already punched out",
//             });
//         }

//         // ✅ Work hours
//         const workHours = parseFloat(
//             ((now - attendance.punchIn) / (1000 * 60 * 60)).toFixed(2)
//         );

//         // ✅ Overtime (minutes beyond 7 PM)
//         const shiftEnd = new Date(today);
//         shiftEnd.setHours(19, 0, 0, 0);
//         const overtime = parseFloat(
//             Math.max(0, (now - shiftEnd) / (1000 * 60)).toFixed(2)
//         );

//         attendance.punchOut = now;
//         attendance.workHours = workHours;
//         attendance.overtime = overtime;
//         attendance.isOfflinePunch = !!isOfflinePunch;
//         attendance.syncedAt = isOfflinePunch ? new Date() : null;

//         await attendance.save();


//         // ── Notify HR ────────────────────────────────────────────────────────
//         const io = req.app.get("io");
//         const employeeName = req.user.name || "An employee";
//         const punchTime = formatTime(now);

//         // Build work hours label
//         const hrs = Math.floor(workHours);
//         const mins = Math.round((workHours - hrs) * 60);
//         const workLabel = `${hrs}h ${mins}m worked`;

//         // Overtime label
//         const overtimeLabel = overtime > 0
//             ? ` · OT: ${Math.floor(overtime / 60)}h ${Math.round(overtime % 60)}m`
//             : "";

//         await broadcastNotification(
//             io,
//             ["hr", "manager"],
//             `${employeeName} Punched Out`,
//             `Punched out at ${punchTime} — ${workLabel}${overtimeLabel}`,
//             "attendance",
//             { userId, attendanceId: attendance._id, workHours, overtime }
//         );

//         // ── Also notify TL ───────────────────────────────────────────────────
//         const employeeDoc = await User.findById(userId).select("reportingTo").lean();
//         if (employeeDoc?.reportingTo) {
//             await createNotification(
//                 io,
//                 employeeDoc.reportingTo,
//                 `${employeeName} Punched Out`,
//                 `Punched out at ${punchTime} — ${workLabel}${overtimeLabel}`,
//                 "attendance",
//                 { userId, attendanceId: attendance._id, workHours }
//             );
//         }


//         res.status(200).json({
//             success: true,
//             message: "Punch-out successful",
//             attendance,
//         });

//     } catch (error) {
//         res.status(500).json({
//             success: false,
//             message: error.message,
//         });
//     }
// };



const punchOut = async (req, res) => {
    try {
        const userId = req.user._id;
        const { isOfflinePunch, offlineTimestamp } = req.body || {};

        const now = isOfflinePunch && offlineTimestamp ? new Date(offlineTimestamp) : new Date();

        const hour = now.getHours();
        if (hour < 9 || hour > 21) {
            return res.status(400).json({
                success: false,
                message: "Punch-out allowed only between 9 AM to 9 PM",
            });
        }

        if (isWeekend(now)) {
            return res.status(400).json({
                success: false,
                message: "Office is closed on weekends",
            });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

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

        const workHours = parseFloat(
            ((now - attendance.punchIn) / (1000 * 60 * 60)).toFixed(2)
        );

        const shiftEnd = new Date(today);
        shiftEnd.setHours(19, 0, 0, 0);
        const overtime = parseFloat(
            Math.max(0, (now - shiftEnd) / (1000 * 60)).toFixed(2)
        );

        // ─────────────────────────────────────────────────────────────────
        //  ✅ FIX: EARLY PUNCH-OUT → HALF DAY
        //
        //  OLD BLOCK:
        //  attendance.punchOut  = now;
        //  attendance.workHours = workHours;
        //  attendance.overtime  = overtime;
        //  ← status and isHalfDay were never touched on punch-out
        //
        //  NEW BLOCK:
        //  Check if punch-out is before 5:00 PM.
        //  If yes and not already a half-day → mark as half-day.
        // ─────────────────────────────────────────────────────────────────
        const punchOutMinutes = now.getHours() * 60 + now.getMinutes();
        const alreadyHalfDay = attendance.isHalfDay;

        if (!alreadyHalfDay && punchOutMinutes < SHIFT_END_MINUTES) {
            attendance.isHalfDay = true;
            attendance.status = "half-day";

            const employee = await User.findById(userId).select("email name");
            await sendMail({
                to: employee.email,
                subject: "⚠️ Half Day Marked — Early Punch Out",
                html: `<p>Hi ${employee.name}, you punched out at <b>${formatTime(now)}</b> which is before 5:00 PM. Your attendance has been marked as <b>Half Day</b>.</p>`,
            });
        }
        // ─────────────────────────────────────────────────────────────────
        //  END FIX
        // ─────────────────────────────────────────────────────────────────

        attendance.punchOut = now;
        attendance.workHours = workHours;
        attendance.overtime = overtime;
        attendance.isOfflinePunch = !!isOfflinePunch;
        attendance.syncedAt = isOfflinePunch ? new Date() : null;

        await attendance.save();

        const io = req.app.get("io");
        const employeeName = req.user.name || "An employee";
        const punchTime = formatTime(now);

        const hrs = Math.floor(workHours);
        const mins = Math.round((workHours - hrs) * 60);
        const workLabel = `${hrs}h ${mins}m worked`;

        const overtimeLabel = overtime > 0
            ? ` · OT: ${Math.floor(overtime / 60)}h ${Math.round(overtime % 60)}m`
            : "";

        // ✅ Include early punch-out label in HR notification
        const earlyLabel = (!alreadyHalfDay && punchOutMinutes < SHIFT_END_MINUTES)
            ? " · ⚠️ Early Punch Out (Half Day)"
            : "";

        await broadcastNotification(
            io,
            ["hr", "manager"],
            `${employeeName} Punched Out`,
            `Punched out at ${punchTime} — ${workLabel}${overtimeLabel}${earlyLabel}`,
            "attendance",
            { userId, attendanceId: attendance._id, workHours, overtime }
        );

        const employeeDoc = await User.findById(userId).select("reportingTo").lean();
        if (employeeDoc?.reportingTo) {
            await createNotification(
                io,
                employeeDoc.reportingTo,
                `${employeeName} Punched Out`,
                `Punched out at ${punchTime} — ${workLabel}${overtimeLabel}${earlyLabel}`,
                "attendance",
                { userId, attendanceId: attendance._id, workHours }
            );
        }

        res.status(200).json({
            success: true,
            message: "Punch-out successful",
            attendance,
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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


// const getMonthlyAttendance = async (req, res) => {
//     try {
//         const { month, year } = req.query;

//         if (!month || !year) {
//             return res.status(400).json({
//                 success: false,
//                 message: "month and year are required",
//             });
//         }

//         const start = new Date(year, month - 1, 1);
//         const end = new Date(year, month, 0, 23, 59, 59);

//         const data = await Attendance.find({
//             user: req.user._id,
//             date: { $gte: start, $lte: end },
//         }).sort({ date: 1 });

//         const lateQuotaUsed = data.filter(a => a.isLate).length;

//         res.json({
//             success: true,
//             lateQuotaUsed,
//             lateQuotaMax: MONTHLY_LATE_QUOTA,
//             count: data.length,
//             data,
//         });

//     } catch (error) {
//         res.status(500).json({
//             success: false,
//             message: error.message,
//         });
//     }
// };

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
        const user = await User.findById(req.user._id).select("joiningDate");

        const joiningDate = user?.joiningDate
            ? new Date(new Date(user.joiningDate).setHours(0, 0, 0, 0))
            : null;

        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0, 23, 59, 59);

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

        res.json({
            success: true,
            lateQuotaUsed,
            lateQuotaMax: MONTHLY_LATE_QUOTA,
            count: fullData.length,
            data: fullData,
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

        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0, 23, 59, 59);

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
                const weekend = isWeekend(currentDate);
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

        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0, 23, 59, 59);

        // All active employees + tl + managers
        const allEmployees = await User.find({
            role: { $in: ["employee", "tl"] },
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

            return {
                _id: emp._id,
                name: emp.name,
                employeeId: emp.employeeId,
                department: emp.department,
                designation: emp.designation,
                role: emp.role,
                stats: { presentDays, halfDays, lateDays, absentDays, leaveDays },
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