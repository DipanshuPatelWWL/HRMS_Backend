const AttendanceCorrection = require("../models/attendanceCorrection.model");
const Attendance = require("../models/attendance.model");
const { createNotification, broadcastNotification } = require("./notification.controller");
const Holiday = require("../models/holiday.model");
const Leave = require("../models/leave.model");
const moment = require("moment-timezone");


const LATE_TRIGGER = 10 * 60 + 15;   // 10:15 → late, quota consumed
const LATE_CUTOFF = 10 * 60 + 30;   // 10:30 → half-day, quota not consumed
const ONTIME_CUTOFF_P2 = 10 * 60 + 5;  // 10:05 → grace when quota exhausted
const MONTHLY_LATE_QUOTA = 3;

// ─────────────────────────────────────────────
//  HELPER — rebuild work hours after a correction
// ─────────────────────────────────────────────
const recalcWorkHours = (punchIn, punchOut) => {
    if (!punchIn || !punchOut) return 0;
    return parseFloat(((punchOut - punchIn) / (1000 * 60 * 60)).toFixed(2));
};


const applyCorrection = async (correction, hrUserId) => {
    const correctionDateIST = moment(correction.date).tz("Asia/Kolkata");
    const dateString = correctionDateIST.format("YYYY-MM-DD");
    const dayStart = correctionDateIST.clone().startOf("day").toDate();
    const dayEnd = correctionDateIST.clone().endOf("day").toDate();

    let attendance = await Attendance.findOne({
        user: correction.user,
        dateString: dateString,
    });

    correction.originalPunchIn = attendance?.punchIn || null;
    correction.originalPunchOut = attendance?.punchOut || null;

    if (!attendance) {
        attendance = new Attendance({
            user: correction.user,
            date: dayStart,
            dateString: dateString,
            status: "present",
        });
    }

    if (correction.type === "punch_in" || correction.type === "both") {
        if (correction.requestedPunchIn) {
            attendance.punchIn = correction.requestedPunchIn;
        }
    }

    if (correction.type === "punch_out" || correction.type === "both") {
        if (correction.requestedPunchOut) {
            attendance.punchOut = correction.requestedPunchOut;
        }
    }

    // ── Recalculate work hours ────────────────────────────────────────────────
    if (attendance.punchIn && attendance.punchOut) {
        attendance.workHours = recalcWorkHours(attendance.punchIn, attendance.punchOut);
    }

    // ── Recalculate late / half-day status from the corrected punch-in time ──
    // This is what was missing — status, isLate, isHalfDay were never updated
    if (attendance.punchIn) {
        // Convert to IST to get correct hours/minutes on production (UTC server)
        const punchInIST = moment(attendance.punchIn).tz("Asia/Kolkata");
        const totalMinutes = punchInIST.hour() * 60 + punchInIST.minute();

        const monthStart = punchInIST.clone().startOf("month").toDate();
        const monthEnd = punchInIST.clone().endOf("month").toDate();

        const lateCount = await Attendance.countDocuments({
            user: correction.user,
            date: { $gte: monthStart, $lte: monthEnd },
            isLate: true,
            _id: { $ne: attendance._id },   // exclude self
        });

        let isLate = false;
        let isHalfDay = false;
        let status = "present";

        if (lateCount < MONTHLY_LATE_QUOTA) {
            // Phase 1: quota still available
            if (totalMinutes <= LATE_TRIGGER) {
                // ≤ 10:15 → on time
            } else if (totalMinutes <= LATE_CUTOFF) {
                // 10:16 – 10:30 → late, consumes quota
                isLate = true;
            } else {
                // > 10:30 → half-day
                isHalfDay = true;
                status = "half-day";
            }
        } else {
            // Phase 2: quota exhausted
            if (totalMinutes <= ONTIME_CUTOFF_P2) {
                // ≤ 10:05 → on time
            } else {
                // > 10:05 → half-day
                isHalfDay = true;
                status = "half-day";
            }
        }

        // Recalculate late minutes using IST shift start
        const shiftStartIST = correctionDateIST.clone().hour(10).minute(0).second(0);
        const lateMinutes = (isLate || isHalfDay)
            ? parseFloat(Math.max(0, punchInIST.diff(shiftStartIST, "minutes"))
                .toFixed(2))
            : 0;

        attendance.isLate = isLate;
        attendance.isHalfDay = isHalfDay;
        attendance.status = status;
        attendance.lateMinutes = lateMinutes;
    }

    attendance.isOverridden = true;
    attendance.overriddenBy = hrUserId;

    if (attendance.punchIn && !attendance.punchOut) {
        const shiftEndIST = correctionDateIST.clone().hour(19).minute(0).second(0);
        const shiftEndDate = shiftEndIST.toDate();
        attendance.punchOut = shiftEndDate;
        attendance.workHours = parseFloat(
            ((shiftEndDate - attendance.punchIn) / (1000 * 60 * 60)).toFixed(2)
        );
    }

    await attendance.save();
    return attendance;
};

