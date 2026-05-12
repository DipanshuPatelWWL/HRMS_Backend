const isPrivileged = (role) =>
    ["tl", "manager", "hr", "superadmin"].includes(role);

const isHRLevel = (role) =>
    ["hr", "manager", "superadmin"].includes(role);

module.exports = { isPrivileged, isHRLevel };