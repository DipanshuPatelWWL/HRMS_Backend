const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        title: { type: String, required: true },
        message: { type: String, default: "" },

        type: {
            type: String,
            enum: [
                "leave",
                "leave_applied",
                "leave_approved",
                "leave_rejected",
                "payroll",
                "attendance",
                "system",
                "announcement",
                "task_assigned",
                "task_updated",
                "task_done",
                "ticket_replied",
                "ticket_resolved",
                "general",
                "security",
            ],
            default: "general",
        },

        isRead: { type: Boolean, default: false },

        /* Optional extra data (e.g. link back to the source document) */
        meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    { timestamps: true }
);

/* Index for fast per-user queries */
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, isRead: 1 });

module.exports = mongoose.model("Notification", notificationSchema);