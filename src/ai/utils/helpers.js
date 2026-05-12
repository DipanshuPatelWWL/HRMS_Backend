// ─── src/ai/utils/helpers.js ─────────────────────────────────────────────────

const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

const DAYS = [
    "Sunday", "Monday", "Tuesday", "Wednesday",
    "Thursday", "Friday", "Saturday",
];

const formatDate = (d) =>
    `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

const formatTime = (d) =>
    d.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });

const formatCurrency = (n) =>
    `₹${(n || 0).toLocaleString("en-IN")}`;

const todayStart = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
};

const getNextWeekend = () => {
    const today = new Date();
    const daysToSat = (6 - today.getDay() + 7) % 7 || 7;
    const sat = new Date(today);
    sat.setDate(today.getDate() + daysToSat);
    const sun = new Date(sat);
    sun.setDate(sat.getDate() + 1);
    return { sat, sun };
};

// Keyword helpers — has() requires ALL words, any() requires at least ONE
const has = (q, ...words) => words.every((w) => q.includes(w));
const any = (q, ...words) => words.some((w) => q.includes(w));

const MONTH_MAP = {
    january: 0, february: 1, march: 2, april: 3,
    may: 4, june: 5, july: 6, august: 7,
    september: 8, october: 9, november: 10, december: 11,
};

const extractMonth = (text) => {
    const lower = text.toLowerCase();
    for (const month in MONTH_MAP) {
        if (lower.includes(month)) return MONTH_MAP[month];
    }
    return null;
};

module.exports = {
    MONTHS,
    DAYS,
    formatDate,
    formatTime,
    formatCurrency,
    todayStart,
    getNextWeekend,
    has,
    any,
    MONTH_MAP,
    extractMonth,
};