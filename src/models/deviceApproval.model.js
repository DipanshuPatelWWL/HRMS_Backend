const mongoose = require("mongoose");

const deviceApprovalSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        // Device identity
        deviceUUID: { type: String, default: "" },
        productId: { type: String, default: "" },
        hostname: { type: String, default: "" },
        os: { type: String, default: "" },
        browser: { type: String, default: "" },
        ipAddress: { type: String, default: "" },
        userAgent: { type: String, default: "" },

        // Status
        status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "pending",
        },

        // Token generated on approval — sent back to Electron
        deviceToken: { type: String, default: null },

        // HR action
        actionBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        actionAt: { type: Date, default: null },
        reason: { type: String, default: "" },
    },
    { timestamps: true }
);

// One pending request per user per device
deviceApprovalSchema.index(
    { user: 1, productId: 1, status: 1 },
    { unique: false }
);

module.exports = mongoose.model("DeviceApproval", deviceApprovalSchema);