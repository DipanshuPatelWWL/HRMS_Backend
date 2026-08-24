const express = require("express");
const rateLimit = require("express-rate-limit");
const geoip = require("geoip-lite");
const { UAParser } = require("ua-parser-js");

const User = require("../models/user.model");
const ScanLog = require("../models/ScanLog");
const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");
const recentScans = new Map();

const router = express.Router();

/* ── rate limiter: max 30 scans per IP per 15 min ── */
const publicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many requests. Please try again later." },
});



// GET /api/scan-logs/stats  — summary counts for the dashboard header
router.get(
    "/scan-logs/stats",
    protect,
    allowRoles("manager", "hr", "superadmin"),
    async (req, res) => {
        try {
            const [total, uniqueEmployees, deviceBreakdown, topCountries] = await Promise.all([
                ScanLog.countDocuments(),
                ScanLog.distinct("employeeId").then(ids => ids.length),
                ScanLog.aggregate([
                    { $group: { _id: "$device.deviceType", count: { $sum: 1 } } },
                    { $sort: { count: -1 } }
                ]),
                ScanLog.aggregate([
                    { $match: { "location.country": { $ne: null } } },
                    { $group: { _id: "$location.country", count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $limit: 5 }
                ]),
            ]);

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const scansToday = await ScanLog.countDocuments({ scannedAt: { $gte: today } });

            return res.json({
                success: true,
                stats: { total, uniqueEmployees, scansToday, deviceBreakdown, topCountries },
            });
        } catch (err) {
            return res.status(500).json({ success: false, message: "Server error." });
        }
    }
);



router.get("/public/employee/:employeeId", publicLimiter, async (req, res) => {
    try {
        const user = await User.findOne({
            employeeId: req.params.employeeId,
            status: "active",
        }).select("name designation department avatar role status employeeId");

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Employee not found or no longer active.",
            });
        }

        /* ── log the scan (non-blocking) ── */
        setImmediate(async () => {
            try {
                const rawIp =
                    req.headers["x-forwarded-for"]?.split(",")[0] ||
                    req.headers["x-real-ip"] ||
                    req.socket?.remoteAddress ||
                    "";
                let ip = rawIp.trim().replace("::ffff:", "");
                if (ip === "::1" || ip === "127.0.0.1") ip = "localhost";

                // ── Dedupe: same ip + employeeId within 5 seconds = skip ──
                const dedupeKey = `${ip}:${user.employeeId}`;
                const lastScan = recentScans.get(dedupeKey);
                if (lastScan && Date.now() - lastScan < 5000) {
                    return;
                }
                recentScans.set(dedupeKey, Date.now());

                // Clean up old entries to prevent memory leak
                if (recentScans.size > 500) {
                    const cutoff = Date.now() - 10000;
                    for (const [key, ts] of recentScans.entries()) {
                        if (ts < cutoff) recentScans.delete(key);
                    }
                }

                const geo = ip !== "localhost" ? geoip.lookup(ip) : null;
                const parser = new UAParser(req.headers["user-agent"] || "");
                const ua = parser.getResult();

                await ScanLog.create({
                    employeeId: user.employeeId,
                    employeeName: user.name,
                    ip,
                    location: geo ? {
                        country: geo.country || null,
                        region: geo.region || null,
                        city: geo.city || null,
                        timezone: geo.timezone || null,
                        ll: geo.ll || [],
                    } : null,
                    device: {
                        browser: ua.browser.name || null,
                        browserVersion: ua.browser.version || null,
                        os: ua.os.name || null,
                        osVersion: ua.os.version || null,
                        deviceType: ua.device.type || "desktop",
                        deviceVendor: ua.device.vendor || null,
                        deviceModel: ua.device.model || null,
                        userAgent: req.headers["user-agent"] || null,
                    },
                });
            } catch (logErr) {
                console.warn("[ScanLog] failed:", logErr.message);
            }
        });

        return res.json({ success: true, employee: user });
    } catch (err) {
        console.error("[PublicProfile] error:", err);
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

/* PROTECTED — GET /api/scan-logs */
router.get(
    "/scan-logs",
    protect,
    allowRoles("manager", "hr", "superadmin"),
    async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const skip = (page - 1) * limit;

            const query = {};

            if (req.query.employeeId) {
                query.employeeId = req.query.employeeId;
            }
            if (req.query.deviceType) {
                query["device.deviceType"] = req.query.deviceType;
            }
            if (req.query.search) {
                const s = req.query.search;
                query.$or = [
                    { employeeName: { $regex: s, $options: "i" } },
                    { employeeId: { $regex: s, $options: "i" } },
                    { ip: { $regex: s, $options: "i" } },
                    { "location.city": { $regex: s, $options: "i" } },
                    { "location.country": { $regex: s, $options: "i" } },
                    { "device.browser": { $regex: s, $options: "i" } },
                    { "device.os": { $regex: s, $options: "i" } },
                ];
            }

            const [logs, total] = await Promise.all([
                ScanLog.find(query).sort({ scannedAt: -1 }).skip(skip).limit(limit),
                ScanLog.countDocuments(query),
            ]);

            return res.json({
                success: true,
                logs,
                total,
                page,
                pages: Math.ceil(total / limit),
            });
        } catch (err) {
            return res.status(500).json({ success: false, message: "Server error." });
        }
    }
);

/* PROTECTED — GET /api/scan-logs/:employeeId */
router.get(
    "/scan-logs/:employeeId",
    protect,
    allowRoles("manager", "hr", "superadmin"),
    async (req, res) => {
        try {
            const logs = await ScanLog.find({ employeeId: req.params.employeeId })
                .sort({ scannedAt: -1 })
                .limit(100);

            return res.json({ success: true, logs, total: logs.length });
        } catch (err) {
            return res.status(500).json({ success: false, message: "Server error." });
        }
    }
);

/* PROTECTED — DELETE /api/scan-logs/:id */
router.delete(
    "/scan-logs/:id",
    protect,
    allowRoles("manager", "hr", "superadmin"),
    async (req, res) => {
        try {
            await ScanLog.findByIdAndDelete(req.params.id);
            return res.json({ success: true, message: "Log deleted." });
        } catch (err) {
            return res.status(500).json({ success: false, message: "Server error." });
        }
    }
);




module.exports = router;