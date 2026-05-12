const express = require("express");
const router = express.Router();
const { uploadDailyReport: upload } = require("../middleware/upload.middleware");

const {
    createDailyReport,
    getAllDailyReports,
    getDailyReportById,
    updateDailyReport,
    updateReportStatus,
    sendDailyReport,
} = require("../controllers/dailyReports.controller");

// POST   /api/daily-report              → submit a report (with optional file)
router.post("/createDailyReport", upload.single("file"), createDailyReport);

// GET    /api/daily-report              → get all reports (?status, ?day, ?date)
router.get("/getAllDailyReports", getAllDailyReports);

// GET    /api/daily-report/:id          → get one report
router.get("/getDailyReportById/:id", getDailyReportById);

// PUT    /api/daily-report/:id          → update report (with optional new file)
router.put("/updateDailyReport/:id", upload.single("file"), updateDailyReport);

// PATCH  /api/daily-report/:id/status   → change status only (admin use)
router.patch("/updateReportStatus/:id/status", updateReportStatus);

// PATCH  /api/daily-report/:id/send     → mark report as sent (employee)
router.patch("/sendDailyReport/:id/send", sendDailyReport);


module.exports = router;