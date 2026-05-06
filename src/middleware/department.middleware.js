const allowDepartment = (...departments) => {
    return (req, res, next) => {
        if (!req.user || !departments.includes(req.user.department)) {
            return res.status(403).json({
                success: false,
                message: "Access denied: Invalid department",
            });
        }
        next();
    };
};

module.exports = allowDepartment;