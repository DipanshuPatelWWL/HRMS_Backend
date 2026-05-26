// ─────────────────────────────────────────────
//  SHIFT END REMINDER — runs every minute via cron
//  Sends an email 5 minutes before each employee's shift end
//  if they are currently punched in and haven't punched out yet.
// ─────────────────────────────────────────────

const cron = require("node-cron");
const moment = require("moment-timezone");
const Attendance = require("../models/attendance.model");
const User = require("../models/user.model");
const { sendMail } = require("./emailClient");

// Track which attendanceIds have already had reminder sent this session
// to avoid sending duplicate emails if the cron fires multiple times
// in the same minute window.
const remindedSet = new Set();

// Helper: derive shift end in minutes from midnight from a user's shift doc
const getShiftEndMinutes = (shift) => {
    const s = shift || {};
    const endH = s.endHour ?? 19;
    const endM = s.endMinute ?? 0;
    return endH * 60 + endM;
};

const fmt12h = (totalMinutes) => {
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    const ap = h >= 12 ? "PM" : "AM";
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ap}`;
};

const startShiftReminderCron = () => {
    // Runs every minute
    cron.schedule("* * * * *", async () => {
        try {
            const nowIST = moment().tz("Asia/Kolkata");
            const todayString = nowIST.format("YYYY-MM-DD");
            const yesterdayString = nowIST.clone().subtract(1, "day").format("YYYY-MM-DD");

            const currentMinutes = nowIST.hour() * 60 + nowIST.minute();
            const REMIND_BEFORE = 5; // minutes before shift end

            // Find all open punch-ins (today + yesterday for overnight shifts)
            const openAttendances = await Attendance.find({
                punchOut: null,
                dateString: { $in: [todayString, yesterdayString] },
            }).populate("user", "name email shift");

            for (const att of openAttendances) {
                if (!att.user || !att.user.email) continue;

                // Skip if already reminded this session
                const attId = att._id.toString();
                if (remindedSet.has(attId)) continue;

                const shiftEndMins = getShiftEndMinutes(att.user.shift);

                // Calculate how many minutes until shift end
                // Handle overnight: if shiftEnd < currentMinutes, it's next-day end
                let minutesUntilEnd = shiftEndMins - currentMinutes;

                // Overnight shift correction:
                // e.g. shift ends at 01:00 (60 min), current time is 00:55 (55 min)
                // minutesUntilEnd = 60 - 55 = 5 ✅ correct
                // e.g. shift ends at 01:00 (60 min), current time is 23:55 (1435 min)  
                // minutesUntilEnd = 60 - 1435 = -1375 → add 1440 = 65 min ✅ correct
                if (minutesUntilEnd < -60) {
                    minutesUntilEnd += 1440;
                }

                // Fire reminder at exactly REMIND_BEFORE minutes before shift end
                // We allow a 1-minute window (0 to 1 min) to account for cron timing
                if (minutesUntilEnd >= REMIND_BEFORE && minutesUntilEnd < REMIND_BEFORE + 1) {
                    const shiftEndLabel = fmt12h(shiftEndMins);
                    const employeeName = att.user.name || "Employee";

                    await sendMail({
                        to: att.user.email,
                        subject: `⏰ Your Shift Ends in 5 Minutes — ${shiftEndLabel}`,
                        html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
    <div style="background: #1a237e; padding: 20px; text-align: center;">
        <h2 style="color: white; margin: 0;">World WebLogic Pvt Ltd</h2>
    </div>
    <div style="padding: 24px;">

        <!-- Header -->
        <div style="text-align:center; margin-bottom:28px;">
            <div style="width:56px;height:56px;background:#fff7ed;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:12px;">⏰</div>
            <h2 style="margin:0;font-size:22px;font-weight:700;color:#0f172a;">Shift Ending Soon</h2>
            <p style="margin:6px 0 0;font-size:14px;color:#64748b;">Your shift ends in <strong style="color:#ea580c;">5 minutes</strong></p>
        </div>

        <!-- Message -->
        <p style="font-size:15px;color:#334155;line-height:1.7;margin:0 0 20px;">
            Hi <strong style="color:#0f172a;">${employeeName}</strong>, 
            your shift is scheduled to end at 
            <strong style="color:#ea580c;">${shiftEndLabel}</strong>.
            Please wrap up your work and remember to <strong>punch out</strong> before leaving.
        </p>

        <!-- Info Box -->
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px 20px;margin:0 0 24px;">
            <table style="width:100%;border-collapse:collapse;">
                <tr>
                    <td style="padding:8px 0;color:#92400e;width:140px;font-size:13px;">Shift End Time</td>
                    <td style="padding:8px 0;font-weight:700;color:#0f172a;font-size:14px;">${shiftEndLabel}</td>
                </tr>
                <tr>
                    <td style="padding:8px 0;color:#92400e;font-size:13px;">Time Remaining</td>
                    <td style="padding:8px 0;font-weight:700;color:#ea580c;font-size:14px;">~5 minutes</td>
                </tr>
                <tr>
                    <td style="padding:8px 0;color:#92400e;font-size:13px;">Action Required</td>
                    <td style="padding:8px 0;font-weight:700;color:#0f172a;font-size:14px;">Punch Out</td>
                </tr>
            </table>
        </div>

        <!-- CTA Button -->
        <div style="text-align:center;margin:0 0 24px;">
            <a href="https://wwlhrms.digitalwebguider.com"
               style="display:inline-block;background:#ea580c;color:#ffffff;font-size:15px;font-weight:600;padding:13px 36px;border-radius:8px;text-decoration:none;letter-spacing:0.3px;">
                Punch Out Now →
            </a>
        </div>

        <!-- Warning -->
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;">
            <p style="margin:0;font-size:13px;color:#991b1b;line-height:1.6;">
                ⚠️ Forgetting to punch out may result in your attendance being marked as 
                <strong>half-day</strong> or flagged for a missed punch-out.
            </p>
        </div>

    </div>
    <div style="background:#f5f5f5;padding:12px;text-align:center;font-size:12px;color:#999;">
        This is an automated reminder from World WebLogic HRMS. Do not reply.
    </div>
</div>`,
                    });

                    // Mark as reminded so we don't send again
                    remindedSet.add(attId);
                    console.log(`📧 Shift reminder sent to ${att.user.email} (shift ends at ${shiftEndLabel})`);
                }
            }

            // Clean up remindedSet daily — remove entries older than 2 days
            // to prevent unbounded memory growth. We do this by clearing the set
            // once at midnight IST.
            if (nowIST.hour() === 0 && nowIST.minute() === 0) {
                remindedSet.clear();
                console.log("🧹 Shift reminder set cleared at midnight");
            }

        } catch (err) {
            console.error("Shift reminder cron error:", err.message);
        }
    }, {
        timezone: "Asia/Kolkata",
    });

    console.log("✅ Shift end reminder cron started (runs every minute, IST)");
};

module.exports = { startShiftReminderCron };