require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const connectDB = require("./config/db");
const requireAuth = require("./middleware/requireAuth");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const RAG_BASE = (process.env.RAG_SERVICE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const ACTION_BASE = (process.env.ACTION_BACKEND_URL || "http://127.0.0.1:8001").replace(/\/$/, "");

// Keep these aligned with your Aptos / backend config if needed
const DEFAULT_MARKET_ADDR =
  process.env.DEFAULT_MARKET_ADDR ||
  "0xc8c1214ccc5ae055ee5bb1eeac57cec4e760dccbdf7ca52b5d2bbcc1c7ed7cdb";
const DEFAULT_CERT_LOCATION =
  process.env.DEFAULT_CERT_LOCATION ||
  "Lahore";

let dbReady = false;

app.use(cors(
  { origin: '*', credentials: true }
));
app.use(express.json({ limit: "1mb" }));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      success: false,
      reply: {
        type: "answer",
        text: "Invalid JSON body.",
      },
    });
  }
  return next(err);
});

app.use("/public", express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "projj-node-backend",
    port: PORT,
    rag_base: RAG_BASE,
    action_base: ACTION_BASE,
  });
});

// -------------------------
// Auth routes (MongoDB-backed)
// -------------------------
app.use("/api/auth", (req, res, next) => {
  if (dbReady) return next();
  return res.status(503).json({
    success: false,
    error: "Authentication service is temporarily unavailable.",
  });
});
app.use("/api/auth", require("./routes/auth"));
// -------------------------
// Chat routing
// -------------------------
function isProcedureQuestion(text) {
  const t = String(text || "").toLowerCase().trim();
  const hasExplicitAction = isExplicitActionCommand(t);

  const asksForSchemaOrFormat =
    /\b(openapi|swagger|json schema|request body|sample json|required fields|required properties)\b/.test(
      t
    ) ||
    /\bwhat\b.*\b(fields|properties|parameters|json)\b/.test(t) ||
    /\bhow\b.*\b(format|structure|request)\b/.test(t);

  return (
    !hasExplicitAction &&
    (asksForSchemaOrFormat ||
      /\bhow\b/.test(t) ||
      /\bwhat\b/.test(t) ||
      /\bwhy\b/.test(t) ||
      /\bprocedure\b/.test(t) ||
      /\bprocess\b/.test(t) ||
      /\bsteps\b/.test(t) ||
      /\bguide\b/.test(t) ||
      /\bworkflow\b/.test(t) ||
      /\bexplain\b/.test(t) ||
      /\bhelp\b/.test(t) ||
      /\bcan you\b/.test(t) ||
      /\bcould you\b/.test(t) ||
      /\bhow can i\b/.test(t) ||
      /\bwhat is\b/.test(t) ||
      /\bwhat are\b/.test(t) ||
      /\bhow do i\b/.test(t) ||
      /\bhow to\b/.test(t))
  );
}

function isExplicitActionCommand(text) {
  const t = String(text || "").toLowerCase().trim();

  const startsWithQuestion =
    /^(how|what|why|when|where|who|which)\b/i.test(String(text || "").trim());

  const hasActionVerb =
    /\b(issue|mint|transfer|claim|retire|cancel|void|buy|accept|audit|init|list)\b/.test(t);

  // "create a green energy certificate" / "create certificate" (words may appear between)
  const hasCreateCertPhrase =
    /\bcreate\b[\s\S]{0,200}?\b(certificate|certificates|gec)\b/i.test(t);

  const hasGenerateCertPhrase =
    /\b(generate|produce)\b[\s\S]{0,200}?\b(certificate|certificates|gec)\b/i.test(t) ||
    /\b(generate|produce)\b[\s\S]{0,120}?\bgec\b/i.test(t);

  const hasListPhrase =
    /\blist\s+(certificate|certificates|listing|listings)\b/.test(t);

  const hasCertId =
    /\bcert\s+\d+\b/.test(t);

  const hasBundleId =
    /\bbundle[_-]?[a-z0-9_-]+\b/i.test(t);

  const hasAddress =
    /\b0x[a-f0-9]{10,}\b/i.test(t);

  const hasQuantity =
    /\b\d+(\.\d+)?\s*(kwh|mwh|wh|gec|gecs)?\b/i.test(t);

  const hasConcreteTransfer =
    /\btransfer\b/.test(t) && (hasCertId || hasBundleId || hasAddress);

  const hasConcreteIssue =
    /\b(issue|mint|generate|produce)\b/.test(t) && hasQuantity;

  const hasIssueOrMintWithEnergySource =
    !startsWithQuestion &&
    /\b(issue|mint|generate|produce)\b/.test(t) &&
    /\b(solar|wind|hydro|geothermal|biomass|nuclear|thermal|renewable)\b/.test(t);

  return (
    hasConcreteIssue ||
    hasConcreteTransfer ||
    hasCreateCertPhrase ||
    hasGenerateCertPhrase ||
    hasListPhrase ||
    hasIssueOrMintWithEnergySource ||
    (hasActionVerb && (hasCertId || hasBundleId || hasAddress || hasQuantity))
  );
}

