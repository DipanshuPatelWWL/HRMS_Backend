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


const app = express();
const server = http.createServer(app);

// 🔧 Middleware
app.use(cors({
    origin: "*",
    credentials: true,
}));

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));
app.use("/uploads", express.static("uploads"));

// ⚡ SOCKET.IO SETUP
const io = new Server(server, {
    cors: {
        origin: [
            // "http://localhost:5173",
            // "http://localhost:5174",
            "https://wwl-hrms.vercel.app/"
        ],
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        credentials: true,
    },
    transports: ["websocket", "polling"],
})

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
app.use("/api/attendance-corrections", correctionRoutes);
app.use("/api", PublicRoutes);
app.use("/api", SalesReportRoutes);
app.use("/api/celebrations", celebrationRoutes);
app.use("/api/celebrationTemplate", celebrationTemplateRoutes);
app.use("/api/ai", AIRoutes);
app.use("/api/hr-ai", HRAIRoutes);

// ✅ EXPORT (IMPORTANT)
module.exports = { app, server };