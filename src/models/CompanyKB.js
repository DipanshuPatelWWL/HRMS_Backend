const mongoose = require("mongoose");

const companyKBSchema = new mongoose.Schema(
    {
        question: {
            type: String,
            required: true,
            unique: true,
        },

        answer: {
            type: String,
            required: true,
        },

        category: {
            type: String,
            default: "general",
        },

        // OPTIONAL: similar question variations
        aliases: [
            {
                type: String,
            },
        ],

        embedding: {
            type: [Number],
            default: [],
        },

        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
    },
    { timestamps: true }
);


// TEXT SEARCH FOR SMART MATCHING
companyKBSchema.index({
    question: "text",
    answer: "text",
    aliases: "text",
});

module.exports = mongoose.model("CompanyKB", companyKBSchema);