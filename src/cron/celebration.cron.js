const cron = require("node-cron");

const Celebration = require("../models/celebration.model");

const { sendCelebrationMail } = require("../services/celebrationNotify");

const generateCelebrationTemplate = require(
    "../utils/events/generateCelebrationTemplate"
);


// ─────────────────────────────────────────────
// PROCESS CELEBRATIONS
// ─────────────────────────────────────────────

const processCelebrations = async () => {

    try {

        const now = new Date();
        const celebrations = await Celebration.find({
            status: "pending",
            scheduledAt: { $lte: now },
        })
            .populate("employeeId")
            .populate("templateId")
            .populate("recipients");

        for (const celebration of celebrations) {

            try {

                const employee = celebration.employeeId;
                const template = celebration.templateId;

                // ─────────────────────────
                // SAFETY CHECKS
                // ─────────────────────────

                if (!employee) {

                    celebration.status = "failed";

                    await celebration.save();

                    continue;
                }

                if (!template) {

                    celebration.status = "failed";

                    await celebration.save();

                    continue;
                }

                // ─────────────────────────
                // GENERATE HTML TEMPLATE
                // ─────────────────────────

                const html = generateCelebrationTemplate({
                    style: template.style,
                    employee,
                    customMessage: celebration.customMessage,
                    eventType: celebration.eventType,
                    uploadedImage: celebration.uploadedImage,
                });

                // ─────────────────────────
                // SUBJECT
                // ─────────────────────────

                const subject = (
                    template.subject ||
                    "Celebration"
                ).replace(
                    /{{employeeName}}/g,
                    employee.name
                );

                // ─────────────────────────
                // SEND TO EMPLOYEE
                // ─────────────────────────

                if (celebration.sendToEmployee) {

                    await sendCelebrationMail({
                        to: employee.email,
                        subject,
                        html,
                    });

                }

                // ─────────────────────────
                // SEND TO RECIPIENTS
                // ─────────────────────────

                if (
                    celebration.sendToOthers &&
                    celebration.recipients &&
                    celebration.recipients.length > 0
                ) {

                    for (const recipient of celebration.recipients) {

                        if (!recipient?.email) continue;

                        await sendCelebrationMail({
                            to: recipient.email,
                            subject: `🎉 Wish ${employee.name} a happy ${celebration.eventType}`,
                            html,
                        });

                    }

                }

                // ─────────────────────────
                // UPDATE STATUS
                // ─────────────────────────

                celebration.status = "sent";

                await celebration.save();

            } catch (err) {

                console.log(
                    "❌ Celebration failed:",
                    celebration._id,
                    err.message
                );

                celebration.status = "failed";

                await celebration.save();
            }
        }

    } catch (error) {

        console.error(
            "[CelebrationCron Error]",
            error.message
        );

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

module.exports = {
    startCelebrationCron,
};