// ─────────────────────────────────────────────
//  APPLY FOR CORRECTION (Employee)
// ─────────────────────────────────────────────
const applyCorrection_handler = async (req, res) => {
    try {
        const userId = req.user._id;
        const { type, date, requestedPunchIn, requestedPunchOut, reason } = req.body;

        // ── Basic validation ───────────────────────────────────────────
        if (!type || !date || !reason) {
            return res.status(400).json({
                success: false,
                message: "type, date and reason are required",
            });
        }

        if (!["punch_in", "punch_out", "both"].includes(type)) {
            return res.status(400).json({
                success: false,
                message: "type must be punch_in | punch_out | both",
            });
        }

        if ((type === "punch_in" || type === "both") && !requestedPunchIn) {
            return res.status(400).json({
                success: false,
                message: "requestedPunchIn is required for this correction type",
            });
        }

        if ((type === "punch_out" || type === "both") && !requestedPunchOut) {
            return res.status(400).json({
                success: false,
                message: "requestedPunchOut is required for this correction type",
            });
        }

        // Use IST to determine the correction date — avoids UTC midnight shifting the day
        const correctionDateIST = moment.tz(date, "Asia/Kolkata").startOf("day");
        const correctionDate = correctionDateIST.toDate();

        // ── Block future dates ─────────────────────────────────────────
        const todayIST = moment().tz("Asia/Kolkata").startOf("day");
        if (correctionDateIST.isAfter(todayIST)) {
            return res.status(400).json({
                success: false,
                message: "Cannot raise a correction for a future date",
            });
        }

        // ── Block weekends ─────────────────────────────────────────────
        const dayOfWeek = correctionDateIST.day();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            return res.status(400).json({
                success: false,
                message: "Cannot raise a correction for a weekend — office is closed",
            });
        }

        // ── Block public holidays ──────────────────────────────────────
        const correctionDateEnd = correctionDateIST.clone().endOf("day").toDate();

        const holidayOnDate = await Holiday.findOne({
            date: {
                $gte: correctionDate,
                $lte: correctionDateEnd,
            },
        });

        if (holidayOnDate) {
            return res.status(400).json({
                success: false,
                message: `Cannot raise a correction for a public holiday: ${holidayOnDate.name}`,
            });
        }

        // ── Block approved leave days ──────────────────────────────────
        const leaveOnDate = await Leave.findOne({
            user: userId,
            status: "approved",
            fromDate: { $lte: correctionDate },
            toDate: { $gte: correctionDate },
        });

        if (leaveOnDate) {
            return res.status(400).json({
                success: false,
                message: `Cannot raise a correction — you were on approved ${leaveOnDate.type || "leave"} on this date`,
            });
        }

        // ── Block if punch-in is after punch-out ───────────────────────
        if (requestedPunchIn && requestedPunchOut) {
            if (new Date(requestedPunchIn) >= new Date(requestedPunchOut)) {
                return res.status(400).json({
                    success: false,
                    message: "Punch-in must be before punch-out",
                });
            }
        }

        // ── One pending request per day ────────────────────────────────
        const existing = await AttendanceCorrection.findOne({
            user: userId,
            date: correctionDate,
            status: "pending",
        });

        if (existing) {
            return res.status(400).json({
                success: false,
                message: "You already have a pending correction request for this date",
            });
        }

        // ── Create record ──────────────────────────────────────────────
        const correction = await AttendanceCorrection.create({
            user: userId,
            userName: req.user.name,
            employeeId: req.user.employeeId,
            date: correctionDate,
            type,
            requestedPunchIn: requestedPunchIn ? new Date(requestedPunchIn) : null,
            requestedPunchOut: requestedPunchOut ? new Date(requestedPunchOut) : null,
            reason,
        });

        // ── Notify HR ──────────────────────────────────────────────────
        const io = req.app.get("io");
        await broadcastNotification(
            io,
            ["hr", "manager"],
            "Attendance Correction Request 📋",
            `${req.user.name} requested a ${type.replace("_", "-")} correction for ${correctionDate.toDateString()}`,
            "attendance",
            { correctionId: correction._id, userId }
        );

        res.status(201).json({
            success: true,
            message: "Correction request submitted",
            correction,
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET MY CORRECTIONS (Employee)
// ─────────────────────────────────────────────
const getMyCorrections = async (req, res) => {
    try {
        const { status } = req.query;
        const filter = { user: req.user._id };
        if (status) filter.status = status;

        const corrections = await AttendanceCorrection.find(filter)
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json({ success: true, count: corrections.length, corrections });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET ALL CORRECTIONS (HR / Manager)
// ─────────────────────────────────────────────
const getAllCorrections = async (req, res) => {
    try {
        const { status, limit } = req.query;
        const filter = {};
        if (status) filter.status = status;

        let query = AttendanceCorrection.find(filter)
            .populate("user", "name email employeeId department designation")
            .populate("actionBy", "name")
            .sort({ createdAt: -1 });

        if (limit) query = query.limit(parseInt(limit));

        const corrections = await query;

        res.status(200).json({ success: true, count: corrections.length, corrections });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  REVIEW CORRECTION (HR — approve or reject)
// ─────────────────────────────────────────────
const reviewCorrection = async (req, res) => {
    try {
        const { id } = req.params;
        const { action, hrRemark } = req.body;
        const io = req.app.get("io");

        if (!["approved", "rejected"].includes(action)) {
            return res.status(400).json({ success: false, message: "action must be approved | rejected" });
        }

        const correction = await AttendanceCorrection.findById(id);
        if (!correction) {
            return res.status(404).json({ success: false, message: "Correction request not found" });
        }

        if (correction.status !== "pending") {
            return res.status(400).json({ success: false, message: "Request already actioned" });
        }

        correction.status = action;
        correction.actionBy = req.user._id;
        correction.actionDate = new Date();
        correction.hrRemark = hrRemark?.trim() || "";

        if (action === "approved") {
            // ── AUTO-APPLY: patch the attendance record ────────────────
            const attendance = await applyCorrection(correction, req.user._id);
            correction.attendanceRef = attendance._id;

            await correction.save();

            // Notify employee: approved
            await createNotification(
                io,
                correction.user,
                "Attendance Corrected ✅",
                `Your attendance for ${new Date(correction.date).toDateString()} has been corrected by HR`,
                "attendance",
                { correctionId: correction._id, attendanceId: attendance._id }
            );

            res.status(200).json({
                success: true,
                message: "Correction approved and attendance updated",
                correction,
                attendance,
            });

        } else {
            // ── REJECTED ───────────────────────────────────────────────
            await correction.save();

            await createNotification(
                io,
                correction.user,
                "Correction Request Rejected ❌",
                `Your attendance correction for ${new Date(correction.date).toDateString()} was not approved. ${hrRemark ? `Reason: ${hrRemark}` : "Contact HR for details."}`,
                "attendance",
                { correctionId: correction._id }
            );

            res.status(200).json({
                success: true,
                message: "Correction rejected",
                correction,
            });
        }

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  DELETE CORRECTION REQUEST
//  Employee can delete their own pending request
//  HR can delete any request
// ─────────────────────────────────────────────
const deleteCorrection = async (req, res) => {
    try {
        const { id } = req.params;

        const correction = await AttendanceCorrection.findById(id);
        if (!correction) {
            return res.status(404).json({ success: false, message: "Not found" });
        }

        const isOwner = correction.user.toString() === req.user._id.toString();
        const isHR = ["hr", "manager"].includes(req.user.role);

        if (!isOwner && !isHR) {
            return res.status(403).json({ success: false, message: "Not allowed" });
        }

        if (isOwner && !isHR && correction.status !== "pending") {
            return res.status(400).json({
                success: false,
                message: "Only pending requests can be withdrawn",
            });
        }

        await AttendanceCorrection.findByIdAndDelete(id);

        res.status(200).json({ success: true, message: "Correction request deleted" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  STATS (HR dashboard widget)
// ─────────────────────────────────────────────
const getCorrectionStats = async (req, res) => {
    try {
        const [pending, approved, rejected] = await Promise.all([
            AttendanceCorrection.countDocuments({ status: "pending" }),
            AttendanceCorrection.countDocuments({ status: "approved" }),
            AttendanceCorrection.countDocuments({ status: "rejected" }),
        ]);

        res.status(200).json({
            success: true,
            stats: { pending, approved, rejected, total: pending + approved + rejected },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    applyCorrection: applyCorrection_handler,
    getMyCorrections,
    getAllCorrections,
    reviewCorrection,
    deleteCorrection,
    getCorrectionStats,
};