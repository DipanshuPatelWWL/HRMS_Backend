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
        const celebrations = [];

        while (true) {
            const celebration = await Celebration.findOneAndUpdate(
                {
                    status: "pending",
                    scheduledAt: { $lte: new Date() },
                },
                {
                    $set: {
                        status: "processing",
                    },
                },
                {
                    new: true,
                    sort: { scheduledAt: 1 },
                }
            )
                .populate("employeeId")
                .populate("templateId")
                .populate("recipients");

            if (!celebration) {
                break;
            }

            celebrations.push(celebration);
        }

        if (celebrations.length === 0) {
            isProcessing = false;
            return;
        }

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

                const recipientEmails = new Set();

                // Send to employee if enabled
                if (celebration.sendToEmployee && employee?.email) {
                    recipientEmails.add(employee.email);
                }

                // Send to selected recipients if enabled
                if (celebration.sendToOthers && celebration.recipients?.length > 0) {
                    for (const recipient of celebration.recipients) {
                        if (recipient?.email) {
                            recipientEmails.add(recipient.email);
                        }
                    }
                }

                if (recipientEmails.size === 0) {
                    throw new Error("No valid recipients found for this celebration");
                }

                const emailResults = await Promise.allSettled(
                    [...recipientEmails].map(email =>
                        sendCelebrationMail({
                            to: email,
                            subject,
                            html,
                        })
                    )
                );

                const failedEmails = emailResults
                    .map((result, index) => ({
                        result,
                        email: [...recipientEmails][index],
                    }))
                    .filter(item => item.result.status === "rejected");

                if (failedEmails.length > 0) {
                    console.error(
                        "[CelebrationCron] Some emails failed:",
                        failedEmails.map(item => ({
                            email: item.email,
                            error: item.result.reason?.message || item.result.reason,
                        }))
                    );

                    throw new Error(
                        `${failedEmails.length} recipient email(s) failed`
                    );
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
            {
                status: "processing",
                sentAt: null,
                scheduledAt: { $lte: new Date() },
            },
            {
                $set: {
                    status: "pending",
                },
            }
        ).catch(() => { });

    } finally {

        isProcessing = false;
    }
};

// ─────────────────────────────────────────────
// START CRON
// ─────────────────────────────────────────────

const startCelebrationCron = () => {
    console.log("Celebration cron started");
    cron.schedule("* * * * *", async () => {
        console.log("[CelebrationCron] checking...");
        await processCelebrations();
    });
};

module.exports = { startCelebrationCron };