const User = require("../models/user.model");
const Leave = require("../models/leave.model");
const Attendance = require("../models/attendance.model");
const Payroll = require("../models/payroll.model");
const SalesReport = require("../models/sales.report.model");
const Ticket = require("../models/ticket.model");
const { lookupIFSC } = require("../utils/validators/bankDetails.validator");
const { isRelevantQuestion } = require("../ai/utils/questionFilter");

// ── AI module imports ─────────────────────────────────────────────────────────
const {
    MONTHS, DAYS,
    formatDate, formatTime, formatCurrency,
    todayStart, getNextWeekend,
    has, any, extractMonth,
} = require("../ai/utils/helpers");

const normalizeQuery = require("../ai/utils/normalizeQuery");
const { buildResponse } = require("../ai/utils/responseBuilder");
const { isPrivileged, isHRLevel } = require("../ai/security/roleGuards");
const { isInjectionAttempt } = require("../ai/security/promptInjection");
const { getOrCreateSession, clearIntent, setIntent } = require("../ai/memory/session.memory");
const { saveUnanswered } = require("../ai/memory/unanswered.memory");
const searchKB = require("../ai/rag/searchKB");
const detectIntent = require("../ai/intentEngine");
const askOllama = require("../ai/services/ollama.service");

// ═════════════════════════════════════════════════════════════════════════════
// PATTERN REGISTRIES
// (kept here — thin detection layer, not business logic)
// ═════════════════════════════════════════════════════════════════════════════

const NAME_STOPWORDS = new Set([
    "a", "an", "the", "is", "in", "on", "at", "to", "of", "or", "and",
    "for", "with", "from", "by", "be", "been", "was", "are", "were",
    "he", "she", "it", "they", "we", "you", "i", "me", "my", "our",
    "there", "here", "who", "what", "which", "how", "when", "where",
    "that", "this", "these", "those", "not", "no", "yes", "any",
]);

const extractName = (question) => {
    const match = question.match(
        /(?:named?|called|who\s+is|is\s+([a-zA-Z]+)\s+(?:punch|punched|present|here|an?\s+employee)|employee\s+named?|search|find)\s+([a-zA-Z]+)/i
    );
    const whoIs = question.match(/^who\s+is\s+([a-zA-Z]+)\??$/i);
    const name = whoIs ? whoIs[1] : (match ? match[2] || match[1] : null);
    if (!name) return null;
    if (NAME_STOPWORDS.has(name.toLowerCase())) return null;
    return name;
};

