const mongoose = require("mongoose");

const celebrationSchema = new mongoose.Schema(
    {
        employeeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        templateId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "CelebrationTemplate",
            default: null,
            required: false,
        },

        eventType: {
            type: String,
            enum: ["birthday", "anniversary", "custom"],
            required: true,
        },

        sendToEmployee: {
            type: Boolean,
            default: true,
        },

        sendToOthers: {
            type: Boolean,
            default: true,
        },

        recipients: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
            },
        ],

        customMessage: {
            type: String,
            default: "",
        },
        uploadedImage: {
            type: String,
            default: "",
        },

        scheduledAt: {
            type: Date,
            required: true,
        },

        status: {
            type: String,
            enum: ["pending", "processing", "sent", "failed"],
            default: "pending",
        },

        templateStyle: {
            type: String,
            enum: ["dark_purple", "corporate_blue", "warm_gold", "light_minimal", ""],
            default: "dark_purple",
        },

        sentAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("Celebration", celebrationSchema);