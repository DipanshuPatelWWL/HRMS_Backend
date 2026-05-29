const cron = require("node-cron");
const Celebration = require("../models/celebration.model");
const { sendCelebrationMail } = require("../services/celebrationNotify");
const generateCelebrationTemplate = require("../utils/events/generateCelebrationTemplate");

// ─────────────────────────────────────────────
// LOCK — prevents a second tick from running
// while the previous one is still in progress
// ─────────────────────────────────────────────
let isProcessing = false;

// ─────────────────────────────────────────────
// PROCESS CELEBRATIONS
// ─────────────────────────────────────────────

const processCelebrations = async () => {

    if (isProcessing) {
        console.log("[CelebrationCron] skipped — previous run still in progress");
        return;
    }

    isProcessing = true;

    try {

        const now = new Date();

        // Atomically claim ALL due pending celebrations in one shot
        // by updating their status to "processing" before we loop
        // This prevents any other tick from picking them up
        const claimResult = await Celebration.updateMany(
            {
                status: "pending",
                scheduledAt: { $lte: now },
            },
            { $set: { status: "processing" } }
        );

        if (claimResult.modifiedCount === 0) {
            isProcessing = false;
            return;
        }

        // Now fetch only the ones WE just claimed
        const celebrations = await Celebration.find({
            status: "processing",
            sentAt: null,   // ← never re-process already-sent ones
        })
            .populate("employeeId")
            .populate("templateId")
            .populate("recipients");

        for (const celebration of celebrations) {

            try {

                const employee = celebration.employeeId;
                const template = celebration.templateId; // may be null — that's OK

                // ─────────────────────────
                // SAFETY CHECK
                // ─────────────────────────

                if (!employee) {
                    celebration.status = "failed";
                    await celebration.save();
                    continue;
                }

                // Idempotency guard — skip if already sent
                if (celebration.sentAt) {
                    celebration.status = "sent";
                    await celebration.save();
                    continue;
                }
                // ─────────────────────────
                // RESOLVE STYLE
                // ─────────────────────────

                const resolvedStyle =
                    template?.style ||
                    celebration.templateStyle ||
                    "dark_purple";

                // ─────────────────────────
                // GENERATE HTML
                // ─────────────────────────

                const html = generateCelebrationTemplate({
                    style: resolvedStyle,
                    employee,
                    customMessage: celebration.customMessage,
                    eventType: celebration.eventType,
                    uploadedImage: celebration.uploadedImage,
                });

                // ─────────────────────────
                // SUBJECT
                // ─────────────────────────

                const defaultSubject =
                    celebration.eventType === "birthday"
                        ? `🎂 Happy Birthday, ${employee.name}!`
                        : celebration.eventType === "anniversary"
                            ? `🏢 Happy Work Anniversary, ${employee.name}!`
                            : `🎉 Congratulations, ${employee.name}!`;

                // If template subject contains wrong event keyword, fall back to default
                const subject = defaultSubject;

                // ─────────────────────────
                // SEND TO EMPLOYEE
                // ─────────────────────────

                // ─────────────────────────
                // SEND TO SELECTED RECIPIENTS ONLY
                // ─────────────────────────

                if (celebration.recipients?.length > 0) {
                    for (const recipient of celebration.recipients) {
                        if (!recipient?.email) continue;
                        await sendCelebrationMail({ to: recipient.email, subject, html });
                    }
                } else {
                    // Fallback — no recipients selected, send to employee only
                    if (employee.email) {
                        await sendCelebrationMail({ to: employee.email, subject, html });
                    }
                }

                // ─────────────────────────
                // MARK SENT
                // ─────────────────────────

                celebration.status = "sent";
                celebration.sentAt = new Date();
                await celebration.save();

            } catch (err) {

                console.error("❌ Celebration failed:", celebration._id, err.message);
                celebration.status = "failed";
                await celebration.save();
            }
        }

    } catch (error) {

        console.error("[CelebrationCron Error]", error.message);

        // Safety net: if something catastrophic happened,
        // roll any stuck "processing" docs back to "pending"
        // so they can be retried next run
        await Celebration.updateMany(
            { status: "processing", sentAt: null },
            { $set: { status: "failed" } }
        ).catch(() => { });

    } finally {

        isProcessing = false;
    }
};

// ─────────────────────────────────────────────
// START CRON
// ─────────────────────────────────────────────

const startCelebrationCron = () => {
    console.log("🚀 Celebration cron started");
    cron.schedule("* * * * *", async () => {
        console.log("[CelebrationCron] checking...");
        await processCelebrations();
    });
};

module.exports = { startCelebrationCron };