require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { Server } = require("socket.io");

// Routes
const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const attendanceRoutes = require("./routes/attendance.routes");
const leaveRoutes = require("./routes/leave.routes");
const payrollRoutes = require("./routes/payroll.routes");
const payrollSettingsRoutes = require("./routes/payrollSettings.routes");
const notificationRoutes = require("./routes/notification.routes");
const taskRoutes = require("./routes/task.routes");
const ticketRoutes = require("./routes/ticket.routes");
const announcementRoutes = require("./routes/announcement.routes");
const holidayRoutes = require("./routes/holiday.routes");
const salaryRoutes = require("./routes/salary.routes");
const correctionRoutes = require("./routes/attendanceCorrection.routes");
const PublicRoutes = require("./routes/publicRoutes");
const SalesReportRoutes = require("./routes/sales.report.routes");
const celebrationRoutes = require("./routes/celebration.routes");
const celebrationTemplateRoutes = require("./routes/celebrationTemplate.routes");
const DailyReportRoutes = require("./routes/dailyReports.routes");
const reportRoutes = require("./routes/report.routes");
const AssetsRoutes = require("./routes/assetRoutes");
const PolicyRoutes = require("./routes/policy.routes");
const deviceApprovalRoutes = require("./routes/deviceApproval.route");
const isProd = process.env.NODE_ENV === "production";

//python advance sales
const salesIntelligenceRoutes = require("./routes/salesIntelligence.routes");
const followUpRoutes = require("./routes/followUp.routes");

//tracker router ------------------------
const activityMonitorRoutes = require("./routes/activityMonitor.routes");

const ALLOWED_ORIGINS = isProd
    ? [
        "https://wwlhrms.digitalwebguider.com",
        "https://hrmsback.digitalwebguider.com",
    ]
    : [
        "http://localhost:5173",
        "http://localhost:5174"
    ];

const app = express();
const server = http.createServer(app);

// 🔐 SECURITY HEADERS & RATE LIMITING
app.use(helmet());
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Too many attempts, please try again after 15 minutes",
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);

if (isProd) {
    app.set("trust proxy", "127.0.0.1");
} else {
    app.set("trust proxy", true);
}

// 🔧 Middleware
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true,
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ limit: "1mb", extended: true }));

app.use((req, res, next) => {
    res.setHeader("Connection", "keep-alive");
    next();
});
app.use("/uploads", express.static("uploads"));
app.use("/updates", express.static("updates"));

const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            if (!origin || ALLOWED_ORIGINS.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error("Not allowed by CORS"));
            }
        },
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        credentials: true,
    },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 50 * 1024 * 1024,
});

// 🔐 SOCKET AUTH
io.use((socket, next) => {
    try {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error("Unauthorized: No token"));
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = decoded;
        next();
    } catch (err) {
        next(new Error("Unauthorized: Invalid token"));
    }
});

io.on("connection", (socket) => {
    const uid = socket.user?.id || socket.user?._id || socket.user?.userId;
    if (uid) {
        const uidStr = uid.toString();
        socket.join(`user_${uidStr}`);
        socket.join(uidStr);
    }

    const allowedRoles = ["hr", "admin", "manager", "superadmin"];
    if (allowedRoles.includes(socket.user?.role)) {
        socket.join("hr_room");
    }

    socket.on("join:hr_room", () => {
        if (allowedRoles.includes(socket.user?.role)) {
            socket.join("hr_room");
        } else {
            socket.emit("error", { message: "Unauthorized: HR role required" });
        }
    });

    socket.on("join:user_room", (data) => {
        const targetUserId = (typeof data === "object" ? data?.userId : data)?.toString();
        if (!targetUserId) return;
        const isSelf = targetUserId === (socket.user?.id || socket.user?._id || socket.user?.userId)?.toString();
        const isAdmin = allowedRoles.includes(socket.user?.role);
        if (isSelf || isAdmin) {
            socket.join(`user_${targetUserId}`);
            socket.join(targetUserId);
        } else {
            socket.emit("error", { message: "Unauthorized to join this user room" });
        }
    });

    socket.on("stream:request", ({ targetUserId }) => {
        if (!allowedRoles.includes(socket.user?.role)) {
            return socket.emit("error", { message: "Unauthorized: Stream request denied" });
        }
        const streamId = `${targetUserId}_${Date.now()}`;
        io.to(`user_${targetUserId}`).emit("stream:start", { streamId });
        socket.emit("stream:started", { streamId, targetUserId });
    });

    socket.on("stream:stop_request", ({ targetUserId }) => {
        if (!allowedRoles.includes(socket.user?.role)) return;
        io.to(`user_${targetUserId}`).emit("stream:stop");
    });

    socket.on("stream:frame", (data) => {
        if (socket.user) {
            io.to("hr_room").emit("stream:frame", data);
        }
    });

    socket.on("disconnect", () => { });
});

app.set("io", io);

app.get("/", (req, res) => {
    res.send("Employee Management API Running...");
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/leave", leaveRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/settings/payroll", payrollSettingsRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/holidays", holidayRoutes);
app.use("/api/salary", salaryRoutes);
app.use("/api/attendance-corrections", correctionRoutes);
app.use("/api", PublicRoutes);
app.use("/api", SalesReportRoutes);
app.use("/api/celebrations", celebrationRoutes);
app.use("/api/celebrationTemplate", celebrationTemplateRoutes);
app.use("/api", DailyReportRoutes);
app.use("/api/assets", AssetsRoutes);
app.use("/api/policies", PolicyRoutes);
app.use("/api/activity-monitor", activityMonitorRoutes);
app.use("/api/intelligence", salesIntelligenceRoutes);
app.use("/api/intelligence/follow-ups", followUpRoutes);
app.use("/api/device-approvals", deviceApprovalRoutes);

module.exports = { app, server };