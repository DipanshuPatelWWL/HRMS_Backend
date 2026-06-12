const cron = require("node-cron");
const moment = require("moment-timezone");
const Attendance = require("../models/attendance.model");
const User = require("../models/user.model");
const Holiday = require("../models/holiday.model");
const Leave = require("../models/leave.model");
const { sendMail } = require("./emailClient");

// ── Helper: Format Time ──────────────────────────────────────────────
const fmtTime = (m) => m.tz("Asia/Kolkata").format("hh:mm a");

// ── Helper: HTML Template Generator ──────────────────────────────────────────
const generateReminderTemplate = (name, time, timeLeft, status) => `
<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; background: #ffffff;">
    <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 32px 20px; text-align: center;">
        <h2 style="color: #f8fafc; margin: 0; font-size: 24px; letter-spacing: 0.5px;">World WebLogic</h2>
        <p style="color: #94a3b8; margin: 8px 0 0; font-size: 14px;">Human Resource Management System</p>
    </div>
    <div style="padding: 40px 32px;">
        <div style="text-align: center; margin-bottom: 32px;">
            <div style="width: 64px; height: 64px; background: #fef3c7; border-radius: 20px; display: inline-flex; align-items: center; justify-content: center; font-size: 32px; margin-bottom: 16px;">⏰</div>
            <h2 style="margin: 0; font-size: 26px; font-weight: 800; color: #1e293b;">Shift ${status}</h2>
            <p style="margin: 8px 0 0; font-size: 16px; color: #64748b;">Schedule for <strong style="color: #d97706;">${time}</strong></p>
        </div>

        <p style="font-size: 16px; color: #334155; line-height: 1.6; margin: 0 0 24px;">
            Hi <strong>${name}</strong>, your work shift is <strong>${status.toLowerCase()}</strong>. 
            ${status === "Completed" ? "Great job today!" : "Please start wrapping up your tasks."}
        </p>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; margin-bottom: 32px;">
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="padding: 6px 0; color: #64748b; font-size: 14px;">Shift End</td>
                    <td style="padding: 6px 0; text-align: right; font-weight: 700; color: #1e293b;">${time}</td>
                </tr>
                <tr>
                    <td style="padding: 6px 0; color: #64748b; font-size: 14px;">Time Status</td>
                    <td style="padding: 6px 0; text-align: right; font-weight: 700; color: #d97706;">${timeLeft}</td>
                </tr>
            </table>
        </div>

        <div style="text-align: center; margin-bottom: 32px;">
            <a href="https://wwlhrms.digitalwebguider.com" 
               style="display: inline-block; background: #0f172a; color: #ffffff; font-size: 15px; font-weight: 600; padding: 14px 44px; border-radius: 12px; text-decoration: none; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.15);">
                Punch Out Now
            </a>
        </div>

        <div style="background: #fff1f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px;">
            <p style="margin: 0; font-size: 13px; color: #be123c; line-height: 1.5; text-align: center;">
                ⚠️ <strong>Important:</strong> Please ensure you punch out to record your working hours accurately.
            </p>
        </div>
    </div>
    <div style="background: #f1f5f9; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
        This is an automated security reminder from World WebLogic HR.
    </div>
</div>
`;

