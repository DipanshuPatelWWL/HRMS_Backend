const { sendMail } = require("./emailClient");

const sendCelebrationMail = async ({
    to,
    subject,
    html,
}) => {

    return await sendMail({
        to,
        subject,
        html,
    });

};

module.exports = {
    sendCelebrationMail,
};