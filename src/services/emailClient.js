const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD,
    },
});

const sendMail = async ({ to, subject, html }) => {
    try {
        await transporter.sendMail({
            from: `"World WebLogic HR" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html,
        });
        return true;
    } catch (err) {
        console.error("Email failed:", err.message);
        return false;
    }
};

module.exports = { sendMail };