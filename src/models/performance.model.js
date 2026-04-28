const mongoose = require("mongoose");

const performanceSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    quarter: { type: String, required: true },  // e.g. "Q1 2026"
    year: { type: Number, required: true },
    score: { type: Number, min: 0, max: 100, required: true },
    goals: { type: String, default: "" },
    feedback: { type: String, default: "" },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

module.exports = mongoose.model("Performance", performanceSchema);