// dashboardStats.controller.js
// Returns all data needed for the Sales Intelligence Dashboard

const LeadIntelligence = require("../models/leadIntelligence.model");

// ── GET /api/intelligence/dashboard ──────────────────────────────────────────
exports.getDashboardStats = async (req, res) => {
    try {
        const base = { isDeleted: false };
        const now = new Date();

        // ── Date ranges ──────────────────────────────────────────────────────
        const weekAgo = new Date(now - 7 * 86400000);
        const monthAgo = new Date(now - 30 * 86400000);
        const today = new Date(now); today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

        // ── Core stats ───────────────────────────────────────────────────────
        const [
            total, hot, warm, cold, unscored,
            recentWeek, recentMonth,
            withEmail, withDraft, withAnalysis,
            needsFollowUp, overdueFollowUp,
            byStage,
        ] = await Promise.all([
            LeadIntelligence.countDocuments(base),
            LeadIntelligence.countDocuments({ ...base, tag: "hot" }),
            LeadIntelligence.countDocuments({ ...base, tag: "warm" }),
            LeadIntelligence.countDocuments({ ...base, tag: "cold" }),
            LeadIntelligence.countDocuments({ ...base, tag: "unscored" }),
            LeadIntelligence.countDocuments({ ...base, createdAt: { $gte: weekAgo } }),
            LeadIntelligence.countDocuments({ ...base, createdAt: { $gte: monthAgo } }),
            LeadIntelligence.countDocuments({ ...base, clientEmail: { $ne: "" } }),
            LeadIntelligence.countDocuments({ ...base, "emailDraft.status": "draft" }),
            LeadIntelligence.countDocuments({ ...base, "websiteAnalysis.lastAnalyzed": { $ne: null } }),
            LeadIntelligence.countDocuments({ ...base, status: "Needs Follow-up" }),
            LeadIntelligence.countDocuments({ ...base, nextFollowUp: { $lt: today }, stage: { $nin: ["Won", "Lost"] } }),
            LeadIntelligence.aggregate([
                { $match: base },
                { $group: { _id: "$stage", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),
        ]);

        // ── Weekly chart data (last 7 days) ───────────────────────────────────
        const dailyCounts = await LeadIntelligence.aggregate([
            { $match: { ...base, createdAt: { $gte: weekAgo } } },
            {
                $group: {
                    _id: {
                        $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
                    },
                    count: { $sum: 1 },
                    hot: { $sum: { $cond: [{ $eq: ["$tag", "hot"] }, 1, 0] } },
                    warm: { $sum: { $cond: [{ $eq: ["$tag", "warm"] }, 1, 0] } },
                    cold: { $sum: { $cond: [{ $eq: ["$tag", "cold"] }, 1, 0] } },
                },
            },
            { $sort: { _id: 1 } },
        ]);

        // Fill in missing days with 0
        const weeklyChart = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split("T")[0];
            const dayName = d.toLocaleDateString("en-GB", { weekday: "short" });
            const found = dailyCounts.find(dc => dc._id === dateStr);
            weeklyChart.push({
                date: dateStr,
                day: dayName,
                total: found?.count || 0,
                hot: found?.hot || 0,
                warm: found?.warm || 0,
                cold: found?.cold || 0,
            });
        }

        // ── Top keywords ──────────────────────────────────────────────────────
        const topKeywords = await LeadIntelligence.aggregate([
            { $match: { ...base, keyword: { $ne: "" } } },
            { $group: { _id: "$keyword", count: { $sum: 1 }, avgScore: { $avg: "$score" } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
        ]);

        // ── Top opportunities (most common across all leads) ───────────────────
        const topOpportunities = await LeadIntelligence.aggregate([
            { $match: { ...base, "opportunities.0": { $exists: true } } },
            { $unwind: "$opportunities" },
            {
                $group: {
                    _id: "$opportunities.type",
                    count: { $sum: 1 },
                    highPriority: { $sum: { $cond: [{ $eq: ["$opportunities.priority", "high"] }, 1, 0] } },
                }
            },
            { $sort: { count: -1 } },
            { $limit: 6 },
        ]);

        // ── Recent activity ───────────────────────────────────────────────────
        const recentLeads = await LeadIntelligence.find(base)
            .sort({ createdAt: -1 })
            .limit(5)
            .select("companyName tag score createdAt keyword clientEmail");

        // ── Conversion funnel ─────────────────────────────────────────────────
        const stageOrder = ["New", "Contacted", "Interested", "Proposal", "Won"];
        const stageCounts = {};
        byStage.forEach(s => { stageCounts[s._id] = s.count; });

        res.json({
            success: true,
            stats: {
                total, hot, warm, cold, unscored,
                recentWeek, recentMonth,
                withEmail, withDraft, withAnalysis,
                needsFollowUp, overdueFollowUp,
                emailRate: total > 0 ? Math.round((withEmail / total) * 100) : 0,
                draftRate: total > 0 ? Math.round((withDraft / total) * 100) : 0,
            },
            weeklyChart,
            topKeywords,
            topOpportunities,
            recentLeads,
            byStage: stageOrder.map(s => ({ stage: s, count: stageCounts[s] || 0 })),
        });
    } catch (err) {
        console.error("getDashboardStats error:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};