const mongoose = require("mongoose");

const unansweredQSchema = new mongoose.Schema({
    question: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    role: { type: String },
    count: { type: Number, default: 1 },
    status: { type: String, enum: ["pending", "answered"], default: "pending" },
}, { timestamps: true });

module.exports = mongoose.model("UnansweredQ", unansweredQSchema);