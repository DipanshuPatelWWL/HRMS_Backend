// ─── src/ai/intents/profile.intent.js ────────────────────────────────────────

module.exports = {
    name: "profile",

    patterns: [
        /my\s+profile/i,
        /my\s+info/i,
        /my\s+details/i,
        /my\s+account/i,
        /my\s+information/i,
        /my\s+data/i,
        /employee\s+id/i,
        /my\s+id/i,
    ],

    async handler({ user, buildResponse }) {
        const lines = [
            `👤 **Your Profile**\n`,
            `• Name: ${user.name}`,
            `• Employee ID: ${user.employeeId}`,
            `• Email: ${user.email}`,
            `• Phone: ${user.phone || "—"}`,
            `• Role: ${user.role}`,
            `• Designation: ${user.designation || "—"}`,
            `• Department: ${user.department || "—"}`,
            `• Employment Type: ${user.employmentType || "—"}`,
            `• Status: ${user.status}`,
            user.joiningDate
                ? `• Joined: ${new Date(user.joiningDate).toDateString()}`
                : null,
            user.dob
                ? `• DOB: ${new Date(user.dob).toLocaleDateString("en-IN")}`
                : null,
            user.nationality
                ? `• Nationality: ${user.nationality}`
                : null,
            user.maritalStatus
                ? `• Marital Status: ${user.maritalStatus}`
                : null,
            user.reportingTo
                ? `• Reporting To: ${user.reportingTo.name} (${user.reportingTo.designation || "—"})`
                : "• Reporting To: Not assigned",
        ].filter(Boolean).join("\n");

        return buildResponse(lines, "db", "profile");
    },
};