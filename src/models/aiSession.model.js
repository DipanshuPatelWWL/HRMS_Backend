const mongoose = require("mongoose");

const aiSessionSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },

        pendingIntent: {
            type: String,
            default: null,
        },

        context: {
            type: Object,
            default: {},
        },

        expiresAt: {
            type: Date,
            default: () => new Date(Date.now() + 10 * 60 * 1000),
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("aiSession", aiSessionSchema);