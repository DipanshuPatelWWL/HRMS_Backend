const { app, server } = require("./src/app");
const mongoose = require("mongoose");
require("dotenv").config();
require("./src/cron/leave.cron");
const {
    startCelebrationCron
} = require("./src/cron/celebration.cron");
const { startLeaveAccrualCron, startShortLeaveResetCron } = require("./src/cron/leave.cron");
const { startShiftReminderCron } = require("./src/services/shiftReminder");
const { checkPythonService } = require("./src/middleware/pythonProxy");
const { startFollowUpCron } = require("./src/cron/followUp.cron");
const PayrollSettings = require("./src/models/payrollSettings.model");

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("DB Connected");

        // Self-heal: Clear any stale payroll generation locks on fresh boot
        try {
            const MAX_LOCK_AGE = 30 * 60 * 1000; // 30 minutes
            const staleThreshold = new Date(Date.now() - MAX_LOCK_AGE);

            await PayrollSettings.updateOne(
                {
                    singletonKey: "singleton",
                    isGeneratingPayroll: true,
                    $or: [
                        { lockAcquiredAt: { $lte: staleThreshold } },
                        { lockAcquiredAt: null }
                    ]
                },
                { $set: { isGeneratingPayroll: false, lockAcquiredAt: null } }
            );
            console.log("leared any stale payroll generation locks");
        } catch (lockErr) {
            console.warn("Failed to clear stale payroll locks on startup:", lockErr.message);
        }

        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            startLeaveAccrualCron();
            startShortLeaveResetCron();
            startCelebrationCron();
            startShiftReminderCron();
            checkPythonService();
            startFollowUpCron();
        });
    } catch (error) {
        console.error("Server Error:", error.message);
    }
};

startServer();