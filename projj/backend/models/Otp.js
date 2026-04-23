const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const otpSchema = new mongoose.Schema(
  {
    email:     { type: String, required: true, lowercase: true, index: true },
    codeHash:  { type: String, required: true },
    purpose:   { type: String, enum: ["register", "login"], required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    attempts:  { type: Number, default: 0 },
    consumed:  { type: Boolean, default: false },
  },
  { timestamps: true }
);

otpSchema.methods.verifyCode = function (code) {
  return bcrypt.compare(String(code), this.codeHash);
};

otpSchema.statics.issue = async function (email, purpose) {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const codeHash = await bcrypt.hash(code, 10);
  const minutes = Number(process.env.OTP_EXPIRY_MINUTES || 10);
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

  await this.deleteMany({ email: email.toLowerCase(), purpose, consumed: false });

  await this.create({
    email: email.toLowerCase(),
    codeHash,
    purpose,
    expiresAt,
  });

  return code;
};

module.exports = mongoose.model("Otp", otpSchema);