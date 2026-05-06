const mongoose = require("mongoose");

const salesReportSchema = new mongoose.Schema(
    {
        date: {
            type: Date,
            default: Date.now,
        },

        marketer: String,
        client_name: String,
        client_email: String,
        services: String,
        country: String,
        message: String,

        status: {
            type: String,
            enum: [
                "draft",
                "sent_to_manager",
                "approved",
                "rejected"
            ],
            default: "draft",
        },

        // who created lead (sales employee)
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        // optional: which manager approved/rejected
        action_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },

        reject_reason: {
            type: String,
            default: "",
        },
        action_date: Date,
    },
    { timestamps: true }
);

module.exports = mongoose.model("SalesReport", salesReportSchema);