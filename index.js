const { app, server } = require("./src/app");
const mongoose = require("mongoose");
require("dotenv").config();
require("./src/cron/leave.cron");
const {
    startCelebrationCron
} = require("./src/cron/celebration.cron");
const { startLeaveAccrualCron } = require("./src/cron/leave.cron")

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ DB Connected");

        server.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            startLeaveAccrualCron();
            startCelebrationCron();
        });
    } catch (error) {
        console.error("❌ Server Error:", error.message);
    }
};

startServer();