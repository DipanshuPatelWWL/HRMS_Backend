const cron = require("node-cron");
const User = require("../models/user.model");

const MONTHLY_CASUAL_INCREMENT = 1;

// ─── Monthly: +1 casual to every active employee/tl ──────────
const accrueMonthlyLeave = async () => {
    try {
        const now = new Date();
        const thisYear = now.getFullYear();
        const thisMonth = now.getMonth() + 1;

        console.log(`[LeaveAccrual] Monthly casual accrual started — ${thisYear}/${thisMonth}`);

        const users = await User.find({
            status: "active",
            role: { $in: ["employee", "tl"] },
        });

        let count = 0;

        for (const user of users) {
            const bal = user.leaveBalance || {};

            // Skip if already accrued this month
            if (
                bal.lastResetMonth === thisMonth &&
                bal.lastResetYear === thisYear
            ) continue;

            // Add 1 to casual total — preserve used (don't reset mid-year)
            user.leaveBalance.casual = {
                total: (bal.casual?.total ?? 0) + MONTHLY_CASUAL_INCREMENT,
                used: bal.casual?.used ?? 0,
                carryForward: bal.casual?.carryForward ?? 0,
            };

            user.leaveBalance.lastResetMonth = thisMonth;
            user.leaveBalance.lastResetYear = thisYear;
            user.leaveBalance.lastAccrual = now;

            await user.save();
            count++;
        }

        console.log(`[LeaveAccrual] Monthly accrual done — ${count} users got +1 casual leave`);
    } catch (error) {
        console.error("[LeaveAccrual] Monthly accrual error:", error.message);
    }
};

// ─── Yearly: reset everything on Jan 1st ─────────────────────
// Casual → total 0, used 0 (earns fresh from scratch month by month)
// Sick   → used 0, total kept (HR allocation preserved)
// Earned → used 0, total kept (HR allocation preserved)
const runYearlyReset = async () => {
    try {
        const now = new Date();
        const thisYear = now.getFullYear();

        console.log(`[LeaveAccrual] Yearly reset started — ${thisYear}`);

        const users = await User.find({
            status: "active",
            role: { $in: ["employee", "tl"] },
        });

        let count = 0;

        for (const user of users) {
            const bal = user.leaveBalance || {};

            // Skip if already reset this year
            if (bal.lastResetYear === thisYear) continue;

            // Casual — full reset, earns again month by month
            user.leaveBalance.casual = {
                total: 0,
                used: 0,
                carryForward: 0,
            };

            // Sick — reset used only, keep HR-set total
            user.leaveBalance.sick = {
                total: bal.sick?.total ?? 0,
                used: 0,
                carryForward: 0,
            };

            // Earned — reset used only, keep HR-set total
            user.leaveBalance.earned = {
                total: bal.earned?.total ?? 0,
                used: 0,
                carryForward: 0,
            };

            user.leaveBalance.lastResetYear = thisYear;
            user.leaveBalance.lastResetMonth = 1;
            user.leaveBalance.lastAccrual = now;

            await user.save();
            count++;
        }

        console.log(`[LeaveAccrual] Yearly reset done — ${count} users reset`);
    } catch (error) {
        console.error("[LeaveAccrual] Yearly reset error:", error.message);
    }
};

// ─── Schedule ─────────────────────────────────────────────────
const startLeaveAccrualCron = () => {
    // Monthly — 1st of every month at midnight: +1 casual
    cron.schedule("0 0 1 * *", () => {
        console.log("[LeaveAccrual] Running monthly casual accrual...");
        accrueMonthlyLeave();
    }, { timezone: "Asia/Kolkata" });

    // Yearly — Jan 1st at midnight: full reset
    cron.schedule("0 0 1 1 *", () => {
        console.log("[LeaveAccrual] Running yearly reset...");
        runYearlyReset();
    }, { timezone: "Asia/Kolkata" });

    console.log("[LeaveAccrual] Cron registered — monthly (+1 casual) + yearly (full reset) ✅");
};

module.exports = { startLeaveAccrualCron, accrueMonthlyLeave, runYearlyReset };