const formatCurrency = (n) =>
    `₹${(n || 0).toLocaleString("en-IN")}`;

module.exports = {
    formatCurrency,
};