function isActionIntent(text) {
  const t = String(text || "").trim();
  if (!t) return false;

  if (isProcedureQuestion(t)) {
    return false;
  }

  return isExplicitActionCommand(t);
}

function isActionFollowup(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;
  return /^(yes|y|no|n|cancel|confirm|proceed|continue|ok|okay)$/i.test(t);
}

function normalizeActionCommand(text) {
  const raw = String(text || "").trim();
  if (!raw) return raw;

  const lower = raw.toLowerCase();
  const looksLikeIssue =
    /\b(issue|mint|create|generate|produce)\b/.test(lower) &&
    /\b(certificate|certificates|gec)\b/.test(lower);

  const hasLocation =
    /\blocation\b/.test(lower) ||
    /\bin\s+[a-z]/.test(lower);

  if (looksLikeIssue && !hasLocation) {
    return `${raw} location ${DEFAULT_CERT_LOCATION}`;
  }

  return raw;
}

async function callRag(message, userId) {
  const url = `${RAG_BASE}/chat`;
  const response = await axios.post(
    url,
    { message, userId },
    { timeout: 30000 }
  );

  if (response.data?.success && response.data?.reply) {
    return response.data;
  }

  if (response.data?.answer) {
    return {
      success: true,
      reply: {
        type: "answer",
        text: response.data.answer,
      },
    };
  }

  return {
    success: true,
    reply: {
      type: "answer",
      text: "RAG service returned unexpected format.",
    },
  };
}

async function callActionBackend(message, userId, authorization) {
  const url = `${ACTION_BASE}/chat`;
  const response = await axios.post(
    url,
    { message, userId },
    {
      timeout: 30000,
      headers: authorization ? { Authorization: authorization } : {},
    }
  );

  if (response.data?.success && response.data?.reply) {
    return response.data;
  }

  return {
    success: true,
    reply: {
      type: "answer",
      text: "Action backend returned unexpected format.",
    },
  };
}

app.post("/api/chat", requireAuth, async (req, res) => {
  const { message } = req.body || {};
  const uid = req.userEmail || req.userId;
  const authorization = req.headers.authorization || "";

  if (!message || typeof message !== "string") {
    return res.status(400).json({
      success: false,
      reply: {
        type: "answer",
        text: "message is required",
      },
    });
  }

  const raw = message.trim();
  const normalized = normalizeActionCommand(raw);

  try {
    if (isActionIntent(raw) || isActionFollowup(raw)) {
      console.log("➡️ Routed to ACTION backend:", normalized);
      const result = await callActionBackend(normalized, uid, authorization);
      return res.json(result);
    }

    console.log("➡️ Routed to RAG backend:", raw);
    const result = await callRag(raw, uid);
    return res.json(result);
  } catch (err) {
    console.error("CHAT ROUTER ERROR:", err?.response?.data || err?.message || err);

    return res.status(500).json({
      success: false,
      reply: {
        type: "answer",
        text: "Server error while routing request.",
      },
    });
  }
});

// -------------------------
// Marketplace proxy routes
// -------------------------
async function forwardActionGet(pathname) {
  const url = `${ACTION_BASE}${pathname}`;
  const response = await axios.get(url, { timeout: 30000 });
  return response.data;
}

async function forwardActionGetAuthed(pathname, authorization) {
  const url = `${ACTION_BASE}${pathname}`;
  const response = await axios.get(url, {
    timeout: 30000,
    headers: authorization ? { Authorization: authorization } : {},
  });
  return response.data;
}

async function forwardActionPost(pathname, body) {
  const url = `${ACTION_BASE}${pathname}`;
  const response = await axios.post(url, body, { timeout: 30000 });
  return response.data;
}

// -------------------------
// Certificates proxy routes
// -------------------------
app.get("/api/certificates/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const authorization = req.headers.authorization || "";
    const data = await forwardActionGetAuthed(`/certificates/${encodeURIComponent(id)}`, authorization);
    return res.json(data);
  } catch (err) {
    console.error("CERTIFICATE DETAIL ERROR:", err?.response?.data || err?.message || err);
    const status = err?.response?.status || 500;
    return res.status(status).json({
      success: false,
      error:
        err?.response?.data?.error ||
        err?.response?.data?.detail ||
        err?.message ||
        "Failed to fetch certificate",
    });
  }
});

