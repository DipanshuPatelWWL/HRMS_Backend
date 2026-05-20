const { sendMail } = require("./emailClient");

const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

const fmtDate = (d) =>
    new Date(d || Date.now()).toLocaleDateString("en-IN", {
        day: "2-digit", month: "short", year: "numeric"
    });

// Reusable HTML wrapper
const template = (content) => `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
    <div style="background: #1a237e; padding: 20px; text-align: center;">
        <h2 style="color: white; margin: 0;">World WebLogic Pvt Ltd</h2>
    </div>
    <div style="padding: 24px;">
        ${content}
    </div>
    <div style="background: #f5f5f5; padding: 12px; text-align: center; font-size: 12px; color: #999;">
        This is an automated message from World WebLogic HRMS. Do not reply.
    </div>
</div>`;

const row = (label, value) => `
<tr>
    <td style="padding: 8px 0; color: #666; width: 140px;">${label}</td>
    <td style="padding: 8px 0; font-weight: bold; color: #222;">${value}</td>
</tr>`;

const table = (rows) => `
<table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
    ${rows}
</table>`;

// ─── WELCOME EMAIL ────────────────────────────────────────────
const notifyWelcome = async (to, { employeeName, employeeId, designation, department, password }) => {
    const html = template(`
        <!-- Header -->
        <div style="text-align:center;margin-bottom:28px;">
            <div style="width:56px;height:56px;background:#e8eaf6;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:12px;">👋</div>
            <h2 style="margin:0;font-size:22px;font-weight:700;color:#0f172a;">Welcome to World WebLogic!</h2>
            <p style="margin:6px 0 0;font-size:14px;color:#64748b;">Your account is ready. Here are your login details.</p>
        </div>

        <!-- Greeting -->
        <p style="font-size:15px;color:#334155;line-height:1.7;margin:0 0 20px;">
            Hi <strong style="color:#0f172a;">${employeeName}</strong>, we're excited to have you on board! 🎉
            Below are your credentials to access the HRMS portal.
        </p>

        <!-- Credentials Box -->
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin:0 0 24px;">

            <!-- Box Header -->
            <div style="background:#e8eaf6;padding:10px 18px;border-bottom:1px solid #e2e8f0;">
                <p style="margin:0;font-size:11px;font-weight:700;color:#3949ab;text-transform:uppercase;letter-spacing:0.8px;">🔐 Login Credentials</p>
            </div>

            <!-- Employee ID -->
            <div style="display:flex;align-items:center;padding:14px 18px;border-bottom:1px solid #f1f5f9;">
                <div style="width:36px;height:36px;background:#e8eaf6;border-radius:8px;display:inline-block;text-align:center;line-height:36px;font-size:16px;flex-shrink:0;">🪪</div>
                <div style="margin-left:14px;">
                    <p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Employee ID</p>
                    <p style="margin:2px 0 0;font-size:14px;font-weight:600;color:#0f172a;font-family:monospace;">${employeeId}</p>
                </div>
            </div>

            <!-- Email -->
            <div style="display:flex;align-items:center;padding:14px 18px;border-bottom:1px solid #f1f5f9;">
                <div style="width:36px;height:36px;background:#e8eaf6;border-radius:8px;display:inline-block;text-align:center;line-height:36px;font-size:16px;flex-shrink:0;">📧</div>
                <div style="margin-left:14px;">
                    <p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Email</p>
                    <p style="margin:2px 0 0;font-size:14px;font-weight:600;color:#0f172a;">${to}</p>
                </div>
            </div>

            <!-- Password -->
            <div style="display:flex;align-items:center;padding:14px 18px;border-bottom:1px solid #f1f5f9;">
                <div style="width:36px;height:36px;background:#e8eaf6;border-radius:8px;display:inline-block;text-align:center;line-height:36px;font-size:16px;flex-shrink:0;">🔑</div>
                <div style="margin-left:14px;">
                    <p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Password</p>
                    <p style="margin:2px 0 0;">
                        <code style="font-size:14px;font-weight:600;color:#1a237e;background:#e8eaf6;padding:3px 10px;border-radius:5px;letter-spacing:1px;">${password}</code>
                    </p>
                </div>
            </div>

            <!-- Designation -->
            <div style="display:flex;align-items:center;padding:14px 18px;border-bottom:1px solid #f1f5f9;">
                <div style="width:36px;height:36px;background:#e8eaf6;border-radius:8px;display:inline-block;text-align:center;line-height:36px;font-size:16px;flex-shrink:0;">💼</div>
                <div style="margin-left:14px;">
                    <p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Designation</p>
                    <p style="margin:2px 0 0;font-size:14px;font-weight:600;color:#0f172a;">${designation || "—"}</p>
                </div>
            </div>

            <!-- Department -->
            <div style="display:flex;align-items:center;padding:14px 18px;">
                <div style="width:36px;height:36px;background:#e8eaf6;border-radius:8px;display:inline-block;text-align:center;line-height:36px;font-size:16px;flex-shrink:0;">🏢</div>
                <div style="margin-left:14px;">
                    <p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Department</p>
                    <p style="margin:2px 0 0;font-size:14px;font-weight:600;color:#0f172a;">${department || "—"}</p>
                </div>
            </div>

        </div>

        <!-- Login Button -->
        <div style="text-align:center;margin:0 0 24px;">
            <a href="https://wwlhrms.digitalwebguider.com"
               style="display:inline-block;background:#1a237e;color:#ffffff;font-size:15px;font-weight:600;padding:13px 36px;border-radius:8px;text-decoration:none;letter-spacing:0.3px;">
                Login to HRMS →
            </a>
        </div>

        <!-- Warning -->
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;display:flex;align-items:flex-start;gap:10px;">
            <span style="font-size:16px;line-height:1.4;flex-shrink:0;">⚠️</span>
            <p style="margin:0;font-size:13px;color:#991b1b;line-height:1.6;">
                Please change your password immediately after your first login.
                Do not share your credentials with anyone.
            </p>
        </div>
    `);

    return await sendMail({
        to,
        subject: `Welcome to World WebLogic, ${employeeName}! 🎉`,
        html
    });
};

