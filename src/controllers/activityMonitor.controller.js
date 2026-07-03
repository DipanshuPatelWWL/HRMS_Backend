const mongoose = require("mongoose");
const moment = require("moment-timezone");
const ActivityLog = require("../models/activityLog.model");
const Attendance = require("../models/attendance.model");
const User = require("../models/user.model");
const CaptureRequest = require("../models/captureRequest.model");

// ─────────────────────────────────────────────
//  APP CLASSIFICATION LISTS
// ─────────────────────────────────────────────

const PRODUCTIVE_APPS = [
    "code.exe", "cursor.exe", "webstorm64.exe", "devenv.exe",
    "excel.exe", "winword.exe", "powerpnt.exe", "outlook.exe",
    "figma.exe", "photoshop.exe", "illustrator.exe",
    "postman.exe", "insomnia.exe",
    "dbeaver.exe", "mongodb compass.exe",
    "cmd.exe", "powershell.exe", "windowsterminal.exe",
];

const UNPRODUCTIVE_APPS = [
    "whatsapp.exe", "telegram.exe", "discord.exe",
    "spotify.exe", "vlc.exe", "mpc-hc64.exe",
    "steam.exe", "epicgameslauncher.exe",
];

const BROWSER_APPS = [
    "chrome.exe", "msedge.exe", "firefox.exe",
    "brave.exe", "opera.exe", "vivaldi.exe",
];

const PRODUCTIVE_BROWSER_KEYWORDS = [
    "github", "gitlab", "stackoverflow", "jira", "confluence",
    "figma", "notion", "google docs", "google sheets", "google slides",
    "trello", "linear", "vercel", "netlify", "aws", "azure",
    "postman", "swagger", "mongodb", "firebase",
];

const UNPRODUCTIVE_BROWSER_KEYWORDS = [
    "youtube", "netflix", "prime video", "hotstar", "instagram",
    "facebook", "twitter", "reddit", "9gag", "tiktok", "snapchat",
];

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

const classifyApp = (appName = "", windowTitle = "") => {
    const app = appName.toLowerCase();
    const title = windowTitle.toLowerCase();

    const isBrowser = BROWSER_APPS.some((b) => app.includes(b));
    const isIncognito =
        title.includes("incognito") || title.includes("inprivate");

    let category = "neutral";

    if (isBrowser) {
        category = "browser";
        if (PRODUCTIVE_BROWSER_KEYWORDS.some((k) => title.includes(k))) {
            category = "productive";
        } else if (UNPRODUCTIVE_BROWSER_KEYWORDS.some((k) => title.includes(k))) {
            category = "unproductive";
        }
    } else if (PRODUCTIVE_APPS.some((p) => app.includes(p))) {
        category = "productive";
    } else if (UNPRODUCTIVE_APPS.some((u) => app.includes(u))) {
        category = "unproductive";
    }

    return { isBrowser, isIncognito, category };
};

const formatDuration = (seconds = 0) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
};

const buildEmptySummary = () => ({
    totalTrackedSeconds: 0,
    totalTrackedFormatted: "0s",
    productiveSeconds: 0,
    productiveFormatted: "0s",
    unproductiveSeconds: 0,
    unproductiveFormatted: "0s",
    neutralSeconds: 0,
    browserSeconds: 0,
    browserFormatted: "0s",
    incognitoSeconds: 0,
    incognitoFormatted: "0s",
    productivityScore: 0,
});

const buildSummary = (logs) => {
    let totalTrackedSeconds = 0;
    let productiveSeconds = 0;
    let unproductiveSeconds = 0;
    let neutralSeconds = 0;
    let browserSeconds = 0;
    let incognitoSeconds = 0;

    logs.forEach((log) => {
        const d = log.duration || 0;
        totalTrackedSeconds += d;
        if (log.isIncognito) incognitoSeconds += d;
        switch (log.category) {
            case "productive": productiveSeconds += d; break;
            case "unproductive": unproductiveSeconds += d; break;
            case "browser": browserSeconds += d; break;
            default: neutralSeconds += d;
        }
    });

    const productivityScore =
        totalTrackedSeconds > 0
            ? Math.round((productiveSeconds / totalTrackedSeconds) * 100)
            : 0;

    return {
        totalTrackedSeconds,
        totalTrackedFormatted: formatDuration(totalTrackedSeconds),
        productiveSeconds,
        productiveFormatted: formatDuration(productiveSeconds),
        unproductiveSeconds,
        unproductiveFormatted: formatDuration(unproductiveSeconds),
        neutralSeconds,
        browserSeconds,
        browserFormatted: formatDuration(browserSeconds),
        incognitoSeconds,
        incognitoFormatted: formatDuration(incognitoSeconds),
        productivityScore,
    };
};

