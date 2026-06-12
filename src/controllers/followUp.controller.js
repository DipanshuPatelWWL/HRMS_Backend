// followUp.controller.js
// Handles follow-up CRUD: get due leads, mark done, snooze, add new date

const LeadIntelligence = require("../models/leadIntelligence.model");

// ── Helper ────────────────────────────────────────────────────────────────────
const isDueOrOverdue = (date) => {
    if (!date) return false;
    const now = new Date();
    const due = new Date(date);
    now.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    return due <= now;
};

const isUpcoming = (date, days = 3) => {
    if (!date) return false;
    const now = new Date();
    const due = new Date(date);
    const future = new Date();
    future.setDate(future.getDate() + days);
    now.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    future.setHours(23, 59, 59, 999);
    return due > now && due <= future;
};

// ── GET /api/intelligence/follow-ups ─────────────────────────────────────────
// Returns leads grouped by: overdue / due_today / upcoming
exports.getFollowUps = async (req, res) => {
    try {
        const leads = await LeadIntelligence.find({
            isDeleted: false,
            stage: { $nin: ["Won", "Lost"] },
        }).sort({ nextFollowUp: 1 });

        const overdue = [];
        const dueToday = [];
        const upcoming = [];

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const lead of leads) {
            const next = lead.nextFollowUp ? new Date(lead.nextFollowUp) : null;
            if (!next) continue;

            const dueDate = new Date(next);
            dueDate.setHours(0, 0, 0, 0);

            const pendingDates = (lead.followUpDates || []).filter(f => !f.completed);
            if (pendingDates.length === 0) continue;

            const item = {
                _id: lead._id,
                companyName: lead.companyName,
                clientEmail: lead.clientEmail,
                website: lead.website,
                country: lead.country,
                tag: lead.tag,
                score: lead.score,
                stage: lead.stage,
                status: lead.status,
                nextFollowUp: lead.nextFollowUp,
                followUpDates: lead.followUpDates,
                keyword: lead.keyword,
            };

            if (dueDate < today) {
                overdue.push({ ...item, daysOverdue: Math.floor((today - dueDate) / 86400000) });
            } else if (dueDate.getTime() === today.getTime()) {
                dueToday.push(item);
            } else if (isUpcoming(next, 3)) {
                upcoming.push(item);
            }
        }

        res.json({
            success: true,
            summary: {
                overdue: overdue.length,
                dueToday: dueToday.length,
                upcoming: upcoming.length,
                total: overdue.length + dueToday.length + upcoming.length,
            },
            overdue,
            dueToday,
            upcoming,
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── POST /api/intelligence/leads/:id/follow-up/complete ──────────────────────
// Mark the next pending follow-up as done, advance to next date
exports.completeFollowUp = async (req, res) => {
    try {
        const lead = await LeadIntelligence.findById(req.params.id);
        if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

        const { followUpId, note = "" } = req.body;

        // Mark specific follow-up as complete
        let completed = false;
        for (const fu of lead.followUpDates) {
            if (fu._id.toString() === followUpId && !fu.completed) {
                fu.completed = true;
                fu.completedAt = new Date();
                completed = true;
                break;
            }
        }

        if (!completed) {
            // Mark first pending one
            const pending = lead.followUpDates.find(f => !f.completed);
            if (pending) {
                pending.completed = true;
                pending.completedAt = new Date();
                completed = true;
            }
        }

        // Find next pending follow-up date
        const nextPending = lead.followUpDates.find(f => !f.completed);
        lead.nextFollowUp = nextPending?.scheduledAt || null;

        // Update status
        lead.status = nextPending ? "Active" : "Completed";

        // Add timeline entry
        lead.timeline.unshift({
            action: `Follow-up completed`,
            performedBy: req.user?.name || "user",
            note: note || `Next follow-up: ${nextPending ? new Date(nextPending.scheduledAt).toDateString() : "none"}`,
        });

        await lead.save();
        res.json({ success: true, lead });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── POST /api/intelligence/leads/:id/follow-up/snooze ────────────────────────
// Snooze follow-up by N days
exports.snoozeFollowUp = async (req, res) => {
    try {
        const lead = await LeadIntelligence.findById(req.params.id);
        if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

        const { days = 3 } = req.body;

        const snoozeDate = new Date();
        snoozeDate.setDate(snoozeDate.getDate() + Number(days));

        lead.nextFollowUp = snoozeDate;

        // Add a new follow-up date entry for the snooze
        lead.followUpDates.push({
            label: `Snoozed +${days}d`,
            scheduledAt: snoozeDate,
            completed: false,
        });

        lead.status = "Active";

        lead.timeline.unshift({
            action: `Follow-up snoozed by ${days} day(s)`,
            performedBy: req.user?.name || "user",
            note: `New date: ${snoozeDate.toDateString()}`,
        });

        await lead.save();
        res.json({ success: true, lead });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── POST /api/intelligence/leads/:id/follow-up/add ───────────────────────────
// Add a custom follow-up date
exports.addFollowUpDate = async (req, res) => {
    try {
        const lead = await LeadIntelligence.findById(req.params.id);
        if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

        const { date, label = "Custom" } = req.body;
        if (!date) return res.status(400).json({ success: false, message: "date is required" });

        const newDate = new Date(date);
        lead.followUpDates.push({ label, scheduledAt: newDate, completed: false });
        lead.nextFollowUp = newDate;
        lead.status = "Active";

        lead.timeline.unshift({
            action: `Follow-up scheduled: ${newDate.toDateString()}`,
            performedBy: req.user?.name || "user",
            note: label,
        });

        await lead.save();
        res.json({ success: true, lead });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── GET /api/intelligence/follow-ups/stats ────────────────────────────────────
exports.getFollowUpStats = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const in3Days = new Date(today);
        in3Days.setDate(in3Days.getDate() + 3);

        const base = { isDeleted: false, stage: { $nin: ["Won", "Lost"] } };

        const [overdue, dueToday, upcoming, needsFollowUp] = await Promise.all([
            LeadIntelligence.countDocuments({ ...base, nextFollowUp: { $lt: today } }),
            LeadIntelligence.countDocuments({ ...base, nextFollowUp: { $gte: today, $lt: tomorrow } }),
            LeadIntelligence.countDocuments({ ...base, nextFollowUp: { $gte: tomorrow, $lt: in3Days } }),
            LeadIntelligence.countDocuments({ ...base, status: "Needs Follow-up" }),
        ]);

        res.json({ success: true, stats: { overdue, dueToday, upcoming, needsFollowUp } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};