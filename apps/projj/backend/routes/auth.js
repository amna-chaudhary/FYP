const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Otp = require("../models/Otp");
const SsiChallenge = require("../models/SsiChallenge");
const TrustedDevice = require("../models/TrustedDevice");
const requireAuth = require("../middleware/requireAuth");
const { sendOtpEmail } = require("../utils/mailer");
const {
  buildDidDocument,
  createChallengeStatement,
  decodeDidJwtToken,
  normalizeDidMethod,
  resolveDidDocument,
  sanitizeUserForSession,
  verifyDidSignature,
} = require("../utils/ssi");

const router = express.Router();
let QRCode = null;

try {
  QRCode = require("qrcode");
} catch (err) {
  QRCode = null;
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email || null,
      did: user.did || null,
      authMethods: user.authMethods || [],
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function splitDisplayName(displayName, fallbackDid) {
  const normalized = String(displayName || "").trim();
  if (!normalized) {
    return { firstName: "SSI", lastName: fallbackDid || "User" };
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "SSI",
    lastName: parts.slice(1).join(" ") || "User",
  };
}

function buildOrigin(req) {
  const explicitOrigin = req.get("origin");
  if (explicitOrigin) return explicitOrigin;
  return `${req.protocol}://${req.get("host")}`;
}

async function buildQrDataUrl(qrText) {
  if (!QRCode) return null;
  try {
    return await QRCode.toDataURL(qrText, {
      type: "image/png",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 280,
    });
  } catch (err) {
    console.warn("QR generation failed:", err.message);
    return null;
  }
}

async function upsertSsiUser({ did, didDocument, displayName, walletLabel }) {
  const names = splitDisplayName(displayName, did);
  const authMethods = ["ssi"];

  const update = {
    did,
    didMethod: normalizeDidMethod(did),
    didDocument,
    verified: true,
    walletLabel: walletLabel || "GEC SSI Wallet",
    authMethods,
    firstName: names.firstName,
    lastName: names.lastName,
  };

  const existing = await User.findOne({ did });
  if (existing) {
    existing.didMethod = update.didMethod;
    existing.didDocument = update.didDocument;
    existing.verified = true;
    existing.walletLabel = update.walletLabel;
    existing.firstName = update.firstName;
    existing.lastName = update.lastName;
    existing.authMethods = Array.from(new Set([...(existing.authMethods || []), ...authMethods]));
    await existing.save();
    return existing;
  }

  return User.create({
    ...update,
    email: undefined,
    password: undefined,
  });
}

function validateDidRequest(did, didDocument) {
  if (!did) {
    throw new Error("DID is required.");
  }
  if (!didDocument || typeof didDocument !== "object") {
    throw new Error("DID document is required.");
  }
  if (didDocument.id !== did) {
    throw new Error("DID document id does not match the DID.");
  }
  if (!Array.isArray(didDocument.verificationMethod) || !didDocument.verificationMethod[0]?.publicKeyPem) {
    throw new Error("DID document must include verificationMethod[0].publicKeyPem.");
  }
}

async function issueSsiChallenge(req, payload) {
  validateDidRequest(payload.did, payload.didDocument);

  const user = await upsertSsiUser(payload);
  const challengeId = crypto.randomUUID();
  const nonce = crypto.randomBytes(16).toString("hex");
  const origin = buildOrigin(req);
  const issuedAt = new Date().toISOString();
  const statement = createChallengeStatement({
    did: payload.did,
    challengeId,
    nonce,
    origin,
    issuedAt,
  });
  const expiresInSeconds = Number(process.env.SSI_CHALLENGE_EXPIRY_SECONDS || 300);
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
  const approvalUrl = `${origin}/frontend/index.html?ssiChallenge=${encodeURIComponent(challengeId)}`;
  const qrPayload = {
    type: "gec-ssi-login",
    did: payload.did,
    challengeId,
    statement,
    verifyEndpoint: `${origin}/api/auth/ssi-login/verify`,
    approvalUrl,
    expiresAt: expiresAt.toISOString(),
  };
  const qrText = JSON.stringify(qrPayload);

  await SsiChallenge.deleteMany({ did: payload.did, status: "pending" });
  await SsiChallenge.create({
    challengeId,
    did: payload.did,
    nonce,
    statement,
    qrText,
    origin,
    expiresAt,
  });

  return {
    success: true,
    challenge: {
      challengeId,
      did: payload.did,
      statement,
      qrText,
      qrDataUrl: await buildQrDataUrl(qrText),
      approvalUrl,
      expiresAt: expiresAt.toISOString(),
    },
    user: sanitizeUserForSession(user),
    didDocument: user.didDocument,
  };
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

router.post("/ssi/wallet/register", async (req, res) => {
  try {
    const { did, didDocument, displayName, walletLabel } = req.body || {};
    validateDidRequest(did, didDocument);

    const user = await upsertSsiUser({ did, didDocument, displayName, walletLabel });
    return res.json({
      success: true,
      user: sanitizeUserForSession(user),
      didDocument: user.didDocument,
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message || "Failed to register SSI wallet." });
  }
});

router.post("/ssi-login/challenge", async (req, res) => {
  try {
    const { did, didDocument, displayName, walletLabel } = req.body || {};
    return res.json(await issueSsiChallenge(req, { did, didDocument, displayName, walletLabel }));
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message || "Failed to create SSI challenge." });
  }
});

