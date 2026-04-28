const mongoose = require("mongoose");

const recruitmentSchema = new mongoose.Schema({
    title: { type: String, required: true },
    department: { type: String, required: true },
    status: { type: String, enum: ["open", "closed", "on-hold"], default: "open" },
    openings: { type: Number, default: 1 },
    filled: { type: Number, default: 0 },
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

module.exports = mongoose.model("Recruitment", recruitmentSchema);