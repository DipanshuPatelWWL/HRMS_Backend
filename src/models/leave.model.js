const mongoose = require("mongoose");

const leaveSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        userName: { type: String },
        employeeId: { type: String },
        userRole: { type: String, default: "" },
        userDesignation: { type: String, default: "" },
        userDepartment: { type: String, default: "" },

        type: {
            type: String,
            enum: ["casual", "sick", "earned", "unpaid"],
            required: true,
        },

        fromDate: { type: Date, required: true },
        toDate: { type: Date, required: true },
        totalDays: { type: Number, required: true },

        reason: { type: String, required: true, trim: true },
        attachment: { type: String, default: "" },

        // ── Medical certificate (optional, Rule 3) ────────
        medicalCertificate: {
            uploaded: { type: Boolean, default: false },
            fileUrl: { type: String, default: "" },
            fileName: { type: String, default: "" },
            uploadedAt: { type: Date, default: null },
        },

        // ── Approval metadata ─────────────────────────────
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        approvedAt: { type: Date, default: null },
        rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        rejectedAt: { type: Date, default: null },
        rejectReason: { type: String, default: "" },

        // ✅ Paid / unpaid breakdown — stored at approval time
        paidDays: { type: Number, default: 0 },
        unpaidDays: { type: Number, default: 0 },

        status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "pending",
        },

        // Flag to indicate TL approval is not required for this leave
        skipTLApproval: { type: Boolean, default: false },

        tlApproval: {
            status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
            actionBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
            actionDate: { type: Date, default: null },
        },

        managerApproval: {
            status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
            actionBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
            actionDate: { type: Date, default: null },
        },

        hrApproval: {
            status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
            actionBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
            actionDate: { type: Date, default: null },
        },
    },
    { timestamps: true }
);

leaveSchema.index({
    user: 1,
    status: 1,
    fromDate: 1,
    toDate: 1,
});

leaveSchema.index({
    user: 1,
    createdAt: -1,
});

module.exports = mongoose.model("Leave", leaveSchema);