// ─── PAYROLL GENERATED ────────────────────────────────────────
const notifyPayrollGenerated = async (to, { month, year, generated, totalNet }) => {
    const html = template(`
        <h3 style="color: #1a237e;">💳 Payroll Generated</h3>
        ${table(`
            ${row("Month", `${MONTHS[month - 1]} ${year}`)}
            ${row("Payslips Created", generated)}
            ${row("Total Payable", `₹${(totalNet || 0).toLocaleString("en-IN")}`)}
            ${row("Generated On", fmtDate(new Date()))}
        `)}
    `);
    return await sendMail({ to, subject: `Payroll Generated — ${MONTHS[month - 1]} ${year}`, html });
};

// ─── PAYSLIP ──────────────────────────────────────────────────
const notifyPersonalPayslip = async (to, { employeeName, month, year, netSalary, payslipUrl }) => {
    const html = template(`
        <h3 style="color: #1a237e;">💵 Salary Credited</h3>
        <p>Hi <strong>${employeeName}</strong>, your salary has been processed.</p>
        ${table(`
            ${row("Month", `${MONTHS[month - 1]} ${year}`)}
            ${row("Net Salary", `₹${(netSalary || 0).toLocaleString("en-IN")}`)}
            ${row("Date", fmtDate(new Date()))}
        `)}
        ${payslipUrl ? `<a href="${payslipUrl}" style="display:inline-block;margin-top:16px;background:#1a237e;color:white;padding:10px 24px;border-radius:6px;text-decoration:none;">View Payslip</a>` : ""}
    `);
    return await sendMail({ to, subject: `Salary Credited — ${MONTHS[month - 1]} ${year}`, html });
};

// ─── LEAVE APPLIED ────────────────────────────────────────────
const notifyLeaveApplied = async (to, { employeeName, leaveType, fromDate, toDate, days, reason }) => {
    const html = template(`
        <h3 style="color: #1a237e;">🗓️ Leave Request Submitted</h3>
        ${table(`
            ${row("Employee", employeeName)}
            ${row("Leave Type", leaveType)}
            ${row("From", fmtDate(fromDate))}
            ${row("To", fmtDate(toDate))}
            ${row("Days", days)}
            ${row("Reason", reason || "—")}
        `)}
    `);
    return await sendMail({ to, subject: `Leave Request — ${employeeName}`, html });
};