router.get("/ssi-login/challenge/:challengeId", async (req, res) => {
  try {
    const doc = await SsiChallenge.findOne({ challengeId: req.params.challengeId });
    if (!doc) {
      return res.status(404).json({ success: false, error: "Challenge not found." });
    }

    if (doc.status === "pending" && doc.expiresAt < new Date()) {
      doc.status = "expired";
      await doc.save();
    }

    return res.json({
      success: true,
      challenge: {
        challengeId: doc.challengeId,
        did: doc.did,
        statement: doc.statement,
        status: doc.status,
        expiresAt: doc.expiresAt.toISOString(),
        verifiedAt: doc.verifiedAt ? doc.verifiedAt.toISOString() : null,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Failed to load challenge." });
  }
});

router.post("/ssi-login/verify", async (req, res) => {
  try {
    const { challengeId, did, signature } = req.body || {};
    if (!challengeId || !did || !signature) {
      return res.status(400).json({ success: false, error: "challengeId, did, and signature are required." });
    }

    const challenge = await SsiChallenge.findOne({ challengeId, did });
    if (!challenge) {
      return res.status(404).json({ success: false, error: "SSI challenge not found." });
    }
    if (challenge.status !== "pending") {
      return res.status(400).json({ success: false, error: `Challenge is already ${challenge.status}.` });
    }
    if (challenge.expiresAt < new Date()) {
      challenge.status = "expired";
      await challenge.save();
      return res.status(400).json({ success: false, error: "SSI challenge has expired." });
    }

    const user = await User.findOne({ did });
    if (!user || !user.didDocument) {
      return res.status(404).json({ success: false, error: "Unknown DID. Please register your wallet first." });
    }

    const resolvedDidDocument = await resolveDidDocument({
      did,
      didDocument: user.didDocument,
    });

    const valid = verifyDidSignature({
      didDocument: resolvedDidDocument,
      statement: challenge.statement,
      signature,
    });

    if (!valid) {
      return res.status(401).json({ success: false, error: "Invalid DID signature." });
    }

    const token = signToken(user);
    challenge.status = "verified";
    challenge.verifiedAt = new Date();
    challenge.sessionToken = token;
    await challenge.save();

    return res.json({
      success: true,
      token,
      user: sanitizeUserForSession(user),
      didDocument: user.didDocument,
      challenge: {
        challengeId: challenge.challengeId,
        status: challenge.status,
        verifiedAt: challenge.verifiedAt.toISOString(),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: "SSI verification failed." });
  }
});

router.post("/ssi-login", async (req, res) => {
  try {
    const { credential, did, didDocument, displayName, walletLabel } = req.body || {};
    let payload;

    if (credential && typeof credential === "object") {
      const decoded = credential.jwt ? decodeDidJwtToken(credential.jwt) : null;
      const jwtPayload = decoded?.payload || {};
      payload = {
        didDocument:
          credential.didDocument ||
          jwtPayload.didDocument ||
          (credential.publicKeyPem
            ? buildDidDocument(credential.publicKeyPem, {
                did: credential.did || jwtPayload.iss || jwtPayload.sub,
                walletLabel: credential.walletLabel || jwtPayload.walletLabel || walletLabel,
              })
            : null),
        did: credential.did || jwtPayload.iss || jwtPayload.sub,
        displayName: credential.name || jwtPayload.name || displayName,
        walletLabel: credential.walletLabel || jwtPayload.walletLabel || walletLabel,
      };
    } else {
      payload = { did, didDocument, displayName, walletLabel };
    }

    if (!payload.did && payload.didDocument?.id) {
      payload.did = payload.didDocument.id;
    }

    return res.json(await issueSsiChallenge(req, payload));
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message || "SSI login request is invalid." });
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
