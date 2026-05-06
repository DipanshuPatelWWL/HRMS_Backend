const mongoose = require("mongoose");

const celebrationSchema = new mongoose.Schema(
    {
        employeeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        // templateId is now optional — celebrations can be created
        // without a saved template (using templateStyle instead)
        templateId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "CelebrationTemplate",
            default: null,
            required: false,
        },

        // Stores which visual style was chosen from the frontend card picker
        // e.g. "dark_purple", "corporate_blue", "warm_gold", "light_minimal"
        templateStyle: {
            type: String,
            default: "",
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
            enum: ["pending", "sent", "failed"],
            default: "pending",

        }, templateStyle: {
            type: String,
            enum: ["dark_purple", "corporate_blue", "warm_gold", "light_minimal", ""],
            default: "dark_purple",   // ← change from "" to "dark_purple"
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("Celebration", celebrationSchema);