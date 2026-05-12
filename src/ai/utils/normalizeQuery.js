const normalizeQuery = (q) =>
    q
        .toLowerCase()
        .trim()
        .replace(/\btoal\b/g, "total")
        .replace(/\bttoal\b/g, "total")
        .replace(/\battandance\b/g, "attendance")
        .replace(/\bslary\b/g, "salary")
        .replace(/\bccompany\b/g, "company")
        .replace(/\bcompny\b/g, "company")
        .replace(/\bcomapny\b/g, "company")
        .replace(/\bleav\b/g, "leave")
        .replace(/\bpuch\b/g, "punch")
        .replace(/\bi\s+punch\b/g, "i punched");

module.exports = normalizeQuery;