// ── Personal-query detectors ──────────────────────────────────────────────────
const PERSONAL_PATTERNS = [
    /^(what|what'?s)\s+(is\s+)?my\s+/i,
    /^my\s+/i,
    /^(am\s+i|do\s+i|did\s+i|have\s+i)/i,
    /^(who\s+am\s+i)/i,
    /^(mera|meri|mujhe|main|mai)\s+/i,
    /^(show\s+me\s+my|tell\s+me\s+my)/i,
    /my\s+(name|email|phone|mobile|number|address|salary|role|department|dept|designation|tl|team\s*lead|manager|profile|details|dob|birthday|joining|experience|status)/i,
    /(which|what)\s+(company|organization|firm)\s+(am\s+i|i\s+am|do\s+i|i\s+work|im\s+work|i'm\s+work)/i,
    /kis\s+company/i, /meri\s+company/i, /kahan\s+kaam/i, /main\s+kis/i,
    /attendance/i, /payslip/i,
];
const isPersonalQuery = (q) => PERSONAL_PATTERNS.some((p) => p.test(q.trim()));

// ── Company-name detector ─────────────────────────────────────────────────────
const COMPANY_NAME_PATTERNS = [
    /^company\s*name/i, /^our\s+company\s*name/i,
    /^(what\s+is\s+(the|our|my)\s+)?company\s*name/i,
    /^(name\s+of\s+(the|our)\s+company)/i,
    /^(which|what)\s+company/i, /^(my|our)\s+company/i,
    /company\s+(i|we)\s+(work|am|are)\s+(in|for|at)/i,
    /meri\s+company\s+ka\s+naam/i, /company\s+ka\s+naam/i,
    /kis\s+company\s+mein/i, /hamari\s+company/i, /main\s+kis\s+company/i,
    /kahan\s+kaam\s+karta/i, /^office\s+name/i,
    /^(what\s+is\s+(the|our)\s+)?office\s*name/i,
    /where\s+(do\s+i|i)\s+work/i,
];
const isCompanyNameQuery = (q) => COMPANY_NAME_PATTERNS.some((p) => p.test(q.trim()));

// ── Office-hours detector ─────────────────────────────────────────────────────
const OFFICE_HOURS_PATTERNS = [
    /working\s+hours/i, /office\s+hours/i,
    /office\s+(open|close|opening|closing)/i,
    /^(punch\s+out\s+time|punch\s+in\s+time)$/i,
    /^(office\s+timing)/i, /^(office\s+time)/i,
    /when\s+does\s+(the\s+)?office\s+(open|close)/i,
    /^(lunch\s+time|lunch\s+break|break\s+time)$/i,
    /office\s+(lunch|break)/i,
    /^work\s+(timing|hours|schedule)$/i,
];
const isOfficeHoursQuery = (q) => OFFICE_HOURS_PATTERNS.some((p) => p.test(q.trim()));

// ── Ambiguous-query config ────────────────────────────────────────────────────
const AMBIGUOUS_QUERIES = [
    {
        pattern: /^address\??$|^(what is\s+)?address\??$/i,
        question: "📍 What address are you looking for?",
        options: ["My personal/home address", "Company office address"],
        intent: "clarify_address",
    },
    {
        pattern: /^contact\??$|^contact\s+(details|info|number|kya hai)?\??$/i,
        question: "📞 Whose contact information do you need?",
        options: ["My contact details", "Company contact info", "My TL / Manager contact"],
        intent: "clarify_contact",
    },
    {
        pattern: /^company\??$|^(about\s+)?company\??$/i,
        question: "🏢 What would you like to know about the company?",
        options: ["Company name & address", "Office timings", "Company contact info", "Company website"],
        intent: "clarify_company",
    },
    {
        pattern: /^salary\??$|^about\s+salary\??$|^salary\s+info\??$/i,
        question: "💰 Which salary information do you need?",
        options: ["My salary details", "My payslip / salary slip", "Team payroll summary"],
        intent: "clarify_salary",
    },
    {
        pattern: /^leave\??$|^about\s+leave\??$/i,
        question: "🌴 What leave information do you need?",
        options: ["My leave balance", "My leave history", "Who is on leave today", "Pending leave approvals"],
        intent: "clarify_leave",
    },
    {
        pattern: /^attendance\??$|^about\s+attendance\??$/i,
        question: "📊 Which attendance details do you want?",
        options: ["My punch status today", "My monthly attendance report", "Team attendance today"],
        intent: "clarify_attendance",
    },
    {
        pattern: /^profile\??$|^my\s+profile\??$|^about\s+me\??$/i,
        question: "👤 What profile info would you like to see?",
        options: ["Full profile details", "My department & designation", "My joining date & experience", "My bank details"],
        intent: "clarify_profile",
    },
];

// ── KB skip logic ─────────────────────────────────────────────────────────────
const isSalaryPersonalQuery = (q) => /my\s+salary|my\s+pay\b|my\s+ctc|payslip|pay\s+slip|net\s+(salary|pay)/i.test(q);
const isLeavePersonalQuery = (q) => /my\s+leave|leave\s+balance|leaves?\s+(remaining|left|bache)|applied\s+leave|leave\s+(history|status)|how\s+many\s+leaves?/i.test(q);
const isAttendancePersonalQuery = (q) => /punch\s*(in|out|time)|my\s+punch|did\s+i\s+punch|have\s+i\s+punch|am\s+i\s+late|my\s+(check\s*in|check\s*out)|today.?s\s+attendance|my\s+attendance|am\s+i\s+present/i.test(q);

// ── Dynamic answer placeholder replacer ──────────────────────────────────────
const parseDynamicAnswer = (text, user) =>
    text
        .replace(/{{name}}/g, user.name || "N/A")
        .replace(/{{email}}/g, user.email || "N/A")
        .replace(/{{phone}}/g, user.phone || "N/A")
        .replace(/{{address}}/g, user.address || "N/A")
        .replace(/{{tlName}}/g, user.reportingTo?.name || "Not Assigned");

// ═════════════════════════════════════════════════════════════════════════════
// MAIN CONTROLLER
// ═════════════════════════════════════════════════════════════════════════════
const askAI = async (req, res) => {
    try {
        // ── 0. Input validation ───────────────────────────────────────────────
        const { question } = req.body;

        if (!question || typeof question !== "string" || !question.trim())
            return res.status(400).json({ success: false, message: "Question is required." });

        if (question.trim().length > 500)
            return res.status(400).json({ success: false, message: "Question too long (max 500 characters)." });

        // ── 0-A. Prompt-injection guard ───────────────────────────────────────
        if (isInjectionAttempt(question)) {
            return res.json({
                success: true,
                answer: "⚠️ I can't help with that type of request.",
                source: "security",
            });
        }

        const q = normalizeQuery(question);
        const user = await User.findById(req.user._id)
            .populate("reportingTo", "name designation department phone email")
            .lean();

        if (!user) return res.status(404).json({ success: false, message: "User not found." });

        const session = await getOrCreateSession(user._id);
        const role = user.role;
        const dept = (user.department || "").toLowerCase().trim();

        // Privileged roles get their direct reports pre-fetched
        const team = isPrivileged(role)
            ? await User.find({ reportingTo: user._id })
                .select("name employeeId designation department phone email")
                .lean()
            : [];

        // ── 1. PENDING-INTENT / FOLLOW-UP ENGINE ─────────────────────────────
        if (session.pendingIntent) {

            // ─── clarify_address ─────────────────────────────────────────────
            if (session.pendingIntent === "clarify_address") {
                await clearIntent(session);
                if (/personal|my|home|mera|ghar|own|residential|permanent/i.test(q)) {
                    return res.json(buildResponse(
                        user.address
                            ? `🏠 Your registered address:\n${user.address}`
                            : "🏠 No address found on your profile. Please contact HR to update it.",
                        "db", "profile"
                    ));
                }
                return res.json(buildResponse(
                    `📍 **World WebLogic Office Address:**\n\nB 108, 1st Floor, Office No. 2nd,\nSector 63, Noida – 201301, India\n\n🗺️ Near Sector 62 Metro Station`,
                    "db"
                ));
            }

            // ─── clarify_contact ─────────────────────────────────────────────
            if (session.pendingIntent === "clarify_contact") {
                await clearIntent(session);
                if (/my|personal|own|mera/i.test(q)) {
                    return res.json(buildResponse(
                        `📞 Your contact details:\n\n• Phone: ${user.phone || "Not set"}\n• Email: ${user.email}`,
                        "db", "profile"
                    ));
                }
                if (/tl|manager|lead|supervisor|reporting/i.test(q)) {
                    if (user.reportingTo) {
                        const m = user.reportingTo;
                        return res.json(buildResponse(
                            `👨‍💼 Your Manager's Contact:\n\n• Name: ${m.name}\n• Phone: ${m.phone || "—"}\n• Email: ${m.email || "—"}`,
                            "db"
                        ));
                    }
                    return res.json(buildResponse("No reporting manager assigned. Please contact HR.", "db"));
                }
                return res.json(buildResponse(
                    `📞 **World WebLogic Contact Info:**\n\n• Phone: +91 120-4545733\n• Mobile: +91 85058 37801\n• US: +1 (310) 807-2867\n• Email: info@worldweblogic.com\n• Website: https://www.worldweblogic.com`,
                    "db"
                ));
            }

            // ─── clarify_company ─────────────────────────────────────────────
            if (session.pendingIntent === "clarify_company") {
                await clearIntent(session);
                if (/address|location|where/i.test(q))
                    return res.json(buildResponse(
                        `📍 **World WebLogic Office Address:**\n\nB 108, 1st Floor, Office No. 2nd,\nSector 63, Noida – 201301, India`,
                        "db"
                    ));
                if (/timing|hours|open|close|time/i.test(q))
                    return res.json(buildResponse(
                        `🕙 **Office Timings:**\n\n• Opens: 10:00 AM\n• Closes: 7:00 PM\n• Working Days: Monday – Friday\n• Weekend: Saturday & Sunday OFF`,
                        "db"
                    ));
                if (/contact|phone|email|number/i.test(q))
                    return res.json(buildResponse(
                        `📞 **World WebLogic Contact:**\n\n• Phone: +91 120-4545733\n• Email: info@worldweblogic.com\n• Website: https://www.worldweblogic.com`,
                        "db"
                    ));
                if (/website|web|url|link/i.test(q))
                    return res.json(buildResponse(
                        `🌐 **World WebLogic Website:**\nhttps://www.worldweblogic.com`,
                        "db"
                    ));
                return res.json(buildResponse(
                    `🏢 **World WebLogic:**\n\n• Website: https://www.worldweblogic.com\n• Address: B 108, 1st Floor, Sector 63, Noida – 201301\n• Phone: +91 120-4545733\n• Email: info@worldweblogic.com\n• Hours: Mon–Fri, 10:00 AM – 7:00 PM`,
                    "db"
                ));
            }

            // ─── clarify_salary ──────────────────────────────────────────────
            if (session.pendingIntent === "clarify_salary") {
                await clearIntent(session);
                if (/payslip|slip|download|monthly slip/i.test(q)) {
                    await setIntent(session, "payroll_month");
                    return res.json(buildResponse(
                        "📅 Which month's salary slip would you like?\n(e.g. January, February, March...)",
                        "db", "payslip"
                    ));
                }
                if (/team|all|payroll|summary/i.test(q) && isHRLevel(role)) {
                    const now = new Date();
                    const payrolls = await Payroll.find({ month: now.getMonth() + 1, year: now.getFullYear() }).lean();
                    const total = payrolls.reduce((s, p) => s + (p.netSalary || 0), 0);
                    return res.json(buildResponse(
                        `💼 ${MONTHS[now.getMonth()]} ${now.getFullYear()} Payroll:\n\n• Total: **${formatCurrency(total)}**\n• Paid: ${payrolls.filter((p) => p.status === "paid").length} | Pending: ${payrolls.filter((p) => p.status === "draft").length}`,
                        "db", "payroll"
                    ));
                }
                if (role === "employee" && !user.canViewSalary)
                    return res.json(buildResponse("🔒 Salary not released by HR yet. Please contact HR.", "db"));
                return res.json(buildResponse(
                    `💰 Your Salary:\n\n• Monthly: **${formatCurrency(user.salary?.monthly)}**\n• Per Day: ${formatCurrency(user.salary?.perDay)}`,
                    "db", "salary", "payslip"
                ));
            }

            // ─── clarify_leave ───────────────────────────────────────────────
            if (session.pendingIntent === "clarify_leave") {
                await clearIntent(session);
                if (/balance|remaining|left|kitne/i.test(q)) {
                    const used = user.leaveBalance?.used || 0, total = user.leaveBalance?.total || 0;
                    return res.json(buildResponse(
                        `📋 Leave Balance:\n\n• Total: ${total} | Used: ${used} | **Remaining: ${total - used}**`,
                        "db", "leaves"
                    ));
                }
                if (/history|applied|past|request/i.test(q)) {
                    await setIntent(session, "leave_month");
                    return res.json(buildResponse(
                        "📅 Which month's leave history would you like? (e.g. April, May...)",
                        "db", "leaves"
                    ));
                }
                if (/who|on leave|today|absent/i.test(q)) {
                    const today = new Date();
                    const sod = new Date(today); sod.setHours(0, 0, 0, 0);
                    const eod = new Date(today); eod.setHours(23, 59, 59, 999);
                    const onLeave = await Leave.find({
                        status: "approved",
                        fromDate: { $lte: eod },
                        toDate: { $gte: sod },
                    }).populate("user", "name employeeId department designation").lean();
                    return res.json(buildResponse(
                        onLeave.length
                            ? `🌴 On leave today (${onLeave.length}):\n\n${onLeave.map((l) => `• ${l.user.name} (${l.user.department || "—"}) – ${l.type.toUpperCase()}`).join("\n")}`
                            : "✅ No employees on approved leave today.",
                        "db", "leaves"
                    ));
                }
                if (/pending|approve|approval/i.test(q) && isPrivileged(role)) {
                    const query = isHRLevel(role)
                        ? { status: "pending" }
                        : { user: { $in: team.map((t) => t._id) }, status: "pending" };
                    const pending = await Leave.find(query).populate("user", "name employeeId department").lean();
                    return res.json(buildResponse(
                        pending.length
                            ? `📋 Pending approvals (${pending.length}):\n\n${pending.map((l) => `• ${l.user.name} | ${l.type.toUpperCase()} | ${new Date(l.fromDate).toDateString()}`).join("\n")}`
                            : "✅ No pending leave requests.",
                        "db", "leaves"
                    ));
                }
                const used = user.leaveBalance?.used || 0, total = user.leaveBalance?.total || 0;
                return res.json(buildResponse(
                    `📋 Leave Balance:\n\n• Total: ${total} | Used: ${used} | **Remaining: ${total - used}**`,
                    "db", "leaves"
                ));
            }

            // ─── clarify_attendance ──────────────────────────────────────────
            if (session.pendingIntent === "clarify_attendance") {
                await clearIntent(session);
                if (/today|now|current|punch|present/i.test(q)) {
                    const att = await Attendance.findOne({ user: user._id, date: { $gte: todayStart() } }).lean();
                    if (!att) return res.json(buildResponse("❌ You have not punched in today.", "db", "attendance"));
                    const pIn = att.punchIn ? formatTime(new Date(att.punchIn)) : "—";
                    const pOut = att.punchOut ? formatTime(new Date(att.punchOut)) : "Not yet";
                    return res.json(buildResponse(
                        `📋 Today's Attendance:\n\n• Punch In: **${pIn}**\n• Punch Out: **${pOut}**\n• Status: ${att.isLate ? "⏰ Late" : "✅ On time"}\n• Work Hours: ${att.workHours || 0}h`,
                        "db", "attendance"
                    ));
                }
                if (/monthly|month|report|summary/i.test(q)) {
                    await setIntent(session, "attendance_month");
                    return res.json(buildResponse(
                        "📅 Which month's attendance would you like? (e.g. April, May...)",
                        "db", "attendance"
                    ));
                }
                if (/team|who|absent|present/i.test(q) && isPrivileged(role)) {
                    const teamIds = team.map((t) => t._id);
                    const todayAtt = await Attendance.find({ user: { $in: teamIds }, date: { $gte: todayStart() } })
                        .populate("user", "name employeeId").lean();
                    const presentIds = new Set(todayAtt.map((a) => a.user._id.toString()));
                    const absent = team.filter((t) => !presentIds.has(t._id.toString()));
                    return res.json(buildResponse(
                        `👥 Team today (${team.length} members):\n\n• Present: ${todayAtt.length}\n• Absent/not punched: ${absent.length}` +
                        (absent.length ? `\n\n${absent.map((t) => `• ${t.name}`).join("\n")}` : ""),
                        "db", "attendance"
                    ));
                }
                const att = await Attendance.findOne({ user: user._id, date: { $gte: todayStart() } }).lean();
                return res.json(buildResponse(
                    att
                        ? `✅ You punched in today at **${formatTime(new Date(att.punchIn))}**.`
                        : "❌ Not punched in today.",
                    "db", "attendance"
                ));
            }

            // ─── clarify_profile ─────────────────────────────────────────────
            if (session.pendingIntent === "clarify_profile") {
                await clearIntent(session);
                if (/bank|account|ifsc/i.test(q)) {
                    const b = user.bankDetails;
                    return res.json(buildResponse(
                        b?.bankName
                            ? `🏦 Bank Details:\n\n• Bank: ${b.bankName}\n• Account: ••••${b.accountNumber?.slice(-4) || "—"}\n• IFSC: ${b.ifscCode || "—"}\n• Branch: ${b.branchName || "—"}`
                            : "No bank details on record. Please contact HR.",
                        "db", "bank"
                    ));
                }
                if (/department|designation|role|position/i.test(q))
                    return res.json(buildResponse(
                        `🏢 Your Work Details:\n\n• Department: ${user.department || "—"}\n• Designation: ${user.designation || "—"}\n• Role: ${user.role}\n• Employment Type: ${user.employmentType || "—"}`,
                        "db", "profile"
                    ));
                if (/joining|experience|tenure|years/i.test(q)) {
                    if (user.joiningDate) {
                        const diff = Date.now() - new Date(user.joiningDate).getTime();
                        const years = Math.floor(diff / (1000 * 60 * 60 * 24 * 365));
                        const months = Math.floor((diff % (1000 * 60 * 60 * 24 * 365)) / (1000 * 60 * 60 * 24 * 30));
                        return res.json(buildResponse(
                            `📅 Joined: **${new Date(user.joiningDate).toDateString()}**\nTenure: ${years > 0 ? `${years} year(s) and ${months} month(s)` : `${months} month(s)`}`,
                            "db", "profile"
                        ));
                    }
                    return res.json(buildResponse("Joining date not available. Contact HR.", "db"));
                }
                // Full profile
                const lines = [
                    `👤 **Your Profile**\n`,
                    `• Name: ${user.name}`,
                    `• Employee ID: ${user.employeeId}`,
                    `• Email: ${user.email}`,
                    `• Phone: ${user.phone || "—"}`,
                    `• Role: ${user.role}`,
                    `• Designation: ${user.designation || "—"}`,
                    `• Department: ${user.department || "—"}`,
                    `• Status: ${user.status}`,
                    user.joiningDate ? `• Joined: ${new Date(user.joiningDate).toDateString()}` : null,
                    user.reportingTo ? `• Reports To: ${user.reportingTo.name}` : null,
                ].filter(Boolean).join("\n");
                return res.json(buildResponse(lines, "db", "profile"));
            }

            // ─── leave_month context ─────────────────────────────────────────
            if (session.pendingIntent === "leave_month") {
                const monthIndex = extractMonth(question);
                if (monthIndex !== null) {
                    const year = new Date().getFullYear();
                    const start = new Date(year, monthIndex, 1);
                    const end = new Date(year, monthIndex + 1, 0);
                    const leaves = await Leave.find({ user: user._id, fromDate: { $gte: start, $lte: end } }).lean();
                    await clearIntent(session);
                    return res.json(buildResponse(
                        leaves.length
                            ? `📋 Your leave records for ${MONTHS[monthIndex]}:\n\n` +
                            leaves.map((l) =>
                                `• ${l.type.toUpperCase()} leave\n  📅 ${new Date(l.fromDate).toDateString()} → ${new Date(l.toDate).toDateString()}\n  Days: ${l.totalDays} | Status: ${l.status}`
                            ).join("\n\n")
                            : `No leave records found for ${MONTHS[monthIndex]}.`,
                        "db", "leaves"
                    ));
                }
                return res.json(buildResponse("📅 Please tell me a valid month name (e.g. April, May, June).", "db"));
            }

            // ─── attendance_month context ────────────────────────────────────
            if (session.pendingIntent === "attendance_month") {
                const monthIndex = extractMonth(question);
                if (monthIndex !== null) {
                    const year = new Date().getFullYear();
                    const start = new Date(year, monthIndex, 1);
                    const end = new Date(year, monthIndex + 1, 0);
                    const attendance = await Attendance.find({ user: user._id, date: { $gte: start, $lte: end } }).lean();
                    await clearIntent(session);
                    const present = attendance.filter((r) => r.status === "present" && !r.isHalfDay).length;
                    const halfDay = attendance.filter((r) => r.isHalfDay).length;
                    const late = attendance.filter((r) => r.isLate).length;
                    const absent = attendance.filter((r) => r.status === "absent").length;
                    const totalWork = attendance.reduce((s, r) => s + (r.workHours || 0), 0);
                    return res.json(buildResponse(
                        `📊 Attendance for ${MONTHS[monthIndex]}:\n\n` +
                        `✅ Present: ${present} day(s)\n🌗 Half-days: ${halfDay}\n⏰ Late arrivals: ${late}\n❌ Absent: ${absent}\n🕐 Total work hours: ${totalWork.toFixed(1)}h`,
                        "db", "attendance"
                    ));
                }
                return res.json(buildResponse("📅 Which month's attendance? (e.g. April, May)", "db"));
            }

            // ─── payroll_month context ───────────────────────────────────────
            if (session.pendingIntent === "payroll_month") {
                const monthIndex = extractMonth(question);
                if (monthIndex !== null) {
                    const payroll = await Payroll.findOne({
                        employee: user._id,
                        month: monthIndex + 1,
                        year: new Date().getFullYear(),
                    }).lean();
                    await clearIntent(session);
                    return res.json(buildResponse(
                        payroll
                            ? `💰 ${MONTHS[monthIndex]} Salary Slip:\n\n` +
                            `• Gross: ₹${payroll.grossSalary?.toLocaleString("en-IN")}\n` +
                            `• Deductions: ₹${(payroll.grossSalary - payroll.netSalary)?.toLocaleString("en-IN") || 0}\n` +
                            `• Net Salary: ₹${payroll.netSalary?.toLocaleString("en-IN")}\n` +
                            `• Present Days: ${payroll.presentDays}\n` +
                            `• Half Days: ${payroll.halfDays}\n` +
                            `• Status: ${payroll.status}`
                            : `No payroll found for ${MONTHS[monthIndex]}. Contact HR if this seems wrong.`,
                        "db", "payslip", "salary"
                    ));
                }
                return res.json(buildResponse("📅 Which month's salary slip? (e.g. March, April)", "db"));
            }
        }

        // ── 2. AMBIGUOUS QUERY CLARIFICATION ─────────────────────────────────
        for (const cfg of AMBIGUOUS_QUERIES) {
            if (cfg.pattern.test(q)) {
                await setIntent(session, cfg.intent, { ambiguousKey: cfg.intent });
                return res.json({
                    success: true,
                    answer: cfg.question,
                    options: cfg.options,
                    source: "clarify",
                });
            }
        }

        // ── 3. COMPANY NAME ───────────────────────────────────────────────────
        if (isCompanyNameQuery(question)) {
            return res.json(buildResponse(
                `🏢 You are working at **World WebLogic**.\n\n` +
                `🌐 Website: https://www.worldweblogic.com\n` +
                `📍 Address: B 108, 1st Floor, Sector 63, Noida – 201301\n` +
                `📞 Phone: +91 120-4545733\n` +
                `📧 Email: info@worldweblogic.com`,
                "db"
            ));
        }

        // ── 4. OFFICE HOURS ───────────────────────────────────────────────────
        if (isOfficeHoursQuery(q)) {
            if (/lunch/i.test(q))
                return res.json(buildResponse(
                    `🍽️ Lunch Break:\n\n• Lunch time: 2:00 PM – 2:30 PM\n• Office hours: Mon–Fri, 10:00 AM – 7:00 PM`,
                    "db"
                ));
            return res.json(buildResponse(
                `🕙 World WebLogic Office Timings:\n\n• Opens: 10:00 AM\n• Closes: 7:00 PM\n• Working Days: Monday – Friday\n• Weekend: Saturday & Sunday OFF`,
                "db"
            ));
        }

        // ── 5. EMPLOYEE SEARCH (privileged only) ──────────────────────────────
        if (
            /\b(find|search|is there|employee named?|named?|called|look up)\b/i.test(question) ||
            /is\s+[a-zA-Z]+\s+(an?\s+employee|here|present|punch)/i.test(question) ||
            /\b(kaun hai|kon hai)\b/i.test(question)
        ) {
            const searchName = extractName(question);
            if (searchName) {
                const found = await User.find({
                    name: new RegExp(searchName, "i"),
                    status: "active",
                }).select("name employeeId designation department phone email role").lean();
                return res.json(buildResponse(
                    found.length
                        ? `🔍 Found ${found.length} employee(s) matching "${searchName}":\n\n${found
                            .map((e) => `• ${e.name} | ${e.designation || "—"} | ${e.department || "—"} | ${e.phone || "—"} (ID: ${e.employeeId})`)
                            .join("\n")}`
                        : `No active employee found with the name "${searchName}". Try checking the employee directory.`,
                    "db", "employees"
                ));
            }
        }

        // ── 6. COMPANY KNOWLEDGE BASE (RAG) ──────────────────────────────────
        const shouldSkipKB =
            isPersonalQuery(question) ||
            isAttendancePersonalQuery(q) ||
            isLeavePersonalQuery(q) ||
            isSalaryPersonalQuery(q);

        if (!shouldSkipKB) {
            const kb = await searchKB(question);
            if (kb) {
                return res.json({
                    success: true,
                    answer: parseDynamicAnswer(kb.answer, user),
                    source: "kb",
                });
            }
        }

        // ── 7. DATE / TIME / CALENDAR ─────────────────────────────────────────
        let answer = null;

        if (any(q, "today date", "current date", "what date", "aaj date", "date today",
            "what is the date", "aaj ka date") || q === "date") {
            answer = `📅 Today is ${formatDate(new Date())}.`;

        } else if (any(q, "current time", "what time", "time now", "kitne baje", "what is the time")) {
            answer = `🕐 Current time is ${formatTime(new Date())} (IST).`;

        } else if (any(q, "today day", "what day", "which day", "aaj kya din", "what is today")) {
            const now = new Date();
            answer = `📅 Today is ${DAYS[now.getDay()]}, ${formatDate(now)}.`;

        } else if (any(q, "next weekend", "upcoming weekend", "when is weekend")) {
            const { sat, sun } = getNextWeekend();
            answer = `🎉 Next weekend:\n• Saturday: ${formatDate(sat)}\n• Sunday: ${formatDate(sun)}`;

        } else if (has(q, "this week") || has(q, "current week")) {
            const now = new Date();
            const mon = new Date(now);
            mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
            const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
            answer = `📅 Current week: ${formatDate(mon)} → ${formatDate(sun)}`;

        } else if (has(q, "this month") || has(q, "current month")) {
            const now = new Date();
            answer = `📅 Current month: ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
        }

        if (answer) return res.json({ success: true, answer, source: "db" });

        // ── 8. INTENT ENGINE ──────────────────────────────────────────────────
        const matchedIntent = detectIntent(q);
        if (matchedIntent) {
            const response = await matchedIntent.handler({
                q,
                question,
                user,
                role,
                dept,
                team,
                session,
                buildResponse,
            });
            return res.json(response);
        }

        // ── 9. INLINE HANDLERS (not yet extracted to intent files) ────────────
        //
        //  These will move to their own intent files in the next refactor phase.
        //  Kept here temporarily so nothing breaks during migration.

        // ── My profile fields ─────────────────────────────────────────────────
        if (any(q, "my name", "what is my name", "who am i", "mera naam")) {
            return res.json({ success: true, answer: `👤 Your name is **${user.name}**.`, source: "db" });
        }
        if (any(q, "my email", "my mail", "meri email")) {
            return res.json({ success: true, answer: `📧 Your email address is **${user.email}**.`, source: "db" });
        }
        if (any(q, "my phone", "my number", "my mobile", "mera number")) {
            return res.json({ success: true, answer: user.phone ? `📞 Your phone number is **${user.phone}**.` : "📞 No phone number on record.", source: "db" });
        }
        if (any(q, "my address", "my home address", "mera address")) {
            return res.json({ success: true, answer: user.address ? `🏠 Your registered address:\n${user.address}` : "🏠 No address found. Please contact HR.", source: "db" });
        }
        if (any(q, "my role", "my position", "what is my role", "mera role")) {
            return res.json({ success: true, answer: `💼 Your role is **${user.role}**${user.designation ? ` (${user.designation})` : ""}.`, source: "db" });
        }
        if (any(q, "my department", "which department", "mera department")) {
            return res.json({ success: true, answer: `🏢 You are in the **${user.department || "—"}** department.`, source: "db" });
        }
        if (any(q, "my designation", "my title", "job title")) {
            return res.json({ success: true, answer: `🏷️ Your designation is **${user.designation || "Not set"}**.`, source: "db" });
        }
        if (any(q, "my joining date", "when did i join", "joining date")) {
            return res.json({ success: true, answer: user.joiningDate ? `📅 You joined World WebLogic on **${new Date(user.joiningDate).toDateString()}**.` : "📅 Joining date not available. Please contact HR.", source: "db" });
        }
        if (any(q, "my experience", "how long i work", "my tenure", "kitne saal")) {
            if (user.joiningDate) {
                const diff = Date.now() - new Date(user.joiningDate).getTime();
                const years = Math.floor(diff / (1000 * 60 * 60 * 24 * 365));
                const months = Math.floor((diff % (1000 * 60 * 60 * 24 * 365)) / (1000 * 60 * 60 * 24 * 30));
                const days = Math.floor((diff % (1000 * 60 * 60 * 24 * 30)) / (1000 * 60 * 60 * 24));
                const tenure = years > 0
                    ? `${years} year(s) and ${months} month(s)`
                    : `${months} month(s) and ${days} day(s)`;
                return res.json({ success: true, answer: `🗓️ You have been at World WebLogic for **${tenure}** (since ${new Date(user.joiningDate).toDateString()}).`, source: "db" });
            }
            return res.json({ success: true, answer: "Joining date not on record. Please contact HR.", source: "db" });
        }
        if (any(q, "my dob", "my birthday", "date of birth", "mera birthday")) {
            if (user.dob) {
                const parsed = new Date(user.dob);
                return res.json({ success: true, answer: !isNaN(parsed.getTime()) ? `🎂 Your date of birth is **${parsed.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}**.` : `🎂 Your date of birth is ${user.dob}.`, source: "db" });
            }
            return res.json({ success: true, answer: "Date of birth not available. Please contact HR.", source: "db" });
        }
        if (any(q, "my tl", "my team lead", "my manager", "who do i report", "mera manager")) {
            if (user.reportingTo) {
                const m = user.reportingTo;
                return res.json({ success: true, answer: `👨‍💼 Your Reporting Manager:\n\n• Name: ${m.name}\n• Designation: ${m.designation || "—"}\n• Department: ${m.department || "—"}\n• Email: ${m.email || "—"}\n• Phone: ${m.phone || "—"}`, source: "db" });
            }
            return res.json({ success: true, answer: "No reporting manager assigned yet. Please contact HR.", source: "db" });
        }

        // ── HR: employee count ────────────────────────────────────────────────
        if (any(q, "total employee", "how many employee", "employee count", "kitne employee")) {
            const counts = await User.aggregate([
                { $match: { status: "active" } },
                { $group: { _id: "$department", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]);
            const total = counts.reduce((s, d) => s + d.count, 0);
            const deptLines = counts.map((d) => `  • ${d._id || "Unassigned"}: ${d.count}`).join("\n");
            return res.json(buildResponse(`👥 Total active employees: **${total}**\n\nBy department:\n${deptLines}`, "db", "employees"));
        }

        // ── HR: departments ───────────────────────────────────────────────────
        if (any(q, "total department", "how many department", "department list", "all department")) {
            const depts = await User.distinct("department", { status: "active" });
            const filtered = depts.filter(Boolean).sort();
            return res.json(buildResponse(`🏢 Active departments (${filtered.length}):\n${filtered.map((d) => `• ${d}`).join("\n")}`, "db", "employees"));
        }

        // ── Leave: who is on leave today ──────────────────────────────────────
        if (any(q, "who is on leave", "on leave today", "who took leave", "leave today", "kaun leave pe")) {
            const today = new Date();
            const sod = new Date(today); sod.setHours(0, 0, 0, 0);
            const eod = new Date(today); eod.setHours(23, 59, 59, 999);
            const onLeave = await Leave.find({ status: "approved", fromDate: { $lte: eod }, toDate: { $gte: sod } })
                .populate("user", "name employeeId department designation").lean();
            return res.json(buildResponse(
                onLeave.length
                    ? `🌴 Employees on approved leave today (${onLeave.length}):\n\n${onLeave.map((l) => `• ${l.user.name} (${l.user.employeeId})\n  Dept: ${l.user.department || "—"} | ${l.type.toUpperCase()}`).join("\n\n")}`
                    : "✅ No employees are on approved leave today.",
                "db", "leaves"
            ));
        }

        // ── Leave: pending approvals ──────────────────────────────────────────
        if (any(q, "total pending leave", "pending leaves", "leaves to approve", "leave approval") && isPrivileged(role)) {
            const query = isHRLevel(role)
                ? { status: "pending" }
                : { user: { $in: team.map((t) => t._id) }, status: "pending" };
            const pending = await Leave.find(query).populate("user", "name employeeId department").sort({ createdAt: -1 }).lean();
            const label = isHRLevel(role) ? "company-wide" : "in your team";
            return res.json(buildResponse(
                pending.length
                    ? `📋 Pending leave requests ${label} (${pending.length}):\n\n${pending.map((l) => `• ${l.user.name} (${l.user.department || "—"})\n  Type: ${l.type.toUpperCase()} | ${new Date(l.fromDate).toDateString()} → ${new Date(l.toDate).toDateString()} | ${l.totalDays} day(s)`).join("\n\n")}`
                    : `✅ No pending leave requests ${label}.`,
                "db", "leaves"
            ));
        }

        // ── Attendance: specific employee (privileged) ────────────────────────
        if (
            isPrivileged(role) &&
            (/is\s+[a-zA-Z]+\s+(punch|punched|checked in|present|here|came)/.test(q) ||
                /did\s+[a-zA-Z]+\s+(punch|come|check)/.test(q) ||
                any(q, "punch status of", "attendance of"))
        ) {
            const empNameMatch = question.match(
                /is\s+([a-zA-Z]+)\s+punch|is\s+([a-zA-Z]+)\s+present|did\s+([a-zA-Z]+)\s+punch|punch status of\s+([a-zA-Z]+)|attendance of\s+([a-zA-Z]+)/i
            );
            const searchName = empNameMatch
                ? empNameMatch[1] || empNameMatch[2] || empNameMatch[3] || empNameMatch[4] || empNameMatch[5]
                : null;
            if (searchName && !NAME_STOPWORDS.has(searchName.toLowerCase())) {
                const emp = await User.findOne({ name: new RegExp(searchName, "i"), status: "active" }).lean();
                if (!emp) {
                    return res.json({ success: true, answer: `No active employee found with the name "${searchName}".`, source: "db" });
                }
                const att = await Attendance.findOne({ user: emp._id, date: { $gte: todayStart() } }).lean();
                return res.json({
                    success: true, answer: att
                        ? `✅ **${emp.name}** has punched in today.\n\n• Punch in: ${formatTime(new Date(att.punchIn))}\n• Status: ${att.isLate ? "⏰ Late" : "✅ On time"}\n• Work hours so far: ${att.workHours || 0}h`
                        : `❌ **${emp.name}** has NOT punched in today.`,
                    source: "db"
                });
            }
        }

        // ── Attendance: company-wide punch summary ────────────────────────────
        if (any(q, "total punch", "how many punched", "who punched", "punch in today", "total attendance today", "company attendance today")) {
            if (isPrivileged(role)) {
                const todayRecords = await Attendance.find({ date: { $gte: todayStart() } }).populate("user", "name employeeId department").lean();
                const totalEmp = await User.countDocuments({ status: "active" });
                const late = todayRecords.filter((r) => r.isLate).length;
                const onTime = todayRecords.length - late;
                const notPunched = totalEmp - todayRecords.length;
                const sample = todayRecords.slice(0, 5)
                    .map((r) => `  • ${r.user?.name || "—"} (${r.user?.department || "—"}) — ${r.isLate ? "⏰ Late" : "✅ On time"}`)
                    .join("\n");
                return res.json(buildResponse(
                    `📊 Today's Attendance Summary:\n\n• Total active employees: ${totalEmp}\n• Punched in: ${todayRecords.length}\n  ✅ On time: ${onTime} | ⏰ Late: ${late}\n• Not punched in yet: ${notPunched}` +
                    (todayRecords.length ? `\n\nRecent check-ins:\n${sample}` : ""),
                    "db", "attendance"
                ));
            }
        }

        // ── Attendance: monthly report (own) ──────────────────────────────────
        if (any(q, "my attendance", "attendance report", "attendance summary", "monthly attendance", "present days", "absent days", "late days")) {
            await setIntent(session, "attendance_month");
            return res.json(buildResponse("📅 Sure! Which month's attendance would you like to see?\n(e.g. January, February, March...)", "db", "attendance"));
        }

        // ── Attendance: team ──────────────────────────────────────────────────
        if (any(q, "team attendance", "who is absent", "who came today", "team present") && isPrivileged(role)) {
            const teamIds = team.map((t) => t._id);
            const todayAtt = await Attendance.find({ user: { $in: teamIds }, date: { $gte: todayStart() } }).populate("user", "name employeeId").lean();
            const presentIds = new Set(todayAtt.map((a) => a.user._id.toString()));
            const absent = team.filter((t) => !presentIds.has(t._id.toString()));
            return res.json(buildResponse(
                `👥 Team attendance today (${team.length} members):\n\n• Present: ${todayAtt.length}\n• Absent / not punched: ${absent.length}` +
                (absent.length ? `\n\nAbsent members:\n${absent.map((t) => `• ${t.name} (${t.employeeId})`).join("\n")}` : ""),
                "db", "attendance"
            ));
        }

        // ── HR: payroll summary ───────────────────────────────────────────────
        if (any(q, "team salary", "total payroll", "all salary", "payroll summary") && isHRLevel(role)) {
            const now = new Date();
            const payrolls = await Payroll.find({ month: now.getMonth() + 1, year: now.getFullYear() }).lean();
            const total = payrolls.reduce((s, p) => s + (p.netSalary || 0), 0);
            return res.json(buildResponse(
                `💰 ${MONTHS[now.getMonth()]} ${now.getFullYear()} Payroll Summary:\n\n• Total payout: **${formatCurrency(total)}**\n• Total employees: ${payrolls.length}\n• Paid: ${payrolls.filter((p) => p.status === "paid").length} | Draft/Pending: ${payrolls.filter((p) => p.status === "draft").length}`,
                "db", "payroll"
            ));
        }

        // ── Celebrations ──────────────────────────────────────────────────────
        if (any(q, "birthday", "anniversary", "celebration", "work anniversary")) {
            const today = new Date();
            const next30 = new Date(); next30.setDate(today.getDate() + 30);
            const users = await User.find({ status: "active" }).select("name dob joiningDate department").lean();
            const bdays = users.filter((u) => {
                if (!u.dob) return false;
                const b = new Date(u.dob); if (isNaN(b.getTime())) return false;
                b.setFullYear(today.getFullYear()); return b >= today && b <= next30;
            }).map((u) => `• ${u.name}${u.department ? ` (${u.department})` : ""} — ${new Date(u.dob).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`);
            const anniversaries = users.filter((u) => {
                if (!u.joiningDate) return false;
                const j = new Date(u.joiningDate); if (isNaN(j.getTime())) return false;
                j.setFullYear(today.getFullYear()); return j >= today && j <= next30;
            }).map((u) => {
                const years = today.getFullYear() - new Date(u.joiningDate).getFullYear();
                return `• ${u.name} — ${years} year(s) on ${new Date(u.joiningDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
            });
            return res.json(buildResponse(
                `🎉 Celebrations in the next 30 days:\n\n🎂 Birthdays (${bdays.length}):\n${bdays.length ? bdays.join("\n") : "None"}\n\n🥳 Work anniversaries (${anniversaries.length}):\n${anniversaries.length ? anniversaries.join("\n") : "None"}`,
                "db"
            ));
        }

        // ── Team members ──────────────────────────────────────────────────────
        if (any(q, "my team", "team members", "who reports to me", "my reportees") && isPrivileged(role)) {
            return res.json(buildResponse(
                team.length
                    ? `👥 Your team (${team.length} member${team.length > 1 ? "s" : ""}):\n\n${team.map((t) => `• ${t.name} (${t.employeeId})\n  ${t.designation || "—"} | ${t.department || "—"} | ${t.phone || "—"}`).join("\n\n")}`
                    : "No team members are reporting to you currently.",
                "db", "team"
            ));
        }

        // ── Department roster ─────────────────────────────────────────────────
        if (isPrivileged(role) && (/who is in\s+[a-zA-Z]/.test(q) || /employees in\s+[a-zA-Z]/.test(q) || any(q, "members in", "staff in", "team in"))) {
            const deptMatch = question.match(/(?:who is in|employees in|members in|staff in|team in)\s+([a-zA-Z][\w\s]*)/i);
            const deptName = deptMatch ? deptMatch[1].trim() : null;
            if (deptName) {
                const emps = await User.find({ department: new RegExp(deptName, "i"), status: "active" })
                    .select("name employeeId designation phone email").lean();
                return res.json(buildResponse(
                    emps.length
                        ? `👥 Employees in ${deptName} department (${emps.length}):\n\n${emps.map((e) => `• ${e.name} | ${e.designation || "—"} | ${e.phone || "—"} (${e.employeeId})`).join("\n")}`
                        : `No active employees found in "${deptName}" department.`,
                    "db", "employees"
                ));
            }
        }

        // ── HR: all open tickets ──────────────────────────────────────────────
        if (any(q, "all tickets", "open tickets", "pending tickets", "ticket overview", "critical ticket") && isHRLevel(role)) {
            const tickets = await Ticket.find({ status: { $in: ["open", "in-progress"] } }).populate("user", "name employeeId").lean();
            const byPriority = { critical: 0, high: 0, medium: 0, low: 0 };
            tickets.forEach((t) => { byPriority[t.priority] = (byPriority[t.priority] || 0) + 1; });
            return res.json(buildResponse(
                `🎫 Open/In-Progress Tickets: **${tickets.length}**\n\n• 🔴 Critical: ${byPriority.critical}\n• 🟠 High: ${byPriority.high}\n• 🟡 Medium: ${byPriority.medium}\n• 🟢 Low: ${byPriority.low}\n\nRecent:\n${tickets.slice(0, 8).map((t) => `• [${t.ticketId}] ${t.title} — ${t.user?.name || "—"} | ${t.priority}`).join("\n")}`,
                "db", "tickets"
            ));
        }

        // ── Sales leads ───────────────────────────────────────────────────────
        if (any(q, "my leads", "my sales", "sales status", "show leads") && dept === "sales") {
            const leads = await SalesReport.find({ user: user._id }).sort({ createdAt: -1 }).limit(5).lean();
            return res.json(buildResponse(
                leads.length
                    ? `📊 Your recent leads:\n\n${leads.map((l) => `• ${l.client_name} | ${l.status} | ${l.services} | ${l.country}`).join("\n")}`
                    : "No leads found.",
                "db", "leads"
            ));
        }
        if (any(q, "pending leads", "leads for approval", "approve lead") && ["manager", "superadmin"].includes(role)) {
            const leads = await SalesReport.find({ status: "sent_to_manager" }).populate("user", "name employeeId").lean();
            return res.json(buildResponse(
                leads.length
                    ? `📊 Leads pending approval (${leads.length}):\n\n${leads.map((l) => `• ${l.client_name} by ${l.user?.name || "—"} | ${l.services} | ${l.country}`).join("\n")}`
                    : "No leads pending your approval.",
                "db", "leads"
            ));
        }

        // ── Bank details ──────────────────────────────────────────────────────
        if (any(q, "my bank", "bank details", "bank account", "account number", "ifsc my")) {
            const b = user.bankDetails;
            if (!b || !b.bankName)
                return res.json(buildResponse("No bank details found on your account. Please update them in your profile settings.", "db", "bank"));
            return res.json(buildResponse(
                `🏦 Your Bank Details:\n\n• Account Holder: ${b.accountHolderName || "—"}\n• Bank: ${b.bankName}\n• Account Number: ${b.accountNumber ? "••••" + b.accountNumber.slice(-4) : "—"}\n• IFSC: ${b.ifscCode || "—"}\n• Branch: ${b.branchName || "—"}\n• Account Type: ${b.accountType || "—"}`,
                "db", "bank"
            ));
        }

        // ── Government IDs ────────────────────────────────────────────────────
        if (any(q, "my pan", "pan card", "pan number"))
            return res.json({ success: true, answer: user.governmentIds?.pan ? `📄 Your PAN: ${user.governmentIds.pan}` : "PAN not found on your account. Please contact HR.", source: "db" });

        if (any(q, "my aadhaar", "aadhaar number", "aadhar"))
            return res.json({ success: true, answer: user.governmentIds?.aadhaar ? "🪪 Your Aadhaar is on record (masked for security)." : "Aadhaar not found. Please contact HR.", source: "db" });

        // ── IFSC lookup ───────────────────────────────────────────────────────
        if (q.includes("ifsc")) {
            const ifscMatch = question.match(/[A-Z]{4}0[A-Z0-9]{6}/i);
            if (ifscMatch) {
                const result = await lookupIFSC(ifscMatch[0].toUpperCase());
                return res.json({
                    success: true, answer: result.valid && result.bankInfo
                        ? `🏦 IFSC ${ifscMatch[0].toUpperCase()}:\n• Bank: ${result.bankInfo.bank}\n• Branch: ${result.bankInfo.branch}\n• Location: ${result.bankInfo.city}, ${result.bankInfo.state}`
                        : result.message || "Invalid IFSC code.",
                    source: "db"
                });
            }
            return res.json({ success: true, answer: "Please provide a valid IFSC code (e.g. SBIN0001234).", source: "db" });
        }

        // ── Leave: own history (month prompt) ─────────────────────────────────
        if (any(q, "my leave", "leave history", "applied leave", "leave status", "my leaves", "leave request")) {
            await setIntent(session, "leave_month");
            return res.json(buildResponse("📅 Sure! Which month's leave records would you like to check?\n(e.g. January, February, March...)", "db", "leaves"));
        }

        // ── Greetings ─────────────────────────────────────────────────────────
        if (/^(hi+|hello|hey|good\s*morning|good\s*afternoon|good\s*evening|howdy|sup|namaste|hii+|helo)[\s!?]*$/.test(q)) {
            const hour = new Date().getHours();
            const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
            return res.json({
                success: true, source: "db",
                answer: `${greeting}, **${user.name.split(" ")[0]}**! 👋 How can I help you today?\n\n` +
                    `Here's what you can ask me:\n\n` +
                    `📋 Leave balance & history\n⏰ Attendance & punch status\n💰 Salary details & payslips\n🗓️ Holidays & upcoming events\n🎫 Support tickets\n👤 My profile & bank details\n🔍 Employee search\n🏢 Company info, address & contact` +
                    (isPrivileged(role) ? `\n👥 Team overview, department list & headcount` : ""),
            });
        }

        // ── 10. LLM FALLBACK (Ollama) ─────────────────────────────────────────
        const now = new Date();
        const todayAtt = await Attendance.findOne({ user: user._id, date: { $gte: todayStart() } }).lean();
        const recentLeaves = await Leave.find({ user: user._id }).sort({ createdAt: -1 }).limit(3).lean();
        const usedLv = user.leaveBalance?.used || 0;
        const totalLv = user.leaveBalance?.total || 0;

        const contextData = [
            `=== Employee Profile ===`,
            `Name: ${user.name}`, `Employee ID: ${user.employeeId}`,
            `Email: ${user.email}`, `Phone: ${user.phone || "—"}`,
            `Role: ${role}`, `Designation: ${user.designation || "—"}`,
            `Department: ${user.department || "—"}`, `Employment type: ${user.employmentType}`,
            `Status: ${user.status}`,
            `Joined: ${user.joiningDate ? new Date(user.joiningDate).toDateString() : "—"}`,
            `DOB: ${user.dob ? new Date(user.dob).toDateString() : "—"}`,
            `Reporting to: ${user.reportingTo?.name || "Not assigned"}`,
            ``,
            `=== Leave ===`,
            `Balance: ${totalLv - usedLv}/${totalLv} days remaining`,
            `Recent: ${recentLeaves.map((l) => `${l.type} ${l.status}`).join(", ") || "None"}`,
            ``,
            `=== Today's Attendance ===`,
            todayAtt
                ? `Punched in: ${formatTime(new Date(todayAtt.punchIn))} | Out: ${todayAtt.punchOut ? formatTime(new Date(todayAtt.punchOut)) : "Not yet"} | Status: ${todayAtt.status} | Hours: ${todayAtt.workHours || 0}h`
                : "Not punched in today",
            ``,
            `=== Salary ===`,
            role !== "employee" || user.canViewSalary
                ? `Monthly: ${formatCurrency(user.salary?.monthly)} | Per day: ${formatCurrency(user.salary?.perDay)}`
                : "Salary not released",
            ``,
            `=== Company Info ===`,
            `Company: World WebLogic`,
            `Address: B 108, 1st Floor, Sector 63, Noida – 201301`,
            `Phone: +91 1204545733 | Email: info@worldweblogic.com`,
            `Website: https://www.worldweblogic.com`,
            `Hours: Mon–Fri 10AM–7PM | Sat–Sun Closed`,
            `Late threshold: 10:15 AM | Half-day threshold: 10:30 AM`,
            ``,
            `=== Today ===`,
            `Date: ${formatDate(now)} | Time: ${formatTime(now)} IST`,
        ].join("\n");

        try {
            const llmAnswer = await askOllama(question, contextData);

            // ✅ FIXED — only save relevant unanswered questions
            if (/don.?t know|not sure|no data|cannot find/i.test(llmAnswer) || llmAnswer.length < 15) {
                if (isRelevantQuestion(question)) {
                    await saveUnanswered(question, user._id, role);
                }
            }
            return res.json({ success: true, answer: llmAnswer, source: "ai" });

            // ✅ FIXED — only save if question is company/HR relevant
        } catch (llmError) {
            console.error("LLM Fallback Error:", llmError.message);
            if (isRelevantQuestion(question)) {
                await saveUnanswered(question, user._id, role);
            }
            return res.json({
                success: true,
                answer: "I don't have a specific answer for that. Please contact HR or raise a support ticket at /employee/tickets",
                source: "ai",
            });
        }


    } catch (error) {
        console.error("AI Controller Error:", error.message);
        return res.status(500).json({ success: false, message: "AI service error. Please try again." });
    }
};

module.exports = { askAI };