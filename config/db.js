// const mongoose = require("mongoose");

// const connectDB = async () => {
//     try {
//         const conn = await mongoose.connect(process.env.MONGO_URI);
//         console.log(`MongoDB Connected: ${conn.connection.host}`);
//     } catch (error) {
//         console.error(error.message);
//         process.exit(1);
//     }
// };

// module.exports = connectDB;



const mongoose = require("mongoose");

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI);

        console.log("=================================");
        console.log("MongoDB Host :", conn.connection.host);
        console.log("MongoDB DB   :", conn.connection.name);
        console.log("Mongo URI    :", process.env.MONGO_URI.replace(/\/\/.*:.*@/, "//****:****@"));
        console.log("=================================");

    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
};

module.exports = connectDB;