// ─── LEAVE APPROVED ───────────────────────────────────────────
const notifyLeaveApproved = async (to, { employeeName, leaveType, fromDate, toDate, days, approvedBy }) => {
    const html = template(`
        <h3 style="color: #2e7d32;">✅ Leave Approved</h3>
        ${table(`
            ${row("Employee", employeeName)}
            ${row("Leave Type", leaveType)}
            ${row("From", fmtDate(fromDate))}
            ${row("To", fmtDate(toDate))}
            ${row("Days", days)}
            ${row("Approved By", approvedBy || "HR")}
        `)}
    `);
    return await sendMail({ to, subject: `Leave Approved — ${MONTHS[new Date(fromDate).getMonth()]}`, html });
};

// ─── LEAVE REJECTED ───────────────────────────────────────────
const notifyLeaveRejected = async (to, { employeeName, leaveType, fromDate, toDate, reason, rejectedBy }) => {
    const html = template(`
        <h3 style="color: #c62828;">❌ Leave Rejected</h3>
        ${table(`
            ${row("Employee", employeeName)}
            ${row("Leave Type", leaveType)}
            ${row("From", fmtDate(fromDate))}
            ${row("To", fmtDate(toDate))}
            ${row("Rejected By", rejectedBy || "HR")}
            ${row("Reason", reason || "—")}
        `)}
    `);
    return await sendMail({ to, subject: `Leave Rejected — ${employeeName}`, html });
};

// ─── ANNOUNCEMENT ─────────────────────────────────────────────
const notifyAnnouncement = async (to, { title, body, postedBy }) => {
    const html = template(`
        <h3 style="color: #1a237e;">📢 New Announcement</h3>
        <h4 style="margin: 0 0 8px;">${title}</h4>
        <p style="color: #444;">${body}</p>
        ${table(`
            ${row("Posted By", postedBy || "HR")}
            ${row("Date", fmtDate(new Date()))}
        `)}
    `);
    return await sendMail({ to, subject: `Announcement: ${title}`, html });
};

// ─── NEW EMPLOYEE ─────────────────────────────────────────────
const notifyNewEmployee = async (to, { name, employeeId, designation, department, joiningDate }) => {
    const html = template(`
        <h3 style="color: #1a237e;">👋 New Team Member!</h3>
        ${table(`
            ${row("Name", name)}
            ${row("Employee ID", employeeId)}
            ${row("Designation", designation)}
            ${row("Department", department)}
            ${row("Joining Date", fmtDate(joiningDate))}
        `)}
    `);
    return await sendMail({ to, subject: `New Employee Joined — ${name}`, html });
};

// ─── HOLIDAY ──────────────────────────────────────────────────
const notifyHoliday = async (to, { name, date, markedBy }) => {
    const html = template(`
        <h3 style="color: #1a237e;">📅 Holiday Announced</h3>
        ${table(`
            ${row("Holiday", name)}
            ${row("Date", fmtDate(date))}
            ${row("Added By", markedBy || "HR")}
        `)}
    `);
    return await sendMail({ to, subject: `Holiday: ${name} — ${fmtDate(date)}`, html });
};


