const mongoose = require("mongoose");

const captureRequestSchema = new mongoose.Schema({
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["pending", "completed", "failed"], default: "pending" },
    screenshot: { type: String, default: null },     // base64
    requestedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model("CaptureRequest", captureRequestSchema);