const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: [true, "Title is required"],
            trim: true,
        },

        description: {
            type: String,
            default: "",
            trim: true,
        },

        assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        assignedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        status: {
            type: String,
            enum: ["pending", "in-progress", "done"],
            default: "pending",
        },

        priority: {
            type: String,
            enum: ["low", "medium", "high"],
            default: "medium",
        },

        dueDate: {
            type: Date,
            default: null,
        },

        workReport: {
            type: String,
            default: "",
            trim: true,
        },

        completedAt: {
            type: Date,
            default: null,
        },

        tags: {
            type: [String],
            default: [],
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("Task", taskSchema);