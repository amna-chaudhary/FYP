const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB Connected");
    return true;
  } catch (err) {
    console.error("❌ DB Error:", err.message);
    return false;
  }
};

module.exports = connectDB;