const buildTimeline = (logs) =>
    logs.map((log) => ({
        appName: log.appName,
        windowTitle: log.windowTitle,
        startTime: log.startTime,
        endTime: log.endTime,
        duration: log.duration,
        durationFormatted: formatDuration(log.duration),
        category: log.category,
        isIncognito: log.isIncognito,
    }));

const buildAppBreakdown = (logs) => {
    const map = {};
    logs.forEach((log) => {
        const key = log.appName;
        if (!map[key]) {
            map[key] = {
                appName: key,
                totalDuration: 0,
                category: log.category,
                isBrowser: log.isBrowser,
                sessions: 0,
            };
        }
        map[key].totalDuration += log.duration || 0;
        map[key].sessions += 1;
    });

    return Object.values(map)
        .sort((a, b) => b.totalDuration - a.totalDuration)
        .map((item) => ({
            ...item,
            totalDurationFormatted: formatDuration(item.totalDuration),
        }));
};

const buildBrowserActivity = (logs) => {
    const browserLogs = logs.filter((l) => l.isBrowser);
    const map = {};
    browserLogs.forEach((log) => {
        const key = log.windowTitle || "Unknown Tab";
        if (!map[key]) {
            map[key] = {
                windowTitle: key,
                appName: log.appName,
                totalDuration: 0,
                category: log.category,
                isIncognito: log.isIncognito,
                sessions: 0,
            };
        }
        map[key].totalDuration += log.duration || 0;
        map[key].sessions += 1;
    });

    return Object.values(map)
        .sort((a, b) => b.totalDuration - a.totalDuration)
        .map((item) => ({
            ...item,
            totalDurationFormatted: formatDuration(item.totalDuration),
        }));
};



// ─────────────────────────────────────────────
//  ROLLING 3-DAY CLEANUP HELPER
//  Keeps only the 3 most recent dateStrings for a user.
//  Called after every logActivity insert.
// ─────────────────────────────────────────────
const purgeOldActivity = async (userId) => {
    const distinct = await ActivityLog.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(userId) } },
        { $group: { _id: "$dateString" } },
        { $sort: { _id: -1 } },
    ]);

    if (distinct.length <= 3) return;

    const keepDates = distinct.slice(0, 3).map((d) => d._id);

    await ActivityLog.deleteMany({
        user: new mongoose.Types.ObjectId(userId),
        dateString: { $nin: keepDates },
    });
};



