const mongoose = require("mongoose");

const ScanLogSchema = new mongoose.Schema(
    {
        employeeId: { type: String, required: true, index: true },
        employeeName: { type: String },
        ip: { type: String },

        location: {
            country: String,
            region: String,
            city: String,
            timezone: String,
            ll: [Number], // [lat, lng]
        },

        device: {
            browser: String,
            browserVersion: String,
            os: String,
            osVersion: String,
            deviceType: String, // mobile | desktop | tablet
            deviceVendor: String,
            deviceModel: String,
            userAgent: String,
        },

        scannedAt: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

module.exports = mongoose.model("ScanLog", ScanLogSchema);