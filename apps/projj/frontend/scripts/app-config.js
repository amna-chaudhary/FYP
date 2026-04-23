// app-config.js

// -------------------------
// API endpoints
// -------------------------
// IMPORTANT:
// Frontend must talk to the NODE ROUTER, not directly to action backend.
// Router decides whether request goes to RAG backend or Action backend.
const API_URL = "http://127.0.0.1:3000/api/chat";
const AUTH_SSI_URL = "http://localhost:3000/api/auth/ssi-login";

// -------------------------
// Local storage keys
// -------------------------
const STORAGE_KEY = "gec_chat_state_v2";
const USER_KEY = "gecUser_plain";
const TOKEN_KEY = "gecToken_plain";

// -------------------------
// Global state
// -------------------------
const state = {
  conversations: [],
  currentId: null,
  view: "chat", // "chat" | "market" | "registry"
  user: null,
  token: null,
  lastUserMessage: "",
  isTyping: false,
  search: "",
  mode: null,
  audience: null,
  showSources: false,
  registry: {
    accounts: {},
    txs: [],
    rejected: []
  }
};

// -------------------------
// Helpers
// -------------------------
function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function _emptyRegistry() {
  return {
    accounts: {},
    txs: [],
    rejected: []
  };
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed.conversations)) {
      state.conversations = parsed.conversations;
    }

    state.currentId = parsed.currentId || null;
    state.view = parsed.view || "chat";
    state.search = parsed.search || "";
    state.marketplace = parsed.marketplace || state.marketplace || null;

    if (parsed.registry && typeof parsed.registry === "object") {
      state.registry = {
        accounts: parsed.registry.accounts || {},
        txs: Array.isArray(parsed.registry.txs) ? parsed.registry.txs : [],
        rejected: Array.isArray(parsed.registry.rejected) ? parsed.registry.rejected : []
      };
    } else {
      state.registry = _emptyRegistry();
    }
  } catch (e) {
    console.error("Failed to load app state:", e);
    state.registry = _emptyRegistry();
  }
}

function saveToStorage() {
  try {
    const payload = {
      conversations: state.conversations,
      currentId: state.currentId,
      view: state.view,
      search: state.search,
      registry: state.registry,
      marketplace: state.marketplace || null
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.error("Failed to save app state:", e);
  }
}

function loadUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) state.user = JSON.parse(raw);

    const token = localStorage.getItem(TOKEN_KEY);
    if (token) state.token = token;
  } catch (e) {
    console.error("Failed to load user:", e);
  }
}

function saveUser() {
  try {
    if (state.user) localStorage.setItem(USER_KEY, JSON.stringify(state.user));
    else localStorage.removeItem(USER_KEY);

    if (state.token) localStorage.setItem(TOKEN_KEY, state.token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    console.error("Failed to save user:", e);
  }
}

function markdownToHtml(text) {
  if (!text) return "";

  let s = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  s = s.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  s = s.replace(/^## (.*)$/gm, "<h2>$1</h2>");
  s = s.replace(/^# (.*)$/gm, "<h1>$1</h1>");
  s = s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*(.*?)\*/g, "<em>$1</em>");
  s = s.replace(/^> (.*)$/gm, "<blockquote>$1</blockquote>");
  s = s.replace(/^\s*[-•] (.*)$/gm, "<li>$1</li>");
  s = s.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");
  s = s.replace(/\n{2,}/g, "</p><p>");

  return "<p>" + s + "</p>";
}

function getActiveConversation() {
  return state.conversations.find((c) => c.id === state.currentId) || null;
}

function hasUserMessage(conv) {
  return conv && conv.messages && conv.messages.some((m) => m.sender === "user");
}

// -------------------------
// Safe JSON POST helper
// -------------------------
async function apiPostJson(url, payload, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const headers = { "Content-Type": "application/json" };

    if (state.token) {
      headers["Authorization"] = `Bearer ${state.token}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });

    const text = await res.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      throw new Error("Backend returned non-JSON response:\n" + text);
    }

    if (!res.ok) {
      throw new Error(
        (data && (data.error || data.message || data.detail)) || res.statusText
      );
    }

    return data;
  } finally {
    clearTimeout(t);
  }
}