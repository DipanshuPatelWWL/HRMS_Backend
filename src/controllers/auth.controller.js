const User = require("../models/user.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

// ─────────────────────────────────────────────
//  PARSE DEVICE INFO FROM USER-AGENT
// ─────────────────────────────────────────────
const parseDeviceInfo = (userAgent = "") => {
    if (!userAgent) return "Unknown Device";
    if (/mobile/i.test(userAgent)) {
        if (/android/i.test(userAgent)) return "Android Mobile";
        if (/iphone/i.test(userAgent)) return "iPhone";
        return "Mobile Device";
    }
    if (/ipad/i.test(userAgent)) return "iPad";
    if (/windows/i.test(userAgent)) return "Windows PC";
    if (/macintosh|mac os/i.test(userAgent)) return "Mac";
    if (/linux/i.test(userAgent)) return "Linux PC";
    return "Desktop Browser";
};

// Returns { browser, browserVersion, os, osVersion, deviceType, engine }
const parseUserAgentDetails = (userAgent = "") => {
    if (!userAgent) return {};

    // ── Browser + version ──
    let browser = "Unknown Browser";
    let browserVersion = "";

    if (/Edg\//i.test(userAgent)) {
        browser = "Edge";
        browserVersion = (userAgent.match(/Edg\/([\d.]+)/) || [])[1] || "";
    } else if (/OPR\//i.test(userAgent) || /Opera/i.test(userAgent)) {
        browser = "Opera";
        browserVersion = (userAgent.match(/(?:OPR|Opera)\/([\d.]+)/) || [])[1] || "";
    } else if (/Firefox\//i.test(userAgent)) {
        browser = "Firefox";
        browserVersion = (userAgent.match(/Firefox\/([\d.]+)/) || [])[1] || "";
    } else if (/SamsungBrowser\//i.test(userAgent)) {
        browser = "Samsung Browser";
        browserVersion = (userAgent.match(/SamsungBrowser\/([\d.]+)/) || [])[1] || "";
    } else if (/Chrome\//i.test(userAgent) && !/Chromium/i.test(userAgent)) {
        browser = "Chrome";
        browserVersion = (userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || "";
    } else if (/Safari\//i.test(userAgent)) {
        browser = "Safari";
        browserVersion = (userAgent.match(/Version\/([\d.]+)/) || [])[1] || "";
    }

    // ── OS + version ──
    let os = "Unknown OS";
    let osVersion = "";

    if (/Windows NT/i.test(userAgent)) {
        os = "Windows";
        const ntMap = {
            "10.0": "11/10", "6.3": "8.1", "6.2": "8",
            "6.1": "7", "6.0": "Vista", "5.1": "XP",
        };
        const ntVer = (userAgent.match(/Windows NT ([\d.]+)/) || [])[1] || "";
        osVersion = ntMap[ntVer] || ntVer;
    } else if (/Android/i.test(userAgent)) {
        os = "Android";
        osVersion = (userAgent.match(/Android ([\d.]+)/) || [])[1] || "";
    } else if (/iPhone OS/i.test(userAgent)) {
        os = "iOS";
        osVersion = ((userAgent.match(/iPhone OS ([\d_]+)/) || [])[1] || "").replace(/_/g, ".");
    } else if (/iPad.*OS/i.test(userAgent)) {
        os = "iPadOS";
        osVersion = ((userAgent.match(/OS ([\d_]+)/) || [])[1] || "").replace(/_/g, ".");
    } else if (/Macintosh|Mac OS X/i.test(userAgent)) {
        os = "macOS";
        osVersion = ((userAgent.match(/Mac OS X ([\d_.]+)/) || [])[1] || "").replace(/_/g, ".");
    } else if (/Linux/i.test(userAgent)) {
        os = "Linux";
    }

    // ── Device type ──
    let deviceType = "Desktop";
    if (/mobile/i.test(userAgent) && !/ipad/i.test(userAgent)) deviceType = "Mobile";
    else if (/ipad|tablet/i.test(userAgent)) deviceType = "Tablet";

    // ── Engine ──
    let engine = "Unknown";
    if (/Gecko\/\d/i.test(userAgent) && /Firefox/i.test(userAgent)) engine = "Gecko";
    else if (/AppleWebKit/i.test(userAgent)) engine = "Blink/WebKit";
    else if (/Trident/i.test(userAgent)) engine = "Trident";

    // ── Platform ──
    const platform = /Win64|WOW64/i.test(userAgent) ? "Win64"
        : /Win32/i.test(userAgent) ? "Win32"
            : /arm/i.test(userAgent) ? "ARM"
                : "";

    return { browser, browserVersion, os, osVersion, deviceType, engine, platform };
};


const generateToken = (user, sessionId) => {
    return jwt.sign(
        {
            id: user._id,
            role: user.role,
            sessionId,
        },
        process.env.JWT_SECRET,
        { expiresIn: "15d" }
    );
};


const signup = async (req, res) => {
    try {
        const {
            name,
            email,
            password,
            employeeId,
            department,
        } = req.body;

        const existingUser = await User.findOne({
            $or: [{ email }, { employeeId }],
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "User already exists with email or employeeId",
            });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = await User.create({
            name,
            email,
            password: hashedPassword,
            employeeId,
            department: department,
            role: "employee"
        });

        const token = generateToken(user);

        res.status(201).json({
            success: true,
            message: "User registered successfully",
            token,
            user,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


const login = async (req, res) => {
    try {
        const { email, password, deviceUUID, productId, hostname, os } = req.body;

        const user = await User.findOne({ email }).select("+password");

        if (!user) {
            return res.status(400).json({
                success: false,
                message: "Invalid email or password",
            });
        }

        if (user.status !== "active") {
            return res.status(403).json({
                success: false,
                message: "Your account is inactive. Contact HR.",
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: "Invalid email or password",
            });
        }

        user.lastLogin = new Date();

        // Create a new session
        const sessionId = uuidv4();
        const userAgent = req.headers["user-agent"] || "";
        const ipAddress =
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
            req.socket?.remoteAddress ||
            "";

        const deviceInfo = parseDeviceInfo(userAgent);

        // Keep max 10 sessions (drop oldest first)
        if (user.sessions.length >= 10) {
            user.sessions.sort((a, b) => a.lastActive - b.lastActive);
            user.sessions.splice(0, user.sessions.length - 9);
        }

        user.sessions.push({
            sessionId,
            deviceInfo,
            ipAddress,
            userAgent,
            createdAt: new Date(),
            lastActive: new Date(),
        });

        await user.save();

        const token = generateToken(user, sessionId);

        // ── Device Token Logic ────────────────────────────────────────
        let deviceToken = null;
        let devicePending = false;
        let deviceApprovalId = null;

        if (deviceUUID || productId) {
            // Check if device already approved
            const matchedDevice = user.approvedDevices?.find(
                d => (productId && d.productId === productId) ||
                    (deviceUUID && d.deviceUUID === deviceUUID)
            );

            if (matchedDevice) {
                // Device approved — return existing token
                deviceToken = matchedDevice.deviceToken;
                // Update lastUsedAt
                await User.updateOne(
                    { _id: user._id, "approvedDevices.deviceToken": deviceToken },
                    { $set: { "approvedDevices.$.lastUsedAt": new Date() } }
                );
            } else {
                // New device — check if approval already pending
                const DeviceApproval = require("../models/deviceApproval.model");
                const existingRequest = await DeviceApproval.findOne({
                    user: user._id,
                    productId: productId || "",
                    status: "pending",
                });

                if (!existingRequest) {
                    // Create new approval request
                    const ipAddress = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
                        req.socket?.remoteAddress || "";
                    const userAgent = req.headers["user-agent"] || "";

                    const approval = await DeviceApproval.create({
                        user: user._id,
                        deviceUUID: deviceUUID || "",
                        productId: productId || "",
                        hostname: hostname || "",
                        os: os || "",
                        browser: parseDeviceInfo(userAgent),
                        ipAddress,
                        userAgent,
                        status: "pending",
                    });

                    deviceApprovalId = approval._id;

                    // Notify HR
                    const hrUsers = await User.find({
                        role: { $in: ["hr", "manager"] },
                        status: "active"
                    }).select("_id").lean();

                    const io = req.app?.get?.("io");
                    if (io) {
                        for (const hr of hrUsers) {
                            const { createNotification } = require("./notification.controller");
                            await createNotification(
                                io,
                                hr._id.toString(),
                                "New Device Approval Request",
                                `${user.name} is requesting access from a new device`,
                                "device_approval",
                                { userId: user._id, approvalId: approval._id }
                            );
                        }
                    }
                }

                devicePending = true;
            }
        }

        res.status(200).json({
            success: true,
            message: "Login successful",
            token,
            user,
            deviceToken,
            devicePending,
            deviceApprovalId,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

const getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select("-password");

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Refresh lastActive for current session
        if (req.user.sessionId) {
            await User.updateOne(
                { _id: user._id, "sessions.sessionId": req.user.sessionId },
                { $set: { "sessions.$.lastActive": new Date() } }
            );
        }

        res.json({ user });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

// ─────────────────────────────────────────────
//  GET ALL SESSIONS
// ─────────────────────────────────────────────
const getSessions = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select("sessions");
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        // Mark which session is current
        const sessions = user.sessions.map((s) => ({
            sessionId: s.sessionId,
            deviceInfo: s.deviceInfo,
            ipAddress: s.ipAddress,
            createdAt: s.createdAt,
            lastActive: s.lastActive,
            isCurrent: s.sessionId === req.user.sessionId,
        }));

        // Sort: current first, then most recent
        sessions.sort((a, b) => {
            if (a.isCurrent) return -1;
            if (b.isCurrent) return 1;
            return new Date(b.lastActive) - new Date(a.lastActive);
        });

        res.json({ success: true, sessions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  LOGOUT SPECIFIC SESSION
// ─────────────────────────────────────────────
const logoutSession = async (req, res) => {
    try {
        const { sessionId } = req.params;

        await User.updateOne(
            { _id: req.user.id },
            { $pull: { sessions: { sessionId } } }
        );

        res.json({ success: true, message: "Session logged out" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  LOGOUT ALL SESSIONS (except optionally current)
// ─────────────────────────────────────────────
const logoutAllSessions = async (req, res) => {
    try {
        const { keepCurrent } = req.body; // boolean

        if (keepCurrent && req.user.sessionId) {
            // Remove every session except the current one
            await User.updateOne(
                { _id: req.user.id },
                {
                    $pull: {
                        sessions: { sessionId: { $ne: req.user.sessionId } },
                    },
                }
            );
        } else {
            // Wipe all sessions
            await User.updateOne(
                { _id: req.user.id },
                { $set: { sessions: [] } }
            );
        }

        res.json({ success: true, message: "Sessions cleared" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    signup,
    login,
    getMe,
    getSessions,
    logoutSession,
    logoutAllSessions,
};