const mongoose = require("mongoose");

const dailyReportSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        task_name: {
            type: String,
            required: true,
            trim: true,
        },

        date: {
            type: Date,
            default: Date.now,
        },

        day: {
            type: String,
            required: true,
            trim: true,
        },

        status: {
            type: String,
            enum: ["pending", "completed"],
            default: "pending",
        },

        file: {
            type: String,
            default: "",
        },

        message: {
            type: String,
            trim: true,
            default: "",
        },

        // Employee sends report to manager
        sent: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("dailyReport", dailyReportSchema);