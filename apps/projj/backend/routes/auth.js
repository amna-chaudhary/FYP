const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Otp = require("../models/Otp");
const TrustedDevice = require("../models/TrustedDevice");
const requireAuth = require("../middleware/requireAuth");
const { sendOtpEmail } = require("../utils/mailer");

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

router.post("/register", async (req, res) => {
  try {
    const { firstName, lastName, email, password, confirmPassword } = req.body || {};

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ success: false, error: "All fields are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: "Password must be at least 8 characters" });
    }
    if (confirmPassword !== undefined && confirmPassword !== password) {
      return res.status(400).json({ success: false, error: "Passwords do not match" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing && existing.verified) {
      return res.status(409).json({ success: false, error: "Email already registered" });
    }

    if (existing && !existing.verified) {
      existing.firstName = firstName;
      existing.lastName = lastName;
      existing.password = password;
      await existing.save();
    } else {
      await User.create({ firstName, lastName, email, password, verified: false });
    }

    const code = await Otp.issue(email, "register");
    await sendOtpEmail(email, code, "register");

    return res.status(200).json({
      success: true,
      message: "Verification code sent to your email",
      nextStep: "verify-otp",
      purpose: "register",
      email: email.toLowerCase(),
    });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({ success: false, error: "Registration failed" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password, deviceToken } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email and password required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    const ok = await user.comparePassword(password);
    if (!ok) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    if (!user.verified) {
      const code = await Otp.issue(user.email, "register");
      await sendOtpEmail(user.email, code, "register");
      return res.status(200).json({
        success: true,
        nextStep: "verify-otp",
        purpose: "register",
        email: user.email,
        message: "Please verify your email to continue",
      });
    }

    const trusted = await TrustedDevice.isTrusted(user._id, deviceToken);
    if (trusted) {
      const token = signToken(user);
      return res.json({ success: true, token, user, trusted: true });
    }

    const code = await Otp.issue(user.email, "login");
    await sendOtpEmail(user.email, code, "login");
    return res.status(200).json({
      success: true,
      nextStep: "verify-otp",
      purpose: "login",
      email: user.email,
      message: "New device detected. Verification code sent to your email",
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ success: false, error: "Login failed" });
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const { email, code, purpose } = req.body || {};
    if (!email || !code || !purpose) {
      return res.status(400).json({ success: false, error: "Email, code, and purpose are required" });
    }

    const otp = await Otp.findOne({
      email: email.toLowerCase(),
      purpose,
      consumed: false,
    }).sort({ createdAt: -1 });

    if (!otp) {
      return res.status(400).json({ success: false, error: "No active code. Please request a new one." });
    }

    if (otp.expiresAt < new Date()) {
      return res.status(400).json({ success: false, error: "Code expired. Please request a new one." });
    }

    if (otp.attempts >= 5) {
      return res.status(429).json({ success: false, error: "Too many attempts. Please request a new code." });
    }

    otp.attempts += 1;
    const match = await otp.verifyCode(code);
    if (!match) {
      await otp.save();
      return res.status(400).json({ success: false, error: "Incorrect code" });
    }

    otp.consumed = true;
    await otp.save();

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    if (purpose === "register" && !user.verified) {
      user.verified = true;
      await user.save();
    }

    const deviceToken = await TrustedDevice.issueToken(user._id, "Browser");
    const token = signToken(user);

    return res.json({
      success: true,
      token,
      user,
      deviceToken,
      trusted: true,
    });
  } catch (err) {
    console.error("VERIFY OTP ERROR:", err);
    return res.status(500).json({ success: false, error: "Verification failed" });
  }
});

router.post("/resend-otp", async (req, res) => {
  try {
    const { email, purpose } = req.body || {};
    if (!email || !purpose) {
      return res.status(400).json({ success: false, error: "Email and purpose are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ success: false, error: "No account for that email" });
    }

    const code = await Otp.issue(user.email, purpose);
    await sendOtpEmail(user.email, code, purpose);

    return res.json({ success: true, message: "A new code has been sent to your email" });
  } catch (err) {
    console.error("RESEND OTP ERROR:", err);
    return res.status(500).json({ success: false, error: "Failed to resend code" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    return res.json({ success: true, user });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Failed to load user" });
  }
});

module.exports = router;