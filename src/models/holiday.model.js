// models/holiday.model.js
const mongoose = require("mongoose");

const holidaySchema = new mongoose.Schema(
    {
        date: {
            type: Date,
            required: true,
            unique: true, // one holiday per date
        },
        name: {
            type: String,
            required: true,
            trim: true,
            // e.g. "Diwali", "Republic Day", "Team Offsite"
        },
        type: {
            type: String,
            enum: ["national", "regional", "company"],
            default: "company",
        },
        markedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User", // HR or Manager who created it
            default: null,
        },
    },
    { timestamps: true }
);

// Normalize to midnight before saving so date comparisons always work
holidaySchema.pre("save", function () {
    const d = new Date(this.date);
    d.setHours(0, 0, 0, 0);
    this.date = d;
});

module.exports = mongoose.model("Holiday", holidaySchema);