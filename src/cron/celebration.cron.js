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

        console.log("⏰ Checking celebrations...");
        console.log("Current Time:", now);

        const celebrations = await Celebration.find({
            status: "pending",
            scheduledAt: { $lte: now },
        })
            .populate("employeeId")
            .populate("templateId")
            .populate("recipients");

        console.log("Found celebrations:", celebrations.length);

        for (const celebration of celebrations) {

            try {

                console.log("Processing:", celebration._id);

                const employee = celebration.employeeId;
                const template = celebration.templateId;

                // ─────────────────────────
                // SAFETY CHECKS
                // ─────────────────────────

                if (!employee) {

                    console.log("❌ Employee missing");

                    celebration.status = "failed";

                    await celebration.save();

                    continue;
                }

                if (!template) {

                    console.log("❌ Template missing");

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

                    console.log(
                        "📧 Sending to employee:",
                        employee.email
                    );

                    await sendCelebrationMail({
                        to: employee.email,
                        subject,
                        html,
                    });

                    console.log("✅ Sent to employee");
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

                        console.log(
                            "📧 Sending to:",
                            recipient.email
                        );

                        await sendCelebrationMail({
                            to: recipient.email,
                            subject: `🎉 Wish ${employee.name} a happy ${celebration.eventType}`,
                            html,
                        });

                    }

                    console.log("✅ Sent to recipients");
                }

                // ─────────────────────────
                // UPDATE STATUS
                // ─────────────────────────

                celebration.status = "sent";

                await celebration.save();

                console.log("✅ Celebration marked as sent");

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