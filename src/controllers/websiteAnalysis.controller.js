// websiteAnalysis.controller.js — Day 18 update
const axios = require("axios");
const LeadIntelligence = require("../models/leadIntelligence.model");
const PYTHON_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000";
console.log("PYTHON_URL =", PYTHON_URL);

exports.analyzeWebsite = async (req, res) => {
    try {
        const lead = await LeadIntelligence.findById(req.params.id);
        if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
        if (!lead.website) return res.status(400).json({ success: false, message: "Lead has no website URL" });

        const pyResp = await axios.post(
            `${PYTHON_URL}/api/analyze-website`,
            { url: lead.website, company_name: lead.companyName, lead_id: lead._id.toString() },
            { timeout: 30000 }
        );
        const data = pyResp.data;

        const opportunities = (data.opportunities || []).map(op => ({
            type: op.type,
            description: op.description || op.opener || "",
            priority: op.priority === "critical" ? "high" : (op.priority || "medium"),
        }));

        const updated = await LeadIntelligence.findByIdAndUpdate(
            req.params.id,
            {
                $set: {
                    websiteAnalysis: {
                        techStack: data.techStack || [],
                        isMobileResponsive: data.isMobileResponsive,
                        hasContactForm: data.hasContactForm,
                        pageSpeedScore: data.pageSpeedScore || null,
                        lastAnalyzed: new Date(),
                    },
                    opportunities,
                },
                $push: {
                    timeline: {
                        $each: [{
                            action: `Website analyzed — ${data.techStack?.length || 0} tech, ${opportunities.length} opportunities`,
                            performedBy: req.user?.name || "system",
                            note: data.techStack?.slice(0, 4).join(", ") || "",
                        }],
                        $position: 0,
                    },
                },
            },
            { new: true }
        );

        res.json({
            success: true,
            websiteAnalysis: updated.websiteAnalysis,
            opportunities: updated.opportunities,
            pitchSummary: data.pitchSummary || "",
            talkingPoints: data.opportunities || [],
            raw: { hasSSL: data.hasSSL, estimatedSpeed: data.estimatedSpeed, externalScripts: data.externalScripts },
            lead: updated,
        });
    } catch (err) {
        const msg = err.code === "ECONNREFUSED" ? "Python service not running" : err.response?.data?.detail || err.message;
        res.status(500).json({ success: false, message: msg });
    }
};

exports.getWebsiteAnalysis = async (req, res) => {
    try {
        const lead = await LeadIntelligence.findById(req.params.id, "websiteAnalysis opportunities website companyName");
        if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
        res.json({ success: true, websiteAnalysis: lead.websiteAnalysis, opportunities: lead.opportunities, website: lead.website, companyName: lead.companyName });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.getTalkingPoints = async (req, res) => {
    try {
        const lead = await LeadIntelligence.findById(req.params.id);
        if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
        if (!lead.websiteAnalysis?.lastAnalyzed) {
            return res.status(400).json({ success: false, message: "Run analyze-website first." });
        }
        const pyResp = await axios.post(
            `${PYTHON_URL}/api/talking-points`,
            {
                company_name: lead.companyName,
                website_analysis: {
                    techStack: lead.websiteAnalysis.techStack || [],
                    isMobileResponsive: lead.websiteAnalysis.isMobileResponsive,
                    hasContactForm: lead.websiteAnalysis.hasContactForm,
                    hasSSL: lead.website?.startsWith("https://") || false,
                    estimatedSpeed: "medium",
                    pageSpeedScore: lead.websiteAnalysis.pageSpeedScore,
                },
            },
            { timeout: 15000 }
        );
        res.json({ success: true, opportunities: pyResp.data.opportunities, pitchSummary: pyResp.data.pitchSummary, total: pyResp.data.total });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};