// ── Main Notification Loop ───────────────────────────────────────────
const processShiftReminders = async () => {
    try {
        const nowIST = moment().tz("Asia/Kolkata").startOf("minute");
        const todayString = nowIST.format("YYYY-MM-DD");
        const yesterdayString = nowIST.clone().subtract(1, "day").format("YYYY-MM-DD");
        const currentMinutes = nowIST.hour() * 60 + nowIST.minute();

        // Fetch Open Attendances (Punched in but not out)
        const openAttendances = await Attendance.find({
            punchOut: null,
            punchIn: { $ne: null },
            dateString: { $in: [todayString, yesterdayString] },
        }).populate("user", "name email shift role shiftReminderEmail status");

        for (const att of openAttendances) {
            if (!att.user || att.user.status !== "active") continue;
            if (att.user.shiftReminderEmail === false) continue;

            // 1. HOLIDAY/WEEKEND CHECK (Based on SHIFT START DATE)
            // This ensures Friday night shifts aren't blocked on Saturday morning.
            const attDate = moment.tz(att.dateString, "YYYY-MM-DD", "Asia/Kolkata");
            const isWorkingDay = attDate.day() !== 0 && attDate.day() !== 6;
            if (!isWorkingDay) continue;

            const holiday = await Holiday.findOne({ 
                date: { 
                    $gte: attDate.clone().startOf("day").toDate(), 
                    $lte: attDate.clone().endOf("day").toDate() 
                } 
            });
            if (holiday) continue;

            // 2. LEAVE CHECK (Based on Current Wall Clock)
            const userOnLeave = await Leave.findOne({
                user: att.user._id,
                status: "approved",
                fromDate: { $lte: nowIST.clone().endOf("day").toDate() },
                toDate: { $gte: nowIST.clone().startOf("day").toDate() },
            });
            if (userOnLeave) continue;

            // 3. CALCULATION (Rule A: Configured Shift End)
            const s = att.user.shift || {};
            const shiftEndMins = (s.endHour ?? 19) * 60 + (s.endMinute ?? 0);
            
            let diff;
            if (att.dateString === yesterdayString) {
                // If it's yesterday's record, shiftEnd must be early today for a reminder to fire
                diff = shiftEndMins - currentMinutes;
            } else {
                // Today's record
                if (shiftEndMins < currentMinutes - 60) {
                    // Shift ends early tomorrow morning (Overnight)
                    diff = (shiftEndMins + 1440) - currentMinutes;
                } else {
                    // Normal same-day end
                    diff = shiftEndMins - currentMinutes;
                }
            }

            const employeeName = att.user.name || "Employee";
            const shiftEndMoment = nowIST.clone().add(diff, "minutes");
            const completionLabel = fmtTime(shiftEndMoment);

            // STAGE 1: 5-Minute Reminder
            if (diff <= 5 && diff > 0 && !att.shiftEndReminderSent) {
                try {
                    const claimed = await Attendance.findOneAndUpdate(
                        { _id: att._id, shiftEndReminderSent: false },
                        { $set: { shiftEndReminderSent: true } },
                        { new: true }
                    );

                    if (claimed) {
                        const success = await sendMail({
                            to: att.user.email,
                            subject: `⏰ Your Shift Ends in 5 Minutes — ${completionLabel}`,
                            html: generateReminderTemplate(employeeName, completionLabel, "5 minutes", "Ending Soon"),
                        });

                        if (success) {
                            // Sent successfully
                        } else {
                            // Revert claim so next cron run can retry
                            await Attendance.updateOne({ _id: att._id }, { $set: { shiftEndReminderSent: false } });
                            console.error(`[ShiftReminder] 5-min failed for ${att.user.email}, reverted for retry`);
                        }
                    }
                } catch (stageErr) {
                    console.error(`[ShiftReminder] Stage 1 error for ${att.user.email}:`, stageErr.message);
                }
            }

            // STAGE 2: Shift Completed
            if (diff <= 0 && diff > -3 && !att.shiftEndedNotificationSent) {
                try {
                    const claimed = await Attendance.findOneAndUpdate(
                        { _id: att._id, shiftEndedNotificationSent: false },
                        { $set: { shiftEndedNotificationSent: true } },
                        { new: true }
                    );

                    if (claimed) {
                        const success = await sendMail({
                            to: att.user.email,
                            subject: `🏁 Shift Completed — ${completionLabel}`,
                            html: generateReminderTemplate(employeeName, completionLabel, "Now", "Completed"),
                        });

                        if (success) {
                            // Sent successfully
                        } else {
                            // Revert claim so next cron run can retry
                            await Attendance.updateOne({ _id: att._id }, { $set: { shiftEndedNotificationSent: false } });
                            console.error(`[ShiftReminder] Completion failed for ${att.user.email}, reverted for retry`);
                        }
                    }
                } catch (stageErr) {
                    console.error(`[ShiftReminder] Stage 2 error for ${att.user.email}:`, stageErr.message);
                }
            }
        }
    } catch (err) {
        console.error("Shift reminder process error:", err.message);
    }
};

const startShiftReminderCron = () => {
    // Run every minute
    cron.schedule("* * * * *", processShiftReminders, {
        timezone: "Asia/Kolkata"
    });
};

module.exports = { startShiftReminderCron };