// ─── SHIFT CHANGED ────────────────────────────────────────────
const notifyShiftChanged = async (to, { employeeName, shiftLabel, startTime, endTime, graceMinutes, halfDayAfterMinutes, changedBy }) => {
    const html = template(`
        <!-- Header -->
        <div style="text-align:center;margin-bottom:28px;">
            <div style="width:56px;height:56px;background:#e8eaf6;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:12px;">🕐</div>
            <h2 style="margin:0;font-size:22px;font-weight:700;color:#0f172a;">Shift Timing Updated</h2>
            <p style="margin:6px 0 0;font-size:14px;color:#64748b;">Your shift schedule has been changed by HR.</p>
        </div>

        <p style="font-size:15px;color:#334155;line-height:1.7;margin:0 0 20px;">
            Hi <strong style="color:#0f172a;">${employeeName}</strong>, your shift timing has been updated. Please find the new details below.
        </p>

        <!-- Shift Details Box -->
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin:0 0 24px;">
            <div style="background:#e8eaf6;padding:10px 18px;border-bottom:1px solid #e2e8f0;">
                <p style="margin:0;font-size:11px;font-weight:700;color:#3949ab;text-transform:uppercase;letter-spacing:0.8px;">📋 New Shift Details</p>
            </div>

            <div style="display:flex;align-items:center;padding:14px 18px;border-bottom:1px solid #f1f5f9;">
                <div style="width:36px;height:36px;background:#e8eaf6;border-radius:8px;display:inline-block;text-align:center;line-height:36px;font-size:16px;flex-shrink:0;">🏷️</div>
                <div style="margin-left:14px;">
                    <p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Shift Name</p>
                    <p style="margin:2px 0 0;font-size:14px;font-weight:600;color:#0f172a;">${shiftLabel || "Custom Shift"}</p>
                </div>
            </div>

            <div style="display:flex;align-items:center;padding:14px 18px;border-bottom:1px solid #f1f5f9;">
                <div style="width:36px;height:36px;background:#e8eaf6;border-radius:8px;display:inline-block;text-align:center;line-height:36px;font-size:16px;flex-shrink:0;">🌅</div>
                <div style="margin-left:14px;">
                    <p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Shift Start</p>
                    <p style="margin:2px 0 0;font-size:14px;font-weight:600;color:#0f172a;">${startTime}</p>
                </div>
            </div>

            <div style="display:flex;align-items:center;padding:14px 18px;border-bottom:1px solid #f1f5f9;">
                <div style="width:36px;height:36px;background:#e8eaf6;border-radius:8px;display:inline-block;text-align:center;line-height:36px;font-size:16px;flex-shrink:0;">🌆</div>
                <div style="margin-left:14px;">
                    <p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Shift End</p>
                    <p style="margin:2px 0 0;font-size:14px;font-weight:600;color:#0f172a;">${endTime}</p>
                </div>
            </div>

            <div style="display:flex;align-items:center;padding:14px 18px;border-bottom:1px solid #f1f5f9;">
                <div style="width:36px;height:36px;background:#e8eaf6;border-radius:8px;display:inline-block;text-align:center;line-height:36px;font-size:16px;flex-shrink:0;">⏱️</div>
                <div style="margin-left:14px;">
                    <p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Late Grace Window</p>
                    <p style="margin:2px 0 0;font-size:14px;font-weight:600;color:#0f172a;">${graceMinutes} minutes after shift start</p>
                </div>
            </div>

            <div style="display:flex;align-items:center;padding:14px 18px;border-bottom:1px solid #f1f5f9;">
                <div style="width:36px;height:36px;background:#e8eaf6;border-radius:8px;display:inline-block;text-align:center;line-height:36px;font-size:16px;flex-shrink:0;">📊</div>
                <div style="margin-left:14px;">
                    <p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Half-Day Threshold</p>
                    <p style="margin:2px 0 0;font-size:14px;font-weight:600;color:#0f172a;">${halfDayAfterMinutes} minutes after shift start</p>
                </div>
            </div>

            <div style="display:flex;align-items:center;padding:14px 18px;">
                <div style="width:36px;height:36px;background:#e8eaf6;border-radius:8px;display:inline-block;text-align:center;line-height:36px;font-size:16px;flex-shrink:0;">👤</div>
                <div style="margin-left:14px;">
                    <p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Updated By</p>
                    <p style="margin:2px 0 0;font-size:14px;font-weight:600;color:#0f172a;">${changedBy || "HR"}</p>
                </div>
            </div>
        </div>

        <!-- Login Button -->
        <div style="text-align:center;margin:0 0 24px;">
            <a href="https://wwlhrms.digitalwebguider.com"
               style="display:inline-block;background:#1a237e;color:#ffffff;font-size:15px;font-weight:600;padding:13px 36px;border-radius:8px;text-decoration:none;letter-spacing:0.3px;">
                View in HRMS →
            </a>
        </div>

        <!-- Note -->
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px 16px;display:flex;align-items:flex-start;gap:10px;">
            <span style="font-size:16px;line-height:1.4;flex-shrink:0;">ℹ️</span>
            <p style="margin:0;font-size:13px;color:#0c4a6e;line-height:1.6;">
                This change is effective immediately. Please ensure you adjust your schedule accordingly.
                Contact HR if you have any questions.
            </p>
        </div>
    `);

    return await sendMail({
        to,
        subject: `Your Shift Timing Has Been Updated — ${shiftLabel || "New Shift"}`,
        html,
    });
};

module.exports = {
    notifyWelcome,
    notifyPayrollGenerated,
    notifyPersonalPayslip,
    notifyLeaveApplied,
    notifyLeaveApproved,
    notifyLeaveRejected,
    notifyAnnouncement,
    notifyNewEmployee,
    notifyHoliday,
    notifyShiftChanged,
};