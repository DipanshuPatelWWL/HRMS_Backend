// ================= utils/questionFilter.js =================

const RELEVANT_KEYWORDS = [
    // Company & org
    "company", "organization", "office", "branch", "department", "team",
    "policy", "policies", "rule", "rules", "regulation", "guideline",

    // HR topics
    "leave", "leave balance", "annual leave", "sick leave", "casual leave",
    "maternity", "paternity", "holiday", "holidays", "attendance",
    "salary", "salaries", "payroll", "payslip", "ctc", "increment",
    "appraisal", "performance review", "kpi", "bonus", "incentive",
    "deduction", "tax", "pf", "epf", "esi", "provident fund",

    // Employment
    "joining", "onboarding", "resignation", "notice period", "termination",
    "probation", "confirmation", "promotion", "transfer", "relocation",
    "contract", "appointment letter", "offer letter", "experience letter",
    "relieving letter", "noc", "no objection",

    // Work & office
    "work from home", "wfh", "remote", "hybrid", "shift", "timing",
    "working hours", "overtime", "weekend", "punch in", "punch out",
    "biometric", "access card", "id card",

    // Benefits & facilities
    "insurance", "medical", "health", "reimbursement", "travel allowance",
    "allowance", "canteen", "parking", "conveyance", "food",

    // Admin & IT
    "laptop", "system", "equipment", "asset", "infrastructure",
    "email", "vpn", "software", "tool", "access", "permission",

    // Compliance & legal
    "posh", "grievance", "complaint", "harassment", "code of conduct",
    "nda", "confidentiality", "non disclosure",

    // Training
    "training", "learning", "development", "course", "certification",
    "skill", "workshop", "seminar",
];

// Keywords that are clearly personal / irrelevant
const IRRELEVANT_KEYWORDS = [
    "weather", "recipe", "food delivery", "movie", "cricket", "ipl",
    "stock", "crypto", "bitcoin", "personal loan", "relationship",
    "girlfriend", "boyfriend", "family trip", "hotel booking",
];

/**
 * Returns true if the question is company/HR/office relevant.
 * Uses keyword matching — fast, zero external API calls.
 */
const isRelevantQuestion = (question = "") => {
    const q = question.toLowerCase().trim();

    // Immediately reject clearly personal / off-topic questions
    const isIrrelevant = IRRELEVANT_KEYWORDS.some((kw) => q.includes(kw));
    if (isIrrelevant) return false;

    // Accept if any relevant keyword matches
    const isRelevant = RELEVANT_KEYWORDS.some((kw) => q.includes(kw));
    return isRelevant;
};

module.exports = { isRelevantQuestion };