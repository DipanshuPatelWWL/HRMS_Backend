const mongoose = require("mongoose");


const attendanceSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        date: {
            type: Date,
            required: true,
        },
        dateString: {
            type: String,
            index: true,
        },

        punchIn: {
            type: Date,
            default: null,
        },

        punchOut: {
            type: Date,
            default: null,
        },

        workHours: {
            type: Number,
            default: 0,
        },

        lateMinutes: {
            type: Number,
            default: 0,
        },

        isLate: {
            type: Boolean,
            default: false,
        },

        isHalfDay: {
            type: Boolean,
            default: false,
        },

        status: {
            type: String,
            enum: ["present", "absent", "half-day"],
            default: "present",
        },

        isOverridden: {
            type: Boolean,
            default: false,
        },

        overriddenBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        location: {
            lat: Number,
            lng: Number,
            accuracy: Number,
        },
        deviceId: {
            type: String,
            default: "",
        },
        wifiSSID: {
            type: String,
            default: "",
        },
        isMockLocation: {
            type: Boolean,
            default: false,
        },
        breakTime: {
            type: Number,
            default: 0,
        },
        overtime: {
            type: Number,
            default: 0,
        },
        isOfflinePunch: {
            type: Boolean,
            default: false,
        },
        syncedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

attendanceSchema.index({ user: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", attendanceSchema);