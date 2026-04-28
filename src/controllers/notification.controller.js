const Notification = require("../models/notification.model");

//  Create Notification
const createNotification = async (userId, title, message, type) => {
    // 1. Save in DB
    const notification = await Notification.create({
        user: userId,
        title,
        message,
        type,
    });

    try {
        // 2. Get user token
        const user = await User.findById(userId);

        if (user?.fcmToken) {
            // 3. Send push notification
            await admin.messaging().send({
                token: user.fcmToken,
                notification: {
                    title,
                    body: message,
                },
                data: {
                    type,
                    notificationId: notification._id.toString(),
                },
            });
        }
    } catch (err) {
        console.log("Push error:", err.message);
    }

    return notification;
};

//  Get Notifications
const getMyNotifications = async (req, res) => {
    const data = await Notification.find({ user: req.user._id })
        .sort({ createdAt: -1 });

    res.json({ success: true, data });
};

//  Mark as Read
const markAsRead = async (req, res) => {
    const { id } = req.params;

    await Notification.findByIdAndUpdate(id, { isRead: true });

    res.json({ success: true });
};

module.exports = {
    createNotification,
    getMyNotifications,
    markAsRead,
};