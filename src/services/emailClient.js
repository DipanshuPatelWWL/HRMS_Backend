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
        const info = await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to,
            subject,
            html,
        });

        console.log(`Email sent: ${info.messageId}`);
        return true;
    } catch (err) {
        console.error("Email Error:", err);
        return false;
    }
};

module.exports = { sendMail };