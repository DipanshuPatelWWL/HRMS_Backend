const mongoose = require("mongoose");

const trainingSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, default: "" },
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    completedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    dueDate: { type: Date },
    status: { type: String, enum: ["active", "archived"], default: "active" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

module.exports = mongoose.model("Training", trainingSchema);