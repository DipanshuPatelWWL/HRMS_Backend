const moment = require("moment-timezone");

// Given any date, returns the FY start (April 1), end, and label like "2025-26"
function getFYBounds(date) {
    const m = moment(date).tz("Asia/Kolkata");
    const startYear = m.month() >= 3 ? m.year() : m.year() - 1; // April = month index 3
    const start = moment.tz(`${startYear}-04-01`, "YYYY-MM-DD", "Asia/Kolkata").startOf("day");
    const end = start.clone().add(1, "year").subtract(1, "day").endOf("day");
    const label = `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
    return { start: start.toDate(), end: end.toDate(), label };
}

module.exports = { getFYBounds };