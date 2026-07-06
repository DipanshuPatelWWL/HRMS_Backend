const { v4: uuidv4 } = require("uuid");
const DeviceApproval = require("../models/deviceApproval.model");
const User = require("../models/user.model");
const { createNotification, broadcastNotification } = require("./notification.controller");

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

// ── EMPLOYEE: request approval for this device ─────────────────────────
const requestDeviceApproval = async (req, res) => {
    try {
        const userId = req.user._id;
        const { deviceUUID, productId, hostname, os, reason } = req.body || {};

        if (!deviceUUID && !productId) {
            return res.status(400).json({
                success: false,
                message: "Could not read this device's identity. Please try again from the desktop app.",
            });
        }

        // Already approved for this exact device?
        const alreadyApproved = await User.findOne({
            _id: userId,
            approvedDevices: {
                $elemMatch: {
                    deviceUUID: deviceUUID || "",
                    productId: productId || "",
                },
            },
        }).select("_id");

        if (alreadyApproved) {
            return res.status(400).json({
                success: false,
                message: "This device is already approved. Try punching in again.",
            });
        }

        // One pending request per user per device
        const existingPending = await DeviceApproval.findOne({
            user: userId,
            deviceUUID: deviceUUID || "",
            productId: productId || "",
            status: "pending",
        });

        if (existingPending) {
            return res.status(400).json({
                success: false,
                message: "You already have a pending approval request for this device.",
            });
        }

        const clientIP = (req.socket?.remoteAddress || "").replace(/^::ffff:/, "");

        const approval = await DeviceApproval.create({
            user: userId,
            deviceUUID: deviceUUID || "",
            productId: productId || "",
            hostname: hostname || "",
            os: os || "",
            userAgent: req.headers["user-agent"] || "",
            ipAddress: clientIP,
            reason: reason || "",
            status: "pending",
        });

        const io = req.app.get("io");
        await broadcastNotification(
            io,
            ["hr", "manager"],
            "Device Approval Request 🖥️",
            `${req.user.name} requested approval to punch in from a new device`,
            "device_approval",
            { approvalId: approval._id, userId }
        );

        res.status(201).json({
            success: true,
            message: "Request sent to HR. You'll be able to punch in once it's approved.",
            approval,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ── EMPLOYEE: check status of my own device requests ───────────────────
const getMyDeviceRequests = async (req, res) => {
    try {
        const requests = await DeviceApproval.find({ user: req.user._id })
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
    requestDeviceApproval,
    getMyDeviceRequests,
};