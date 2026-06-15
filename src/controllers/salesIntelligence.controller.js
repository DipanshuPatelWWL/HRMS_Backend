const LeadIntelligence = require("../models/leadIntelligence.model");
const { pythonClient } = require("../middleware/pythonProxy");

// ─── Helper: follow-up schedule ───────────────────────────────────────────────
const buildFollowUpSchedule = (startDate = new Date()) => {
    const days = [1, 4, 8, 15];
    return days.map((d) => {
        const date = new Date(startDate);
        date.setDate(date.getDate() + d);
        return { scheduledAt: date, label: `Day ${d}`, completed: false };
    });
};

// ─── GET /api/intelligence/leads ─────────────────────────────────────────────
exports.getLeads = async (req, res) => {
    try {
        const {
            tag, stage, status, search,
            sortBy = "score", order = "desc",
            page = 1, limit = 20,
        } = req.query;

        const filter = { isDeleted: false };
        if (tag) filter.tag = tag;
        if (stage) filter.stage = stage;
        if (status) filter.status = status;
        if (search) {
            filter.$or = [
                { companyName: { $regex: search, $options: "i" } },
                { clientEmail: { $regex: search, $options: "i" } },
                { country: { $regex: search, $options: "i" } },
            ];
        }

        const sortOrder = order === "asc" ? 1 : -1;
        const skip = (Number(page) - 1) * Number(limit);

        const [leads, total] = await Promise.all([
            LeadIntelligence.find(filter)
                .sort({ [sortBy]: sortOrder })
                .skip(skip)
                .limit(Number(limit))
                .populate("assignedTo", "name email"),
            LeadIntelligence.countDocuments(filter),
        ]);

        res.json({ success: true, total, page: Number(page), leads });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ─── GET /api/intelligence/leads/:id ─────────────────────────────────────────
exports.getLeadById = async (req, res) => {
    try {
        const lead = await LeadIntelligence.findById(req.params.id)
            .populate("assignedTo", "name email");
        if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
        res.json({ success: true, lead });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ─── POST /api/intelligence/leads ────────────────────────────────────────────
exports.createLead = async (req, res) => {
    try {
        const {
            companyName, clientEmail, clientPhone, website,
            linkedin, country, service, notes, priority, assignedTo,
        } = req.body;

        if (!companyName) {
            return res.status(400).json({ success: false, message: "companyName is required" });
        }

        const lead = new LeadIntelligence({
            companyName, clientEmail, clientPhone, website,
            linkedin, country, service, notes, priority,
            assignedTo: assignedTo || null,
            generatedBy: "manual",
            followUpDates: buildFollowUpSchedule(),
            nextFollowUp: new Date(Date.now() + 86400000),
        });

        lead.timeline.unshift({
            action: "Lead created manually",
            performedBy: req.user?.name || "user",
        });

        await lead.save();
        res.status(201).json({ success: true, lead });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ─── POST /api/intelligence/leads/generate ───────────────────────────────────
exports.generateLeads = async (req, res) => {
    try {
        const {
            keyword,
            limit = 20,
            source = "web",
            location = "",
            search_mode = "fast",
            country = "",
            cities = [],
            postalCodes = "",
            domain_year_from = null,
            domain_year_to = null,
            required_techs = [],
            genuineness_min = 0,
        } = req.body;

        if (!keyword || !keyword.trim()) {
            return res.status(400).json({ success: false, message: "keyword is required" });
        }

        let pythonLeads = [];
        try {
            // ── Health check first so we get a clear error ──
            try {
                await pythonClient.get("/health", { timeout: 5000 });
            } catch (healthErr) {
                const reason = healthErr.code === "ECONNREFUSED"
                    ? `Nothing is listening on Python Service (ECONNREFUSED)`
                    : healthErr.code === "ETIMEDOUT"
                        ? `Python service timed out`
                        : `Health check failed: ${healthErr.message}`;
                console.error("❌ Python health check failed:", reason);
                return res.status(503).json({
                    success: false,
                    message: `Python Lead Engine not reachable — ${reason}. Run: uvicorn main:app --host 0.0.0.0 --port 8000`,
                });
            }

            console.log(`✅ Python health OK — sending find-leads request`);
            console.time("python_find_leads");
            const response = await pythonClient.post(
                "/api/find-leads",
                {
                    keyword: keyword.trim(),
                    limit: Number(limit),
                    source,
                    location,
                    search_mode,
                    country,
                    cities,
                    // Python model expects a List[str] for postalCodes
                    postalCodes: postalCodes ? postalCodes.split(",").map(s => s.trim()).filter(Boolean) : [],
                    domain_year_from,
                    domain_year_to,
                    required_techs,
                    genuineness_min,
                },
                { timeout: 90000 }
            );
            console.timeEnd("python_find_leads");
            console.log("=================================");
            console.log("PYTHON FULL RESPONSE");
            console.log(JSON.stringify(response.data, null, 2));
            console.log("=================================");
            pythonLeads = response.data?.leads || [];
            console.log(`✅ Python returned ${pythonLeads.length} leads. Success: ${response.data?.success}`);
        } catch (pyErr) {
            console.timeEnd("python_find_leads");
            if (pyErr.response?.status === 422) {
                console.error("❌ Python 422 detail:", JSON.stringify(pyErr.response.data, null, 2));
            }
            const code = pyErr.code || "UNKNOWN";
            const status = pyErr.response?.status;
            const detail = pyErr.response?.data?.detail || pyErr.response?.data?.message || "";
            console.error(`❌ Python find-leads failed [${code}] status=${status}:`, pyErr.message, detail);
            return res.status(503).json({
                success: false,
                message: `Python Lead Engine error [${code}]${status ? ` HTTP ${status}` : ""}${detail ? `: ${detail}` : `: ${pyErr.message}`}`,
            });
        }

        console.log(`[SALES_CTRL] Processing ${pythonLeads.length} leads...`);
        if (!pythonLeads.length) {
            console.log(`[SALES_CTRL] No leads to process, returning 200 OK with empty array`);
            return res.json({ success: true, inserted: 0, skipped: 0, leads: [], message: `No leads found for: "${keyword}"` });
        }

        const savedLeads = [];
        let inserted = 0;
        let skipped = 0;

        for (const r of pythonLeads) {
            const website = r.website || "";
            if (website) {
                const exists = await LeadIntelligence.findOne({ website, isDeleted: false });
                if (exists) { skipped++; continue; }
            }

            const followUpDates = buildFollowUpSchedule();
            const lead = await LeadIntelligence.create({
                companyName: r.company_name || "Unknown",
                clientEmail: r.email || "",
                website,
                linkedin: r.linkedin || "",
                country: r.country || "",
                keyword: keyword.trim(),
                generatedBy: source === "foursquare" ? "foursquare" : "python-scraper",
                score: r.score || 0,
                scoreBreakdown: {
                    emailFound: r.scoreBreakdown?.emailFound ?? r.score_breakdown?.email_found ?? 0,
                    linkedinActive: r.scoreBreakdown?.linkedinActive ?? r.score_breakdown?.linkedin_present ?? 0,
                    websiteQuality: r.scoreBreakdown?.websiteQuality ?? r.score_breakdown?.has_contact_form ?? 0,
                    companySize: r.scoreBreakdown?.companySize ?? r.score_breakdown?.country_identified ?? 0,
                    hiringSignals: r.scoreBreakdown?.hiringSignals ?? r.score_breakdown?.clean_company_name ?? 0,
                },
                tag: r.tag || "unscored",
                // ── Genuineness ──
                genuinenessScore: r.genuinenessScore ?? null,
                genuinenessLabel: r.genuinenessLabel ?? "unverified",
                genuinenessSignals: r.genuinenessSignals ?? {},
                // ── Website Analysis ──
                websiteAnalysis: {
                    techStack: r.websiteAnalysis?.techStack || [],
                    isMobileResponsive: r.websiteAnalysis?.isMobileResponsive ?? null,
                    hasContactForm: r.websiteAnalysis?.hasContactForm ?? null,
                    domainAgeYears: r.websiteAnalysis?.domainAgeYears ?? null,
                    domainCreatedYear: r.websiteAnalysis?.domainCreatedYear ?? null,
                    pageSpeedScore: null,
                    lastAnalyzed: new Date(),
                },
                followUpDates,
                nextFollowUp: followUpDates[0]?.scheduledAt || null,
                timeline: [{
                    action: `Lead auto-generated via keyword "${keyword.trim()}"`,
                    performedBy: "python-scraper",
                }],
            });
            savedLeads.push(lead);
            inserted++;
        }

        res.json({ success: true, keyword, inserted, skipped, total_from_python: pythonLeads.length, leads: savedLeads });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ─── POST /api/intelligence/leads/:id/rescore ─────────────────────────────────
exports.rescoreLead = async (req, res) => {
    try {
        const lead = await LeadIntelligence.findById(req.params.id);
        if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

        let scoreResponse;
        try {
            scoreResponse = await pythonClient.post("/api/score-lead", {
                company_name: lead.companyName,
                website: lead.website,
                email: lead.clientEmail,
                linkedin: lead.linkedin,
                country: lead.country,
            }, { timeout: 30000 });
        } catch (pyErr) {
            const code = pyErr.code || "UNKNOWN";
            const status = pyErr.response?.status;
            console.error(`❌ rescore failed [${code}] status=${status}:`, pyErr.message);
            return res.status(503).json({
                success: false,
                message: `Python service error [${code}]${status ? ` HTTP ${status}` : ""}: ${pyErr.message}`,
            });
        }

        const data = scoreResponse.data;

        // scoreBreakdown can come back as camelCase (new scorer) or snake_case (old scorer)
        lead.score = data.score ?? lead.score;
        lead.tag = data.tag ?? lead.tag;
        lead.scoreBreakdown = {
            emailFound: data.scoreBreakdown?.emailFound ?? data.score_breakdown?.email_found ?? 0,
            linkedinActive: data.scoreBreakdown?.linkedinActive ?? data.score_breakdown?.linkedin_present ?? 0,
            websiteQuality: data.scoreBreakdown?.websiteQuality ?? data.score_breakdown?.has_contact_form ?? 0,
            companySize: data.scoreBreakdown?.companySize ?? data.score_breakdown?.country_identified ?? 0,
            hiringSignals: data.scoreBreakdown?.hiringSignals ?? data.score_breakdown?.clean_company_name ?? 0,
        };
        lead.timeline.unshift({
            action: `Lead rescored: ${lead.score} (${lead.tag})`,
            performedBy: "system",
        });
        await lead.save();

        res.json({ success: true, lead });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ─── POST /api/intelligence/leads/rescore-all ─────────────────────────────────
exports.rescoreAll = async (req, res) => {
    try {
        const leads = await LeadIntelligence.find({ isDeleted: false });
        res.json({ success: true, message: `Rescoring ${leads.length} leads in background` });

        // Run in background after response sent
        for (const lead of leads) {
            try {
                const response = await pythonClient.post("/api/score-lead", {
                    company_name: lead.companyName,
                    website: lead.website,
                    email: lead.clientEmail,
                    linkedin: lead.linkedin,
                    country: lead.country,
                }, { timeout: 20000 });
                const data = response.data;
                lead.score = data.score;
                lead.tag = data.tag;
                lead.scoreBreakdown = {
                    emailFound: data.score_breakdown?.email_found || 0,
                    linkedinActive: data.score_breakdown?.linkedin_present || 0,
                    websiteQuality: data.score_breakdown?.has_contact_form || 0,
                    companySize: data.score_breakdown?.country_identified || 0,
                    hiringSignals: data.score_breakdown?.clean_company_name || 0,
                };
                await lead.save();
            } catch (_) { /* skip failures */ }
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ─── POST /api/intelligence/leads/:id/generate-email ─────────────────────────
// Day 7: Call Python to generate AI email, return subject + body
exports.generateEmail = async (req, res) => {
    try {
        const lead = await LeadIntelligence.findById(req.params.id);
        if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

        // Call Python email generator
        let subject = "";
        let body = "";
        let generatedBy = "template";

        try {
            const response = await axios.post(
                `${PYTHON_URL}/api/generate-email`,
                {
                    company_name: lead.companyName,
                    website: lead.website,
                    email: lead.clientEmail,
                    country: lead.country,
                    linkedin: lead.linkedin,
                    score: lead.score,
                    tag: lead.tag,
                },
                { timeout: 30000 }
            );
            subject = response.data.subject || "";
            body = response.data.body || "";
            generatedBy = response.data.generated_by || "template";
        } catch (pyErr) {
            // Python AI unavailable — use built-in template
            console.warn("⚠️  Python email generator not available, using template");
            subject = `Partnership Opportunity – ${lead.companyName}`;
            body = `Hi,

I came across ${lead.companyName}${lead.website ? ` at ${lead.website}` : ""} and wanted to reach out about a potential collaboration.

We specialise in building custom HRMS and recruitment software solutions that help companies like yours streamline employee management, attendance tracking, payroll, and more.

Given your focus${lead.country ? ` in ${lead.country}` : ""}, I believe our platform could add significant value to your operations.

Would you be open to a quick 15-minute call to explore how we can help?

Looking forward to hearing from you.

Best regards,
[Your Name]
[Your Company]`;
            generatedBy = "template";
        }

        res.json({ success: true, subject, body, generatedBy });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ─── PATCH /api/intelligence/leads/:id/email-draft ───────────────────────────
// Day 7: Save edited email draft to lead document
exports.saveEmailDraft = async (req, res) => {
    try {
        const { subject, body } = req.body;

        if (!subject?.trim() || !body?.trim()) {
            return res.status(400).json({ success: false, message: "subject and body are required" });
        }

        const lead = await LeadIntelligence.findByIdAndUpdate(
            req.params.id,
            {
                $set: {
                    "emailDraft.subject": subject.trim(),
                    "emailDraft.body": body.trim(),
                    "emailDraft.generatedAt": new Date(),
                    "emailDraft.status": "draft",
                },
                $push: {
                    timeline: {
                        $each: [{ action: "Email draft saved", performedBy: req.user?.name || "user", note: "" }],
                        $position: 0,
                    },
                },
            },
            { new: true }
        );

        if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
        res.json({ success: true, lead });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ─── PATCH /api/intelligence/leads/:id ───────────────────────────────────────
exports.updateLead = async (req, res) => {
    try {
        const allowed = ["stage", "status", "notes", "priority", "assignedTo", "nextFollowUp"];
        const updates = {};
        allowed.forEach((f) => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

        const lead = await LeadIntelligence.findByIdAndUpdate(
            req.params.id, { $set: updates }, { new: true }
        );
        if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

        if (req.body.stage) {
            lead.timeline.unshift({ action: `Stage changed to ${req.body.stage}`, performedBy: req.user?.name || "user" });
            await lead.save();
        }

        res.json({ success: true, lead });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ─── DELETE /api/intelligence/leads/:id ──────────────────────────────────────
exports.deleteLead = async (req, res) => {
    try {
        await LeadIntelligence.findByIdAndUpdate(req.params.id, { isDeleted: true });
        res.json({ success: true, message: "Lead deleted" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ─── GET /api/intelligence/stats ─────────────────────────────────────────────
exports.getStats = async (req, res) => {
    try {
        const base = { isDeleted: false };
        const [total, hot, warm, cold, unscored, byStage, recentWeek] = await Promise.all([
            LeadIntelligence.countDocuments(base),
            LeadIntelligence.countDocuments({ ...base, tag: "hot" }),
            LeadIntelligence.countDocuments({ ...base, tag: "warm" }),
            LeadIntelligence.countDocuments({ ...base, tag: "cold" }),
            LeadIntelligence.countDocuments({ ...base, tag: "unscored" }),
            LeadIntelligence.aggregate([{ $match: base }, { $group: { _id: "$stage", count: { $sum: 1 } } }]),
            LeadIntelligence.countDocuments({ ...base, createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
        ]);
        res.json({ success: true, stats: { total, hot, warm, cold, unscored, recentWeek, byStage } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};


// ─── POST /api/intelligence/leads/:id/generate-proposal ──────────────────────
exports.generateProposal = async (req, res) => {
    try {
        const lead = await LeadIntelligence.findById(req.params.id);
        if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

        const {
            modules = [],
            headcount = 0,
            prepared_for = "",
        } = req.body;

        const response = await axios.post(
            `${PYTHON_URL}/api/generate-proposal`,
            {
                company_name: lead.companyName,
                email: lead.clientEmail,
                website: lead.website,
                country: lead.country,
                score: lead.score,
                tag: lead.tag,
                modules,
                headcount,
                prepared_for: prepared_for || lead.companyName,
            },
            { timeout: 30000, responseType: "arraybuffer" }
        );

        const filename = `Proposal_${lead.companyName.replace(/\s+/g, "_")}.pdf`;

        res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Length": response.data.length,
        });

        // Timeline entry (fire-and-forget)
        lead.timeline.unshift({
            action: "Proposal PDF generated",
            performedBy: req.user?.name || "user",
        });
        lead.save().catch(() => { });

        res.send(Buffer.from(response.data));
    } catch (err) {
        const code = err.code || "UNKNOWN";
        const status = err.response?.status;
        if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || status === 503) {
            return res.status(503).json({
                success: false,
                message: `Python service not reachable [${code}] at ${PYTHON_URL}`,
            });
        }
        console.error("❌ generateProposal error:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};