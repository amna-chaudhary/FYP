const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName:  { type: String, required: true, trim: true },
    email: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: false, minlength: 8 },
    verified: { type: Boolean, default: false },
    authMethods: {
      type: [String],
      default: ["password"],
      enum: ["password", "ssi"],
    },
    did: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    didMethod: {
      type: String,
      default: null,
      trim: true,
    },
    didDocument: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    walletLabel: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { timestamps: true }
);

userSchema.pre("save", async function () {
  if (!this.password || !this.isModified("password")) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model("User", userSchema);
