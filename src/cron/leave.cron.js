const cron = require("node-cron");
const User = require("../models/user.model");

const accrueMonthlyLeave = async () => {
    try {
        const now = new Date();

        // Add 1 casual leave to every active employee / tl / manager
        const result = await User.updateMany(
            {
                status: "active",
                role: { $in: ["employee", "tl", "manager"] },
            },
            {
                $inc: { "leaveBalance.total": 1 },
                $set: { "leaveBalance.lastAccrual": now },
            }
        );

        console.log(
            `[LeaveAccrual] ${now.toISOString()} — credited 1 casual leave to ${result.modifiedCount} employees`
        );
    } catch (error) {
        console.error("[LeaveAccrual] Error:", error.message);
    }
};

const startLeaveAccrualCron = () => {
    // Runs at 00:00 on the 1st of every month
    cron.schedule("0 0 1 * *", () => {
        console.log("[LeaveAccrual] Running monthly accrual...");
        accrueMonthlyLeave();
    });

    console.log("[LeaveAccrual] Cron scheduled — runs on 1st of every month at midnight");
};

module.exports = { startLeaveAccrualCron, accrueMonthlyLeave };