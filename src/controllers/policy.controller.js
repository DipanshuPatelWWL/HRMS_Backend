const Policy = require("../models/policy.model");
const User = require("../models/user.model");

// ── HR: create policy ──────────────────────────────────────────
exports.createPolicy = async (req, res) => {
    try {
        const { title, description, content, category } = req.body;
        const policy = await Policy.create({
            title, description, content, category,
            createdBy: req.user.id,
        });
        res.status(201).json({ success: true, policy });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── HR: publish policy (assign to employees) ──────────────────
exports.publishPolicy = async (req, res) => {
    try {
        const { policyId } = req.params;
        // assignTo: array of user IDs, or "all" / department string
        const { assignTo } = req.body;   // e.g. { assignTo: "all" } or { assignTo: [id1,id2] }

        const policy = await Policy.findById(policyId);
        if (!policy) return res.status(404).json({ success: false, message: "Policy not found" });

        let employees = [];
        if (assignTo === "all") {
            employees = await User.find({ status: "active", role: { $in: ["employee", "tl"] } }).select("_id");
        } else if (Array.isArray(assignTo)) {
            employees = assignTo.map(id => ({ _id: id }));
        }

        const employeeIds = employees.map(e => e._id);

        policy.assignedTo = employeeIds;
        policy.acknowledgements = employeeIds.map(id => ({
            employee: id,
            status: "pending",
            policyVersion: policy.version,
        }));
        policy.status = "published";
        policy.publishedAt = new Date();
        await policy.save();

        // Fire socket notification
        const io = req.app.get("io");
        if (io) {
            employeeIds.forEach(id => {
                io.to(id.toString()).emit("new_notification", {
                    type: "policy",
                    message: `New policy published: ${policy.title}`,
                    policyId: policy._id,
                });
            });
        }

        res.json({ success: true, policy });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── HR: update policy content (bumps version, resets acks) ────
exports.updatePolicy = async (req, res) => {
    try {
        const { policyId } = req.params;
        const { title, description, content, category } = req.body;

        const policy = await Policy.findById(policyId);
        if (!policy) return res.status(404).json({ success: false, message: "Policy not found" });

        policy.title = title ?? policy.title;
        policy.description = description ?? policy.description;
        policy.content = content ?? policy.content;
        policy.category = category ?? policy.category;

        // Bump version & reset all acks
        policy.bumpVersion();

        await policy.save();

        // Notify all assigned employees to re-acknowledge
        const io = req.app.get("io");
        if (io) {
            policy.assignedTo.forEach(id => {
                io.to(id.toString()).emit("new_notification", {
                    type: "policy_updated",
                    message: `Policy updated — please re-read: ${policy.title}`,
                    policyId: policy._id,
                });
            });
        }

        res.json({ success: true, policy });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── HR: get all policies with response stats ───────────────────
exports.getAllPolicies = async (req, res) => {
    try {
        const { status, category } = req.query;
        const filter = {};
        if (status) filter.status = status;
        if (category) filter.category = category;

        const policies = await Policy.find(filter)
            .populate("createdBy", "name employeeId")
            .sort({ createdAt: -1 });

        // Attach stats
        const result = policies.map(p => {
            const acks = p.acknowledgements;
            return {
                ...p.toObject(),
                stats: {
                    total: acks.length,
                    acknowledged: acks.filter(a => a.status === "acknowledged").length,
                    pending: acks.filter(a => a.status === "pending").length,
                },
            };
        });

        res.json({ success: true, policies: result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── HR: get policy responses (with employee details + filter) ──
exports.getPolicyResponses = async (req, res) => {
    try {
        const { policyId } = req.params;
        const { status, department } = req.query;

        const policy = await Policy.findById(policyId)
            .populate({
                path: "acknowledgements.employee",
                select: "name employeeId department designation avatar",
            });

        if (!policy) return res.status(404).json({ success: false, message: "Policy not found" });

        let responses = policy.acknowledgements;

        if (status) responses = responses.filter(a => a.status === status);
        if (department) responses = responses.filter(a => a.employee?.department === department);

        res.json({ success: true, responses, policy: { title: policy.title, version: policy.version } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── HR: delete / archive policy ────────────────────────────────
exports.archivePolicy = async (req, res) => {
    try {
        const policy = await Policy.findByIdAndUpdate(
            req.params.policyId,
            { status: "archived" },
            { new: true }
        );
        res.json({ success: true, policy });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── EMPLOYEE: get assigned policies ───────────────────────────
exports.getMyPolicies = async (req, res) => {
    try {
        const userId = req.user.id;

        const policies = await Policy.find({
            assignedTo: userId,
            status: "published",
        }).select("title description category version publishedAt acknowledgements");

        const result = policies.map(p => {
            const myAck = p.acknowledgements.find(
                a => a.employee.toString() === userId
            );
            return {
                _id: p._id,
                title: p.title,
                description: p.description,
                category: p.category,
                version: p.version,
                publishedAt: p.publishedAt,
                status: myAck?.status ?? "pending",
                declineReason: myAck?.declineReason ?? "",
                respondedAt: myAck?.respondedAt ?? null,
                requiresAction: !myAck || myAck.status === "pending" || myAck.policyVersion < p.version,
            };
        });

        res.json({ success: true, policies: result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── EMPLOYEE: get single policy (full content) ─────────────────
exports.getPolicyById = async (req, res) => {
    try {
        const policy = await Policy.findById(req.params.policyId)
            .populate("createdBy", "name");
        if (!policy) return res.status(404).json({ success: false, message: "Not found" });
        res.json({ success: true, policy });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── EMPLOYEE: acknowledge one or many policies ─────────────────
exports.acknowledgePolicies = async (req, res) => {
    try {
        const userId = req.user.id;
        const { policyIds } = req.body;   // array of IDs

        await Promise.all(policyIds.map(async (policyId) => {
            await Policy.updateOne(
                { _id: policyId, "acknowledgements.employee": userId },
                {
                    $set: {
                        "acknowledgements.$.status": "acknowledged",
                        "acknowledgements.$.respondedAt": new Date(),
                        "acknowledgements.$.declineReason": "",
                    },
                }
            );
        }));

        res.json({ success: true, message: "Acknowledged successfully" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};


// ── HR: restore archived policy back to draft ─────────────────
exports.restorePolicy = async (req, res) => {
    try {
        const policy = await Policy.findByIdAndUpdate(
            req.params.policyId,
            { status: "draft" },
            { new: true }
        );
        if (!policy) return res.status(404).json({ success: false, message: "Policy not found" });
        res.json({ success: true, policy });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── HR: permanently delete policy ────────────────────────────
exports.deletePolicy = async (req, res) => {
    try {
        await Policy.findByIdAndDelete(req.params.policyId);
        res.json({ success: true, message: "Policy deleted" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};