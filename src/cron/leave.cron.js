const cron = require("node-cron");
const User = require("../models/user.model");

const MONTHLY_CASUAL_INCREMENT = 1;

// ─── Monthly: +1 casual to every active employee/tl ──────────
const accrueMonthlyLeave = async () => {
    try {
        const now = new Date();
        const thisYear = now.getFullYear();
        const thisMonth = now.getMonth() + 1;

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

            user.leaveBalance.lastAccrualMonth = thisMonth;
            user.leaveBalance.lastAccrualYear = thisYear;
            user.leaveBalance.lastResetMonth = thisMonth;
            user.leaveBalance.lastResetYear = thisYear;
            user.leaveBalance.lastAccrual = now;

            await user.save();
            count++;
        }
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
            user.leaveBalance.lastAccrualMonth = 0;
            user.leaveBalance.lastAccrualYear = thisYear;

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
    } catch (error) {
        console.error("[LeaveAccrual] Yearly reset error:", error.message);
    }
};

// ─── Schedule ─────────────────────────────────────────────────
const startLeaveAccrualCron = () => {
    // Monthly — 1st of every month at midnight: +1 casual
    cron.schedule("0 0 1 * *", () => {
        accrueMonthlyLeave();
    }, { timezone: "Asia/Kolkata" });

    // Yearly — Jan 1st at midnight: full reset
    cron.schedule("0 0 1 1 *", () => {
        runYearlyReset();
    }, { timezone: "Asia/Kolkata" });
};

// ─────────────────────────────────────────────────────────────
//  MONTHLY SHORT LEAVE RESET
//  Runs on the 1st of every month at 00:05 IST.
//  Resets used = 0 and refreshes lastGrantedMonth/Year
//  so every employee starts with 1 short leave again.
// ─────────────────────────────────────────────────────────────
const resetMonthlyShortLeave = async () => {
    const now = new Date();
    const nowMonth = now.getMonth() + 1;
    const nowYear = now.getFullYear();

    try {
        const result = await User.updateMany(
            {
                $or: [
                    { "leaveBalance.shortLeave.lastGrantedYear": { $lt: nowYear } },
                    {
                        "leaveBalance.shortLeave.lastGrantedYear": nowYear,
                        "leaveBalance.shortLeave.lastGrantedMonth": { $lt: nowMonth },
                    },
                ],
            },
            {
                $set: {
                    "leaveBalance.shortLeave.used": 0,
                    "leaveBalance.shortLeave.total": 1,
                    "leaveBalance.shortLeave.lastGrantedMonth": nowMonth,
                    "leaveBalance.shortLeave.lastGrantedYear": nowYear,
                },
            }
        );
        console.log(`✅ Short leave reset: ${result.modifiedCount} employees refreshed for ${nowMonth}/${nowYear}`);
    } catch (err) {
        console.error("❌ Short leave reset cron error:", err.message);
    }
};

const startShortLeaveResetCron = () => {
    // "5 0 1 * *" = 00:05 on the 1st of every month
    // Using UTC+5:30 offset equivalent: 18:35 UTC on last day of previous month
    // Simpler: run at midnight IST = 18:30 UTC
    cron.schedule("35 18 28-31 * *", async () => {
        // Only fire on the actual last-day→new-month transition
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (tomorrow.getDate() === 1) {
            await resetMonthlyShortLeave();
        }
    }, { timezone: "Asia/Kolkata" });

    // Also fire directly at midnight IST on the 1st
    cron.schedule("0 0 1 * *", resetMonthlyShortLeave, { timezone: "Asia/Kolkata" });
};

module.exports = { startLeaveAccrualCron, accrueMonthlyLeave, runYearlyReset, resetMonthlyShortLeave, startShortLeaveResetCron };