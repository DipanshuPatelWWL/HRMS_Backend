const mongoose = require("mongoose");

const correctionSchema = new mongoose.Schema(
    {
        // ── Who raised it ─────────────────────────────────────────────
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        userName: { type: String }, // denormalised for HR list queries
        employeeId: { type: String },

        // ── Which day is being corrected ───────────────────────────────
        date: {
            type: Date,
            required: true,
        },

        // ── What correction is requested ──────────────────────────────
        type: {
            type: String,
            enum: ["punch_in", "punch_out", "both"],
            required: true,
        },

        // Requested times (null = "not applicable for this type")
        requestedPunchIn: { type: Date, default: null },
        requestedPunchOut: { type: Date, default: null },

        reason: {
            type: String,
            required: true,
            trim: true,
        },

        // ── Audit: original values snapshotted at approval time ────────
        originalPunchIn: { type: Date, default: null },
        originalPunchOut: { type: Date, default: null },

        // ── Decision ──────────────────────────────────────────────────
        status: {
            type: String,
            enum: ["pending", "approved", "rejected", "cancelled", "revoked"],
            default: "pending",
            index: true,
        },

        actionBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        actionDate: { type: Date, default: null },
        hrRemark: { type: String, default: "", trim: true },

        // ── Reference to the attendance record that was patched ────────
        // (set at approval time so we always know which doc changed)
        attendanceRef: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Attendance",
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Compound index: one pending request per user per day
correctionSchema.index({ user: 1, date: 1, status: 1 });

module.exports = mongoose.model("AttendanceCorrection", correctionSchema);