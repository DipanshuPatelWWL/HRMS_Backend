const { v4: uuidv4 } = require("uuid");
const DeviceApproval = require("../models/deviceApproval.model");
const User = require("../models/user.model");
const { createNotification } = require("./notification.controller");

// ── GET all requests (HR view) ────────────────────────────────────────
const getAllRequests = async (req, res) => {
    try {
        const { status } = req.query;
        const filter = {};
        if (status && status !== "all") filter.status = status;

        const requests = await DeviceApproval.find(filter)
            .populate("user", "name email employeeId role department status")
            .populate("actionBy", "name email")
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json({ success: true, requests });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ── APPROVE a device ──────────────────────────────────────────────────
const approveDevice = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason, label } = req.body;

        const approval = await DeviceApproval.findById(id).populate("user", "name email");
        if (!approval) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }
        if (approval.status !== "pending") {
            return res.status(400).json({ success: false, message: "Request already actioned" });
        }

        // Generate unique device token
        const deviceToken = `dt_${uuidv4().replace(/-/g, "")}`;

        // Update approval record
        approval.status = "approved";
        approval.actionBy = req.user._id;
        approval.actionAt = new Date();
        approval.reason = reason || "";
        approval.deviceToken = deviceToken;
        await approval.save();

        // Add to user's approvedDevices
        await User.findByIdAndUpdate(approval.user._id, {
            $push: {
                approvedDevices: {
                    deviceToken,
                    deviceUUID: approval.deviceUUID,
                    productId: approval.productId,
                    hostname: approval.hostname,
                    os: approval.os,
                    label: label || approval.hostname || "Office PC",
                    approvedBy: req.user._id,
                    approvedAt: new Date(),
                    lastUsedAt: null,
                }
            }
        });

        // Notify employee with deviceToken so Electron can store it
        const io = req.app.get("io");
        io.to(`user_${approval.user._id}`).emit("device:approved", {
            deviceToken,
            approvalId: approval._id,
            message: "Your device has been approved. You can now punch in.",
        });

        // Also notify HR/managers
        await createNotification(
            io,
            approval.user._id.toString(),
            "Device Approved",
            `Your device has been approved by ${req.user.name}`,
            "device_approval",
            { approvalId: approval._id, deviceToken }
        );

        res.status(200).json({
            success: true,
            message: "Device approved",
            deviceToken,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ── REJECT a device ───────────────────────────────────────────────────
const rejectDevice = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const approval = await DeviceApproval.findById(id).populate("user", "name email");
        if (!approval) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }
        if (approval.status !== "pending") {
            return res.status(400).json({ success: false, message: "Request already actioned" });
        }

        approval.status = "rejected";
        approval.actionBy = req.user._id;
        approval.actionAt = new Date();
        approval.reason = reason || "";
        await approval.save();

        // Notify employee
        const io = req.app.get("io");
        io.to(`user_${approval.user._id}`).emit("device:rejected", {
            approvalId: approval._id,
            reason: reason || "",
            message: "Your device request was rejected. Contact HR.",
        });

        await createNotification(
            io,
            approval.user._id.toString(),
            "Device Request Rejected",
            `Your device request was rejected. Reason: ${reason || "No reason provided"}`,
            "device_approval",
            { approvalId: approval._id }
        );

        res.status(200).json({ success: true, message: "Device rejected" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ── REVOKE an approved device ─────────────────────────────────────────
const revokeDevice = async (req, res) => {
    try {
        const { userId, deviceToken } = req.body;

        await User.findByIdAndUpdate(userId, {
            $pull: { approvedDevices: { deviceToken } }
        });

        res.status(200).json({ success: true, message: "Device revoked" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ── GET approved devices for one employee ─────────────────────────────
const getEmployeeDevices = async (req, res) => {
    try {
        const user = await User.findById(req.params.userId)
            .select("name approvedDevices")
            .populate("approvedDevices.approvedBy", "name")
            .lean();

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        res.status(200).json({ success: true, devices: user.approvedDevices });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getAllRequests,
    approveDevice,
    rejectDevice,
    revokeDevice,
    getEmployeeDevices,
};