const mongoose = require("mongoose");

const ssiChallengeSchema = new mongoose.Schema(
  {
    challengeId: { type: String, required: true, unique: true, index: true },
    did: { type: String, required: true, index: true, trim: true },
    nonce: { type: String, required: true },
    statement: { type: String, required: true },
    qrText: { type: String, required: true },
    origin: { type: String, default: null },
    status: {
      type: String,
      enum: ["pending", "verified", "rejected", "expired"],
      default: "pending",
      index: true,
    },
    sessionToken: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SsiChallenge", ssiChallengeSchema);
