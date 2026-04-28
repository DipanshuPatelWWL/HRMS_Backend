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

        // ✅ Paid / unpaid breakdown — stored at approval time
        paidDays: { type: Number, default: 0 },
        unpaidDays: { type: Number, default: 0 },

        status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "pending",
        },

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

module.exports = mongoose.model("Leave", leaveSchema);