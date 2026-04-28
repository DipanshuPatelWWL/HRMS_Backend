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

const app = express();
const server = http.createServer(app);

// 🔧 Middleware
app.use(cors({
    origin: "*",
    credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));

// ⚡ SOCKET.IO SETUP
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

// 🔐 SOCKET AUTH
io.use((socket, next) => {
    try {
        const token = socket.handshake.auth?.token;

        if (!token) {
            return next(new Error("Unauthorized: No token"));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = decoded;
        next();
    } catch (err) {
        next(new Error("Unauthorized: Invalid token"));
    }
});

// 🎯 SOCKET CONNECTION
io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Auto join user room
    if (socket.user?.id) {
        socket.join(socket.user.id);
        console.log("User joined room:", socket.user.id);
    }

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

// ✅ EXPORT (IMPORTANT)
module.exports = { app, server };