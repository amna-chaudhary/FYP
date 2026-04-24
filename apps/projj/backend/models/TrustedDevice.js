const mongoose = require("mongoose");
const crypto = require("crypto");

const trustedDeviceSchema = new mongoose.Schema(
  {
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash:  { type: String, required: true, unique: true },
    label:      { type: String, default: "Browser" },
    lastSeenAt: { type: Date, default: Date.now },
    expiresAt:  { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

trustedDeviceSchema.statics.issueToken = async function (userId, label) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const days = Number(process.env.DEVICE_TRUST_DAYS || 30);

  await this.create({
    userId,
    tokenHash,
    label: label || "Browser",
    expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  });

  return rawToken;
};

trustedDeviceSchema.statics.isTrusted = async function (userId, rawToken) {
  if (!rawToken) return false;
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const doc = await this.findOne({ userId, tokenHash });
  if (!doc) return false;
  doc.lastSeenAt = new Date();
  await doc.save();
  return true;
};

module.exports = mongoose.model("TrustedDevice", trustedDeviceSchema);