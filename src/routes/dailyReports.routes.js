const express = require("express");
const router = express.Router();
const { uploadDailyReport: upload } = require("../middleware/upload.middleware");
const protect = require("../middleware/auth.middleware"); // ← import protect

const {
    createDailyReport,
    getAllDailyReports,
    getDailyReportById,
    updateDailyReport,
    updateReportStatus,
    sendDailyReport,
    getEmployeeDailyReports,
} = require("../controllers/dailyReports.controller");


router.post("/createDailyReport", protect, upload.single("file"), createDailyReport);

router.get("/getAllDailyReports", protect, getAllDailyReports);

router.get("/getDailyReportById/:id", protect, getDailyReportById);

router.put("/updateDailyReport/:id", protect, upload.single("file"), updateDailyReport);

router.patch("/updateReportStatus/:id/status", protect, updateReportStatus);

router.patch("/sendDailyReport/:id/send", protect, sendDailyReport);

router.get("/getEmployeeDailyReports", protect, getEmployeeDailyReports);


module.exports = router;