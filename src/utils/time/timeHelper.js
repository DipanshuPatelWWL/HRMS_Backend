// utils/timeHelper.js
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30

/**
 * Convert any date to IST Date object
 */
const toIST = (date = new Date()) => {
    const utc = new Date(date).getTime();
    return new Date(utc + IST_OFFSET_MS);
};

/**
 * Format a date as "10:21 am" in IST
 */
const formatTimeIST = (date = new Date()) => {
    return toIST(date).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata",
    });
};

/**
 * Get IST hours and minutes from a date (for shift comparison)
 */
const getISTHoursMinutes = (date = new Date()) => {
    const ist = toIST(date);
    return { hours: ist.getHours(), minutes: ist.getMinutes() };
};

module.exports = { toIST, formatTimeIST, getISTHoursMinutes };