// real stats from action backend
app.get("/api/market/stats", requireAuth, async (req, res) => {
  try {
    const marketAddr = req.query.market_addr || DEFAULT_MARKET_ADDR;
    const data = await forwardActionGet(`/marketplace/${marketAddr}/stats`);
    return res.json({ success: true, stats: data });
  } catch (err) {
    console.error("MARKET STATS ERROR:", err?.response?.data || err?.message || err);
    return res.status(500).json({
      success: false,
      error:
        err?.response?.data?.detail ||
        err?.message ||
        "Failed to fetch marketplace stats",
    });
  }
});

// create listing
app.post("/api/market/list", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const data = await forwardActionPost("/marketplace/list", body);
    return res.json({ success: true, result: data });
  } catch (err) {
    console.error("MARKET LIST ERROR:", err?.response?.data || err?.message || err);
    return res.status(500).json({
      success: false,
      error:
        err?.response?.data?.detail ||
        err?.message ||
        "Failed to create listing",
    });
  }
});

// request buy
app.post("/api/market/request-buy", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const data = await forwardActionPost("/marketplace/request-buy", body);
    return res.json({ success: true, result: data });
  } catch (err) {
    console.error("MARKET REQUEST BUY ERROR:", err?.response?.data || err?.message || err);
    return res.status(500).json({
      success: false,
      error:
        err?.response?.data?.detail ||
        err?.message ||
        "Failed to request buy",
    });
  }
});

// accept buy
app.post("/api/market/accept-buy", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const data = await forwardActionPost("/marketplace/accept-buy", body);
    return res.json({ success: true, result: data });
  } catch (err) {
    console.error("MARKET ACCEPT BUY ERROR:", err?.response?.data || err?.message || err);
    return res.status(500).json({
      success: false,
      error:
        err?.response?.data?.detail ||
        err?.message ||
        "Failed to accept buy request",
    });
  }
});

// cancel listing
app.post("/api/market/cancel", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const data = await forwardActionPost("/marketplace/cancel", body);
    return res.json({ success: true, result: data });
  } catch (err) {
    console.error("MARKET CANCEL ERROR:", err?.response?.data || err?.message || err);
    return res.status(500).json({
      success: false,
      error:
        err?.response?.data?.detail ||
        err?.message ||
        "Failed to cancel listing",
    });
  }
});

// temporary session-derived listings endpoint
// This gives the frontend something real to refresh against right now.
app.post("/api/market/session-listings", requireAuth, async (req, res) => {
  try {
    const { registry } = req.body || {};
    const txs = Array.isArray(registry?.txs) ? registry.txs : [];

    const issued = txs.filter((tx) => tx.action === "issue");
    const retired = txs.filter((tx) => tx.action === "retire");
    const transfers = txs.filter((tx) => tx.action === "transfer");

    let nextId = 1;
    const listings = [];

    for (const tx of issued) {
      const qty = Number(tx.quantity) || 0;
      if (qty <= 0) continue;

      listings.push({
        id: nextId++,
        type: "sell",
        status: "open",
        cert_id: tx.certId || null,
        title: `${tx.energySource || "Renewable"} – ${qty} MWh`,
        subtitle: `${tx.to || "Account"} · Session-issued certificate`,
        price: tx.price || null,
        priceText: tx.price ? `$ ${tx.price} / MWh` : "Dynamic / session",
        volume: qty,
        energySource: tx.energySource || "Unknown",
        from: tx.from || null,
        to: tx.to || null,
        raw: tx,
      });
    }

    if (retired.length > 0) {
      const retiredQty = retired.reduce((sum, tx) => sum + (Number(tx.quantity) || 0), 0);
      listings.push({
        id: nextId++,
        type: "buy",
        status: "open",
        cert_id: null,
        title: `Replacement demand – ${retiredQty} MWh`,
        subtitle: "Derived from retired certificates in this session",
        price: null,
        priceText: "Dynamic / session",
        volume: retiredQty,
        energySource: "Replacement supply",
        raw: { retired },
      });
    }

    if (transfers.length > 0) {
      const latestTransfer = transfers[transfers.length - 1];
      listings.push({
        id: nextId++,
        type: "sell",
        status: "moved",
        cert_id: latestTransfer.certId || null,
        title: `Transferred – ${Number(latestTransfer.quantity) || 0} MWh`,
        subtitle: `${latestTransfer.from || "Source"} → ${latestTransfer.to || "Target"}`,
        price: null,
        priceText: "Completed",
        volume: Number(latestTransfer.quantity) || 0,
        energySource: latestTransfer.energySource || "Unknown",
        raw: latestTransfer,
      });
    }

    return res.json({ success: true, listings });
  } catch (err) {
    console.error("SESSION LISTINGS ERROR:", err?.message || err);
    return res.status(500).json({
      success: false,
      error: "Failed to build session listings",
    });
  }
});

connectDB().then((connected) => {
  dbReady = connected;
  if (!connected) {
    console.warn("⚠️ Auth routes disabled until MongoDB becomes available.");
  }
});
app.listen(PORT, () => {
  console.log(`✅ Node router listening on http://localhost:${PORT}`);
});
