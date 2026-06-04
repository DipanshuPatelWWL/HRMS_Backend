const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        attendanceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Attendance",
            default: null,
        },

        // "2026-05-22"
        dateString: {
            type: String,
            required: true,
            index: true,
        },

        // e.g. "chrome.exe", "Code.exe", "WhatsApp.exe"
        appName: {
            type: String,
            required: true,
            trim: true,
        },

        // e.g. "GitHub - Google Chrome"
        windowTitle: {
            type: String,
            default: "",
            trim: true,
        },

        startTime: {
            type: Date,
            required: true,
        },

        endTime: {
            type: Date,
            default: null,
        },

        // seconds spent on this app/window
        duration: {
            type: Number,
            default: 0,
        },

        category: {
            type: String,
            enum: ["productive", "unproductive", "neutral", "browser"],
            default: "neutral",
        },

        // detected via "Incognito" / "InPrivate" in window title
        isIncognito: {
            type: Boolean,
            default: false,
        },

        isBrowser: {
            type: Boolean,
            default: false,
        },

        source: {
            type: String,
            enum: ["desktop-agent", "manual"],
            default: "desktop-agent",
        },
    },
    {
        timestamps: true,
    }
);

activityLogSchema.index({ user: 1, dateString: 1 });

activityLogSchema.index({
    user: 1,
    dateString: 1,
    appName: 1,
});

activityLogSchema.index({
    user: 1,
    dateString: 1,
    startTime: 1,
});

module.exports = mongoose.model("ActivityLog", activityLogSchema);