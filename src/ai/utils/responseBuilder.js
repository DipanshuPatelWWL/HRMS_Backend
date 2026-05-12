const PAGE_LINKS = {
    salary: { label: "💰 View Salary Details", path: "/employee/salary" },
    payslip: { label: "📄 Download Payslips", path: "/employee/payslips" },
    attendance: { label: "📊 Full Attendance Report", path: "/employee/attendance" },
    leaves: { label: "🌴 Leave Management", path: "/employee/leaves" },
    profile: { label: "👤 My Profile", path: "/employee/profile" },
    tickets: { label: "🎫 Support Tickets", path: "/employee/tickets" },
    holidays: { label: "🗓️ Holiday Calendar", path: "/company/holidays" },
    team: { label: "👥 Team Overview", path: "/manager/team" },
    payroll: { label: "💼 Payroll Dashboard", path: "/hr/payroll" },
    employees: { label: "🔍 Employee Directory", path: "/hr/employees" },
    leads: { label: "📈 Sales & Leads", path: "/sales/leads" },
    bank: { label: "🏦 Bank Details", path: "/employee/profile?tab=bank" },
};

/**
 * Attaches page-link objects to a response payload.
 * @param {string} answer
 * @param {...string} pageKeys
 */
const withLinks = (answer, ...pageKeys) => ({
    answer,
    links: pageKeys.map((k) => PAGE_LINKS[k]).filter(Boolean),
});

/**
 * Builds the standard success response sent to the client.
 * @param {string} answer
 * @param {string} source  - "db" | "kb" | "ai"
 * @param {...string} pageKeys
 */
const buildResponse = (answer, source, ...pageKeys) => ({
    success: true,
    ...withLinks(answer, ...pageKeys),
    source,
});

module.exports = { PAGE_LINKS, withLinks, buildResponse };