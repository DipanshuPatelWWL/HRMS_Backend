const mongoose = require("mongoose");

const celebrationTemplateSchema = new mongoose.Schema(
    {
        templateName: {
            type: String,
            required: [true, "Template name is required"],
            trim: true,
        },

        eventType: {
            type: String,
            enum: ["birthday", "anniversary", "custom", "all"],
            default: "all",
        },

        subject: {
            type: String,
            default: "",
            trim: true,
        },

        body: {
            type: String,
            default: "",
        },

        // Visual style key matching frontend TEMPLATE_DEFS ids
        // e.g. "dark_purple", "corporate_blue", "warm_gold", "light_minimal"
        style: {
            type: String,
            default: "dark_purple",
        },

        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("CelebrationTemplate", celebrationTemplateSchema);