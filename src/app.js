require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const jwt = require("jsonwebtoken");

const { Server } = require("socket.io");

// Routes
const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const attendanceRoutes = require("./routes/attendance.routes");
const leaveRoutes = require("./routes/leave.routes");
const payrollRoutes = require("./routes/payroll.routes");
const reportRoutes = require("./routes/report.routes");
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
const AIRoutes = require("./routes/ai.routes");
const HRAIRoutes = require("./routes/hr.ai.routes");
const DailyReportRoutes = require("./routes/dailyReports.routes");
const AssetsRoutes = require("./routes/assetRoutes");
const PolicyRoutes = require("./routes/policy.routes");
const isProd = process.env.NODE_ENV === "production";

//tracker router ------------------------
const activityMonitorRoutes = require("./routes/activityMonitor.routes");

const ALLOWED_ORIGINS = isProd
    ? [
        "https://wwlhrms.digitalwebguider.com",
        "https://hrmsback.digitalwebguider.com",
    ]
    : [
        "http://localhost:5173",
        "http://localhost:5174",
    ];

const app = express();
const server = http.createServer(app);
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

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use((req, res, next) => {
    res.setHeader("Connection", "keep-alive");
    next();
});
app.use("/uploads", express.static("uploads"));

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
    maxHttpBufferSize: 50 * 1024 * 1024,  // ← allow large screenshot payloads via socket
});

// 🔐 SOCKET AUTH
io.use((socket, next) => {
    try {
        const token = socket.handshake.auth?.token;

        if (!token) {
            console.log("Socket rejected: No token");
            return next(new Error("Unauthorized: No token"));
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = decoded;
        next();
    } catch (err) {
        next(new Error("Unauthorized: Invalid token"));
    }
});

io.on("connection", (socket) => {
    console.log("User connected:", socket.id, "| JWT payload:", JSON.stringify(socket.user));

    // Auto-join from JWT — covers every field name your JWT might use
    const uid = socket.user?.id || socket.user?._id || socket.user?.userId;
    if (uid) {
        const uidStr = uid.toString();
        socket.join(`user_${uidStr}`);   // primary room used by requestCapture
        socket.join(uidStr);             // fallback room
        console.log(`Auto-joined user_${uidStr} and ${uidStr}`);
    }

    const allowedRoles = ["hr", "admin", "manager", "superadmin"];
    if (allowedRoles.includes(socket.user?.role)) {
        socket.join("hr_room");
        console.log(`Socket ${socket.id} joined hr_room`);
    }

    socket.on("join:hr_room", () => {
        socket.join("hr_room");
        console.log(`Socket ${socket.id} joined hr_room manually`);
    });

    // Handle both: { userId: "abc" } object AND plain "abc" string
    socket.on("join:user_room", (data) => {
        const userId = (typeof data === "object" ? data?.userId : data)?.toString();
        if (!userId) return;
        socket.join(`user_${userId}`);
        socket.join(userId);
        console.log(`Socket ${socket.id} manually joined user_${userId} and ${userId}`);
    });

    // Handle plain socket.emit("join", "user_abc") from agent
    socket.on("join", (room) => {
        if (typeof room === "string" && room.length < 100) {
            socket.join(room);
            console.log(`Socket ${socket.id} joined room: ${room}`);
        }
    });

    // HR starts watching an employee's live stream
    socket.on("stream:request", ({ targetUserId }) => {
        const streamId = `${targetUserId}_${Date.now()}`;
        // Tell the employee's Electron app to start streaming
        io.to(`user_${targetUserId}`).emit("stream:start", { streamId });
        io.to(targetUserId.toString()).emit("stream:start", { streamId });
        // Confirm to HR with the streamId so they can match frames
        socket.emit("stream:started", { streamId, targetUserId });
        console.log(`Stream started: ${streamId}`);
    });

    // HR stops watching
    socket.on("stream:stop_request", ({ targetUserId }) => {
        io.to(`user_${targetUserId}`).emit("stream:stop");
        io.to(targetUserId.toString()).emit("stream:stop");
        console.log(`Stream stopped for user: ${targetUserId}`);
    });

    // Employee Electron app forwards frame → relay to hr_room
    socket.on("stream:frame", (data) => {
        io.to("hr_room").emit("stream:frame", data);
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
});

// Make io available in controllers
app.set("io", io);

// 🌐 ROUTES
app.get("/", (req, res) => {
    res.send("Employee Management API Running...");
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/leave", leaveRoutes);
app.use("/api/payroll", payrollRoutes);
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
app.use("/api/ai", AIRoutes);
app.use("/api/hr-ai", HRAIRoutes);
app.use("/api", DailyReportRoutes);
app.use("/api/assets", AssetsRoutes);
app.use("/api/policies", PolicyRoutes);

// -------------------------tracker route ------------------------------------
app.use("/api/activity-monitor", activityMonitorRoutes);

// ✅ EXPORT (IMPORTANT)
module.exports = { app, server };