// ─────────────────────────────────────────────
//  LOG ACTIVITY  — called by Electron agent
//  POST /api/activity-monitor/log
// ─────────────────────────────────────────────
const logActivity = async (req, res) => {
    try {
        const userId = req.user._id;

        // Electron sends array of chunks OR single object — normalise to array
        const rawLogs = Array.isArray(req.body.logs)
            ? req.body.logs
            : [req.body];

        if (!rawLogs.length) {
            return res.status(400).json({
                success: false,
                message: "No activity logs provided",
            });
        }

        // Verify employee is currently punched in
        const nowIST = moment().tz("Asia/Kolkata");
        const todayString = nowIST.format("YYYY-MM-DD");

        const todayAttendance = await Attendance.findOne({
            user: userId,
            dateString: todayString,
            punchOut: null,
        });

        if (!todayAttendance) {
            return res.status(403).json({
                success: false,
                message: "Tracking allowed only during active punch-in session",
            });
        }

        // Build and insert docs
        const docs = rawLogs.map((log) => {
            const { isBrowser, isIncognito, category } = classifyApp(
                log.appName,
                log.windowTitle
            );

            const startTime = log.startTime ? new Date(log.startTime) : new Date();
            const endTime = log.endTime ? new Date(log.endTime) : null;
            const duration =
                log.duration ||
                (endTime ? Math.round((endTime - startTime) / 1000) : 0);

            return {
                user: userId,
                attendanceId: todayAttendance._id,
                dateString: todayString,
                appName: log.appName,
                windowTitle: log.windowTitle || "",
                startTime,
                endTime,
                duration,
                category,
                isBrowser,
                isIncognito,
                source: "desktop-agent",
            };
        });

        await ActivityLog.insertMany(docs, { ordered: false });

        await purgeOldActivity(userId);

        // Emit live update to hr_room via Socket.IO
        const io = req.app.get("io");
        if (io && docs.length > 0) {
            const latest = docs[docs.length - 1];
            io.to("hr_room").emit("activity:live", {
                userId,
                appName: latest.appName,
                windowTitle: latest.windowTitle,
                category: latest.category,
                isIncognito: latest.isIncognito,
                timestamp: latest.startTime,
            });
        }

        return res.status(201).json({
            success: true,
            message: `${docs.length} log(s) saved`,
        });
    } catch (error) {
        console.error("logActivity Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET DAILY REPORT  — Admin / HR
//  GET /api/activity-monitor/report/:userId?date=YYYY-MM-DD
// ─────────────────────────────────────────────
const getDailyReport = async (req, res) => {
    try {
        const { userId } = req.params;
        const dateString =
            req.query.date || moment().tz("Asia/Kolkata").format("YYYY-MM-DD");

        const logs = await ActivityLog.find({
            user: userId,
            dateString,
        }).sort({ startTime: 1 });

        if (!logs.length) {
            return res.status(200).json({
                success: true,
                dateString,
                summary: buildEmptySummary(),
                timeline: [],
                appBreakdown: [],
                browserActivity: [],
                incognitoSessions: [],
            });
        }

        const summary = buildSummary(logs);
        const timeline = buildTimeline(logs);
        const appBreakdown = buildAppBreakdown(logs);
        const browserActivity = buildBrowserActivity(logs);
        const incognitoSessions = logs
            .filter((l) => l.isIncognito)
            .map((l) => ({
                windowTitle: l.windowTitle,
                startTime: l.startTime,
                endTime: l.endTime,
                duration: l.duration,
                durationFormatted: formatDuration(l.duration),
            }));

        return res.status(200).json({
            success: true,
            dateString,
            summary,
            timeline,
            appBreakdown,
            browserActivity,
            incognitoSessions,
        });
    } catch (error) {
        console.error("getDailyReport Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET LIVE STATUS  — Admin / HR
//  GET /api/activity-monitor/live
//  Returns latest activity for all punched-in employees today
// ─────────────────────────────────────────────
const getLiveStatus = async (req, res) => {
    try {
        const todayString = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");

        const activeSessions = await Attendance.find({
            dateString: todayString,
            punchOut: null,
        }).populate("user", "name employeeId department designation avatar");

        if (!activeSessions.length) {
            return res.status(200).json({ success: true, data: [] });
        }

        const userIds = activeSessions.map((a) => a.user._id);

        // No activity in last 5 min = idle
        const fiveMinutesAgo = moment()
            .tz("Asia/Kolkata")
            .subtract(5, "minutes")
            .toDate();

        // Latest log per user via aggregation
        const latestLogs = await ActivityLog.aggregate([
            {
                $match: {
                    user: { $in: userIds },
                    dateString: todayString,
                    startTime: { $gte: fiveMinutesAgo },
                },
            },
            { $sort: { startTime: -1 } },
            {
                $group: {
                    _id: "$user",
                    appName: { $first: "$appName" },
                    windowTitle: { $first: "$windowTitle" },
                    category: { $first: "$category" },
                    isIncognito: { $first: "$isIncognito" },
                    lastSeen: { $first: "$startTime" },
                },
            },
        ]);

        const logMap = {};
        latestLogs.forEach((l) => {
            logMap[l._id.toString()] = l;
        });

        const data = activeSessions.map((session) => {
            const uid = session.user._id.toString();
            const liveLog = logMap[uid] || null;

            return {
                user: session.user,
                punchIn: session.punchIn,
                currentApp: liveLog?.appName || null,
                windowTitle: liveLog?.windowTitle || null,
                category: liveLog?.category || null,
                isIncognito: liveLog?.isIncognito || false,
                lastSeen: liveLog?.lastSeen || null,
                isIdle: !liveLog,
            };
        });

        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error("getLiveStatus Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET APP USAGE BREAKDOWN  — Admin / HR
//  GET /api/activity-monitor/app-usage/:userId?date=YYYY-MM-DD
// ─────────────────────────────────────────────
const getAppUsage = async (req, res) => {
    try {
        const { userId } = req.params;
        const dateString =
            req.query.date || moment().tz("Asia/Kolkata").format("YYYY-MM-DD");

        const breakdown = await ActivityLog.aggregate([
            {
                $match: {
                    user: new mongoose.Types.ObjectId(userId),
                    dateString,
                },
            },
            {
                $group: {
                    _id: "$appName",
                    totalDuration: { $sum: "$duration" },
                    category: { $first: "$category" },
                    isBrowser: { $first: "$isBrowser" },
                    sessions: { $sum: 1 },
                },
            },
            { $sort: { totalDuration: -1 } },
        ]);

        const formatted = breakdown.map((b) => ({
            appName: b._id,
            totalDuration: b.totalDuration,
            totalDurationFormatted: formatDuration(b.totalDuration),
            category: b.category,
            isBrowser: b.isBrowser,
            sessions: b.sessions,
        }));

        return res.status(200).json({
            success: true,
            dateString,
            data: formatted,
        });
    } catch (error) {
        console.error("getAppUsage Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET MY OWN ACTIVITY  — Employee
//  GET /api/activity-monitor/my-activity?date=YYYY-MM-DD
// ─────────────────────────────────────────────
const getMyActivity = async (req, res) => {
    try {
        const userId = req.user._id;
        const dateString =
            req.query.date || moment().tz("Asia/Kolkata").format("YYYY-MM-DD");

        const logs = await ActivityLog.find({
            user: userId,
            dateString,
        }).sort({ startTime: 1 });

        const summary = logs.length ? buildSummary(logs) : buildEmptySummary();
        const appBreakdown = buildAppBreakdown(logs);

        return res.status(200).json({
            success: true,
            dateString,
            summary,
            appBreakdown,
        });
    } catch (error) {
        console.error("getMyActivity Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  GET APP + WINDOW TITLE GROUPED REPORT
//  GET /api/activity-monitor/app-detail/:userId?date=YYYY-MM-DD
// ─────────────────────────────────────────────
const getAppDetailReport = async (req, res) => {
    try {
        const { userId } = req.params;
        const dateString =
            req.query.date || moment().tz("Asia/Kolkata").format("YYYY-MM-DD");

        const logs = await ActivityLog.find({
            user: userId,
            dateString,
        })
            .select(
                "appName windowTitle duration category isBrowser isIncognito startTime endTime"
            )
            .lean()
            .sort({ startTime: 1 });

        if (!logs.length) {
            return res.status(200).json({ success: true, dateString, data: [] });
        }

        // Group by appName → then by windowTitle
        const appMap = {};

        logs.forEach((log) => {
            const app = log.appName;
            const title = log.windowTitle || "Unknown";
            const d = log.duration || 0;

            if (!appMap[app]) {
                appMap[app] = {
                    appName: app,
                    category: log.category,
                    isBrowser: log.isBrowser,
                    totalDuration: 0,
                    titles: {},
                };
            }

            appMap[app].totalDuration += d;

            if (!appMap[app].titles[title]) {
                appMap[app].titles[title] = {
                    windowTitle: title,
                    totalDuration: 0,
                    isIncognito: log.isIncognito,
                    category: log.category,
                    visits: 0,
                    firstSeen: log.startTime,
                    lastSeen: log.endTime,
                };
            }

            appMap[app].titles[title].totalDuration += d;
            appMap[app].titles[title].visits += 1;
            if (log.startTime < appMap[app].titles[title].firstSeen) {
                appMap[app].titles[title].firstSeen = log.startTime;
            }
            if (log.endTime > appMap[app].titles[title].lastSeen) {
                appMap[app].titles[title].lastSeen = log.endTime;
            }
        });

        // Convert to sorted array
        const data = Object.values(appMap)
            .sort((a, b) => b.totalDuration - a.totalDuration)
            .map((app) => ({
                appName: app.appName,
                category: app.category,
                isBrowser: app.isBrowser,
                totalDuration: app.totalDuration,
                totalDurationFormatted: formatDuration(app.totalDuration),
                titles: Object.values(app.titles)
                    .sort((a, b) => b.totalDuration - a.totalDuration)
                    .map((t) => ({
                        windowTitle: t.windowTitle,
                        totalDuration: t.totalDuration,
                        totalDurationFormatted: formatDuration(t.totalDuration),
                        isIncognito: t.isIncognito,
                        category: t.category,
                        visits: t.visits,
                        firstSeen: t.firstSeen,
                        lastSeen: t.lastSeen,
                    })),
            }));

        return res.status(200).json({ success: true, dateString, data });
    } catch (error) {
        console.error("getAppDetailReport Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  HR TRIGGERS CAPTURE
//  POST /api/activity-monitor/capture-request/:userId
// ─────────────────────────────────────────────
const requestCapture = async (req, res) => {
    try {
        const { userId } = req.params;
        const hrId = req.user._id;
        // Create a pending capture record
        const capture = await CaptureRequest.create({
            requestedBy: hrId,
            employee: userId,
            status: "pending",
        });

        const io = req.app.get("io");
        if (io) {
            // Emit to both room formats to ensure agent receives it
            io.to(`user_${userId}`).emit("capture:request", {
                captureId: capture._id.toString(),
            });
            io.to(userId.toString()).emit("capture:request", {
                captureId: capture._id.toString(),
            });
        }

        return res.status(200).json({
            success: true,
            message: "Capture request sent",
            captureId: capture._id,
        });
    } catch (error) {
        console.error("requestCapture Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  ELECTRON UPLOADS CAPTURED IMAGES
//  POST /api/activity-monitor/capture-upload
// ─────────────────────────────────────────────
const uploadCapture = async (req, res) => {
    try {
        const { captureId, screenshot, status } = req.body;

        if (!captureId) {
            return res.status(400).json({ success: false, message: "captureId required" });
        }

        // Agent can explicitly signal failure
        const resolvedStatus = status === "failed" ? "failed" : "completed";

        const capture = await CaptureRequest.findByIdAndUpdate(
            captureId,
            {
                screenshot: screenshot || null,
                status: resolvedStatus,
                completedAt: new Date(),
            },
            { new: true }
        );

        if (!capture) {
            return res.status(404).json({ success: false, message: "Capture not found" });
        }

        const io = req.app.get("io");
        if (io) {
            io.to("hr_room").emit("capture:done", {
                captureId: capture._id.toString(),
                employeeId: capture.employee.toString(),
                screenshot: capture.screenshot,
                completedAt: capture.completedAt,
                status: resolvedStatus,   // ← HR frontend can show "failed" state
            });
        }

        return res.status(200).json({ success: true, message: "Capture saved", status: resolvedStatus });
    } catch (error) {
        console.error("uploadCapture Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET CAPTURE HISTORY FOR AN EMPLOYEE
//  GET /api/activity-monitor/captures/:userId
// ─────────────────────────────────────────────
const getCaptureHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        const captures = await CaptureRequest.find({ employee: userId })
            .sort({ requestedAt: -1 })
            .limit(20)
            .populate("requestedBy", "name");

        return res.status(200).json({ success: true, data: captures });
    } catch (error) {
        console.error("getCaptureHistory Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    logActivity,
    getDailyReport,
    getLiveStatus,
    getAppUsage,
    getMyActivity,
    getAppDetailReport,
    requestCapture,
    uploadCapture,
    getCaptureHistory,
    purgeOldActivity
};