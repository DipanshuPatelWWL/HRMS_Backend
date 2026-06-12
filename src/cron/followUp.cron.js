// followUp.cron.js
// Runs every hour — checks which leads have follow-ups due today
// Marks them as "Needs Follow-up" and creates a notification

const cron = require("node-cron");
const LeadIntelligence = require("../models/leadIntelligence.model");

// ── Helper: is date today or overdue? ────────────────────────────────────────
const isDueOrOverdue = (date) => {
    if (!date) return false;
    const now = new Date();
    const due = new Date(date);
    // Strip time — compare dates only
    now.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    return due <= now;
};

// ── Main job ─────────────────────────────────────────────────────────────────
const checkFollowUps = async () => {
    try {
        const leads = await LeadIntelligence.find({
            isDeleted: false,
            stage: { $nin: ["Won", "Lost"] },
        });

        let updated = 0;

        for (const lead of leads) {
            let needsFollowUp = false;

            // Check each follow-up date
            for (const fu of lead.followUpDates || []) {
                if (!fu.completed && isDueOrOverdue(fu.scheduledAt)) {
                    needsFollowUp = true;
                    break;
                }
            }

            // Also check nextFollowUp field
            if (!needsFollowUp && lead.nextFollowUp && isDueOrOverdue(lead.nextFollowUp)) {
                needsFollowUp = true;
            }

            if (needsFollowUp && lead.status !== "Needs Follow-up") {
                lead.status = "Needs Follow-up";
                lead.timeline.unshift({
                    action: "Follow-up reminder triggered automatically",
                    performedBy: "system",
                    note: `Due: ${new Date(lead.nextFollowUp || Date.now()).toDateString()}`,
                });
                await lead.save();
                updated++;
            }
        }

        if (updated > 0) {
            console.log(`🔔 Follow-up cron: marked ${updated} lead(s) as "Needs Follow-up"`);
        }
    } catch (err) {
        console.error("❌ Follow-up cron error:", err.message);
    }
};

// ── Start cron ───────────────────────────────────────────────────────────────
const startFollowUpCron = () => {
    // Run every hour at minute 0
    cron.schedule("0 * * * *", checkFollowUps);
    // Also run immediately on startup
    checkFollowUps();
    console.log("📅 Follow-up cron started (runs every hour)");
};

module.exports = { startFollowUpCron, checkFollowUps };