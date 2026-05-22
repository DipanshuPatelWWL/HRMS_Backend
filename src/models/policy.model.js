const mongoose = require("mongoose");

const acknowledgementSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: {
        type: String,
        enum: ["pending", "acknowledged", "declined"],
        default: "pending",
    },
    declineReason: { type: String, default: "" },
    respondedAt: { type: Date, default: null },
    // version the employee responded to (for re-ack tracking)
    policyVersion: { type: Number, default: 1 },
}, { _id: false });

const policySchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    content: { type: String, required: true },   // full HTML or markdown body
    category: {
        type: String,
        enum: ["attendance", "leave", "wfh", "code-of-conduct", "it", "other"],
        default: "other",
    },
    version: { type: Number, default: 1 },       // bumped on every update
    status: {
        type: String,
        enum: ["draft", "published", "archived"],
        default: "draft",
    },
    publishedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // Which employees this policy is assigned to
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // One entry per employee
    acknowledgements: [acknowledgementSchema],
}, {
    timestamps: true,
});

// When a policy is updated (version bumped), reset all acknowledgements to pending
policySchema.methods.bumpVersion = function () {
    this.version += 1;
    this.acknowledgements = this.acknowledgements.map(a => ({
        ...a,
        status: "pending",
        declineReason: "",
        respondedAt: null,
        policyVersion: this.version,
    }));
};

module.exports = mongoose.model("Policy", policySchema);