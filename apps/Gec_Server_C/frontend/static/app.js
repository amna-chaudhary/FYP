const STORAGE_KEYS = {
  token: "gec_frontend_token",
  user: "gec_frontend_user",
  apiBase: "gec_frontend_api_base",
  draftPrompt: "gec_frontend_chat_draft",
};

const DEFAULT_API_BASE = window.localStorage.getItem(STORAGE_KEYS.apiBase) || "http://localhost:8000";

function $(selector) {
  return document.querySelector(selector);
}

function readJson(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function getSession() {
  return {
    token: window.localStorage.getItem(STORAGE_KEYS.token),
    user: readJson(STORAGE_KEYS.user, null),
    apiBase: DEFAULT_API_BASE,
  };
}

function saveSession(token, user) {
  window.localStorage.setItem(STORAGE_KEYS.token, token);
  writeJson(STORAGE_KEYS.user, user);
}

function clearSession() {
  window.localStorage.removeItem(STORAGE_KEYS.token);
  window.localStorage.removeItem(STORAGE_KEYS.user);
}

function requireSession() {
  const session = getSession();
  if (!session.token) {
    window.location.href = "./index.html";
    return null;
  }
  return session;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setAlert(targetId, message, variant = "") {
  const el = document.getElementById(targetId);
  if (!el) return;
  if (!message) {
    el.className = "alert hidden";
    el.textContent = "";
    return;
  }
  el.className = `alert ${variant ? `is-${variant}` : ""}`.trim();
  el.textContent = message;
}

async function apiFetch(path, options = {}) {
  const session = getSession();
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (session.token) headers.set("Authorization", `Bearer ${session.token}`);

  const response = await fetch(`${session.apiBase}${path}`, {
    ...options,
    headers,
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      body?.error?.message ||
      body?.detail ||
      `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = body;
    throw error;
  }

  return body;
}

function generateQrSvg(seedText) {
  const size = 21;
  let seed = 0;
  for (let i = 0; i < seedText.length; i += 1) {
    seed = (seed * 31 + seedText.charCodeAt(i)) % 2147483647;
  }
  const next = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };

  const cells = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inFinder =
        (x < 7 && y < 7) ||
        (x > size - 8 && y < 7) ||
        (x < 7 && y > size - 8);
      let dark = next() > 0.52;
      if (inFinder) {
        const localX = x < 7 ? x : x - (size - 7);
        const localY = y < 7 ? y : y - (size - 7);
        dark =
          localX === 0 || localX === 6 || localY === 0 || localY === 6 ||
          (localX >= 2 && localX <= 4 && localY >= 2 && localY <= 4);
      }
      if (dark) {
        cells.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="#163d2f" />`);
      }
    }
  }
  return `
    <svg viewBox="0 0 ${size} ${size}" width="220" height="220" role="img" aria-label="QR challenge preview">
      <rect width="${size}" height="${size}" fill="#ffffff"></rect>
      ${cells.join("")}
    </svg>
  `;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString() : value ?? "—";
}

function getStatusPill(status) {
  return `<span class="status-pill">${escapeHtml(status || "UNKNOWN")}</span>`;
}

function addLogoutHandler() {
  const btn = document.getElementById("logout-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    clearSession();
    window.location.href = "./index.html";
  });
}

async function loadNotifications() {
  const panel = document.getElementById("notification-panel");
  const toggle = document.getElementById("notification-toggle");
  if (!panel || !toggle) return;

  toggle.addEventListener("click", async () => {
    const willOpen = panel.classList.contains("hidden");
    panel.classList.toggle("hidden");
    toggle.setAttribute("aria-expanded", String(willOpen));
    if (!willOpen) return;
    try {
      const data = await apiFetch("/notifications");
      const items = data.items || [];
      panel.innerHTML = `
        <p class="eyebrow">TODO-8.6</p>
        <h3>Recent activity</h3>
        <div class="notification-list">
          ${items.length ? items.map((item) => `
            <article class="notification-item">
              <h4>${escapeHtml(item.title)}</h4>
              <p>${escapeHtml(item.body)}</p>
              <span class="bubble-meta">${formatDate(item.created_at)}</span>
            </article>
          `).join("") : `<div class="empty-state">No notifications yet.</div>`}
        </div>
      `;
    } catch (error) {
      panel.innerHTML = `<div class="alert">Unable to load notifications: ${escapeHtml(error.message)}</div>`;
    }
  });

  document.addEventListener("click", (event) => {
    if (!panel.contains(event.target) && event.target !== toggle) {
      panel.classList.add("hidden");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
}

function renderSessionSummary(targetId = "session-summary") {
  const el = document.getElementById(targetId);
  if (!el) return;
  const { user } = getSession();
  el.innerHTML = user ? `
    <div class="detail-grid">
      <div class="detail-item">
        <label>DID</label>
        <div class="mono">${escapeHtml(user.did || "—")}</div>
      </div>
      <div class="detail-item">
        <label>Account</label>
        <div class="mono">${escapeHtml(user.accountAddress || "—")}</div>
      </div>
      <div class="detail-item">
        <label>Display name</label>
        <div>${escapeHtml(user.displayName || "—")}</div>
      </div>
      <div class="detail-item">
        <label>API</label>
        <div class="mono">${escapeHtml(DEFAULT_API_BASE)}</div>
      </div>
    </div>
  ` : `<div class="empty-state">No active session.</div>`;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function initLoginPage() {
  const { token, user } = getSession();
  const qrPreview = document.getElementById("qr-preview");
  const qrCaption = document.getElementById("qr-caption");
  const sessionCard = document.getElementById("login-session-card");
  const form = document.getElementById("login-form");
  const previewBtn = document.getElementById("preview-qr");

  const buildChallengeSeed = () => {
    const did = document.getElementById("did").value.trim() || "did:example:guest";
    const account = document.getElementById("accountAddress").value.trim() || "0xpreview";
    return JSON.stringify({ type: "ssi-login", did, account, ts: new Date().toISOString() });
  };

  const showChallenge = (seed, caption) => {
    qrPreview.innerHTML = generateQrSvg(seed);
    qrCaption.textContent = caption;
  };

  if (token && user) {
    sessionCard.classList.remove("hidden");
    sessionCard.innerHTML = `
      <p class="eyebrow">Existing session</p>
      <h3>${escapeHtml(user.displayName || user.did)}</h3>
      <p class="muted">You are already authenticated. Continue to the dashboard or create a new session.</p>
      <div class="form-actions">
        <a class="primary-btn" href="./chat.html">Open dashboard</a>
      </div>
    `;
    showChallenge(JSON.stringify(user), `Active SSI session for ${user.did}`);
  }

  previewBtn.addEventListener("click", () => {
    showChallenge(buildChallengeSeed(), "Challenge preview generated locally.");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setAlert("global-alert", "");
    const payload = {
      did: document.getElementById("did").value.trim(),
      accountAddress: document.getElementById("accountAddress").value.trim(),
      displayName: document.getElementById("displayName").value.trim(),
      walletLabel: document.getElementById("walletLabel").value.trim(),
    };
    try {
      const data = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      saveSession(data.token, data.user);
      showChallenge(JSON.stringify(data.challenge), `Session created for ${data.user.did}`);
      sessionCard.classList.remove("hidden");
      sessionCard.innerHTML = `
        <p class="eyebrow">Session ready</p>
        <h3>${escapeHtml(data.user.displayName || data.user.did)}</h3>
        <p class="muted">JWT session stored successfully. Continue into the chat dashboard to use the authenticated agent.</p>
        <div class="form-actions">
          <a class="primary-btn" href="./chat.html">Continue to chat</a>
          <a class="secondary-btn" href="./registry.html">Open registry</a>
        </div>
      `;
    } catch (error) {
      setAlert("global-alert", error.message);
      showChallenge(buildChallengeSeed(), "Challenge preview available, but session creation failed.");
    }
  });
}

function appendChatBubble(target, role, html, meta = "") {
  const bubble = document.createElement("article");
  bubble.className = `chat-bubble ${role}`;
  bubble.innerHTML = `${html}${meta ? `<span class="bubble-meta">${meta}</span>` : ""}`;
  target.appendChild(bubble);
  target.scrollTop = target.scrollHeight;
}

function describeMcpResult(normalized) {
  const body = normalized?.body || {};
  const lines = [];
  if (body.success) lines.push("Action completed successfully.");
  if (body.cert_id != null) lines.push(`Certificate ID: GEC-${body.cert_id}`);
  if (body.tx_hash) lines.push(`Transaction: ${body.tx_hash}`);
  if (body.energy_source) lines.push(`Energy source: ${body.energy_source}`);
  if (body.location) lines.push(`Location: ${body.location}`);
  return `
    <div class="mcp-card">
      <strong>Tool result</strong>
      <div>${lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("") || "Response received."}</div>
    </div>
  `;
}

async function initChatPage() {
  const session = requireSession();
  if (!session) return;
  renderSessionSummary();
  addLogoutHandler();
  loadNotifications();

  const messages = document.getElementById("chat-messages");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const typing = document.getElementById("typing-indicator");
  const reportForm = document.getElementById("report-form");
  const draft = window.localStorage.getItem(STORAGE_KEYS.draftPrompt);

  appendChatBubble(
    messages,
    "agent",
    `<p>Welcome back, <strong>${escapeHtml(session.user?.displayName || session.user?.did || "operator")}</strong>.</p><p>I can help with certificates, registry lookups, marketplace tasks, and reports.</p>`,
    "Authenticated session ready"
  );

  if (draft) {
    input.value = draft;
    window.localStorage.removeItem(STORAGE_KEYS.draftPrompt);
  }

  document.querySelectorAll("[data-draft]").forEach((button) => {
    button.addEventListener("click", () => {
      input.value = button.dataset.draft || "";
      input.focus();
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    setAlert("chat-alert", "");
    appendChatBubble(messages, "user", `<p>${escapeHtml(message)}</p>`, new Date().toLocaleTimeString());
    input.value = "";
    typing.classList.remove("hidden");
    try {
      const data = await apiFetch("/chat", {
        method: "POST",
        body: JSON.stringify({ message, userId: session.user?.did }),
      });
      const reply = data.reply || {};
      if (reply.type === "mcp_result") {
        appendChatBubble(
          messages,
          "agent",
          `<p>The requested action was processed.</p>${describeMcpResult(reply.mcp_response)}`,
          "Blockchain + registry response"
        );
      } else {
        appendChatBubble(messages, "agent", `<p>${escapeHtml(reply.text || "No response text returned.")}</p>`, "Agent response");
      }
    } catch (error) {
      setAlert("chat-alert", error.message);
      appendChatBubble(messages, "agent", `<p>I couldn’t complete that request: ${escapeHtml(error.message)}</p>`, "Error");
    } finally {
      typing.classList.add("hidden");
    }
  });

  reportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await apiFetch("/reports");
      const type = document.getElementById("report-type").value;
      const from = document.getElementById("report-from").value;
      const to = document.getElementById("report-to").value;
      const payload = {
        type,
        filters: { from, to },
        generatedAt: new Date().toISOString(),
        report: data.report,
      };
      downloadJson(`gec-${type}-report.json`, payload);
      setAlert("chat-alert", "Report downloaded successfully.", "warning");
    } catch (error) {
      setAlert("chat-alert", `Unable to generate report: ${error.message}`);
    }
  });
}

function buildCertificateCard(item) {
  return `
    <article class="data-card" data-cert-id="${escapeHtml(item.id)}">
      <div class="panel-header compact">
        <div>
          <h3>${escapeHtml(item.id)}</h3>
          <p class="muted">${escapeHtml(item.energy_source)} • ${formatNumber(item.energy_amount)} kWh</p>
        </div>
        ${getStatusPill(item.status)}
      </div>
      <div class="meta-grid">
        <div class="meta-item"><label>Owner DID</label><div class="mono">${escapeHtml(item.owner_did)}</div></div>
        <div class="meta-item"><label>Location</label><div>${escapeHtml(item.location || "—")}</div></div>
        <div class="meta-item"><label>Production start</label><div>${formatDate(item.prod_start)}</div></div>
        <div class="meta-item"><label>Transaction</label><div class="mono">${escapeHtml(item.tx_hash || "—")}</div></div>
      </div>
      <div class="detail-actions">
        <button class="secondary-btn" type="button" data-action="view-cert" data-cert-id="${escapeHtml(item.id)}">View detail</button>
        <a class="ghost-link" href="./certificate.html?id=${encodeURIComponent(item.id)}">Open page</a>
      </div>
    </article>
  `;
}

function renderCertificateDetail(targetId, payload) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const cert = payload.certificate;
  const history = payload.transactionHistory || [];
  target.className = "detail-layout";
  const documentMarkup = window.renderCertificate
    ? (() => {
        const mount = document.createElement("div");
        window.renderCertificate(mount, payload);
        return mount.innerHTML;
      })()
    : `
      <section class="detail-block">
        <div class="panel-header compact">
          <div>
            <h3>${escapeHtml(cert.id)}</h3>
            <p class="muted">${escapeHtml(cert.energy_source)} • ${formatNumber(cert.energy_amount)} kWh • ${escapeHtml(cert.location || "—")}</p>
          </div>
          ${getStatusPill(cert.status)}
        </div>
      </section>
    `;

  target.innerHTML = `
    ${documentMarkup}
    <section class="detail-block certificate-history-wrap">
      <div class="certificate-actions">
        <a class="primary-btn" href="./certificate.html?id=${encodeURIComponent(cert.id)}">Open certificate page</a>
        <button class="secondary-btn" type="button" data-print-certificate="true">Print / Save PDF</button>
        <button class="secondary-btn" type="button" data-copy="${escapeHtml(cert.tx_hash || "")}">Copy tx hash</button>
        <button class="secondary-btn" type="button" data-draft-action="Show details for certificate ${escapeHtml(cert.id)}.">Ask agent</button>
      </div>
    </section>
    <section class="detail-block">
      <h3>Transaction history</h3>
      ${history.length ? `
        <table class="history-table">
          <thead>
            <tr><th>Operation</th><th>Actor</th><th>Recipient</th><th>Time</th><th>Tx</th></tr>
          </thead>
          <tbody>
            ${history.map((entry) => `
              <tr>
                <td>${escapeHtml(entry.operation)}</td>
                <td class="mono">${escapeHtml(entry.actor_did)}</td>
                <td class="mono">${escapeHtml(entry.recipient_did || "—")}</td>
                <td>${formatDate(entry.occurred_at)}</td>
                <td class="mono">${escapeHtml(entry.tx_hash || "—")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="empty-state">No transactions found for this certificate.</div>`}
    </section>
  `;

  target.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = button.dataset.copy || "";
      if (!value) return;
      await navigator.clipboard.writeText(value);
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = "Copy tx hash";
      }, 1200);
    });
  });

  target.querySelectorAll("[data-draft-action]").forEach((button) => {
    button.addEventListener("click", () => {
      window.localStorage.setItem(STORAGE_KEYS.draftPrompt, button.dataset.draftAction || "");
      window.location.href = "./chat.html";
    });
  });

  target.querySelectorAll("[data-print-certificate]").forEach((button) => {
    button.addEventListener("click", () => {
      window.print();
    });
  });
}

async function loadRegistryList(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/certificates${suffix}`);
}

async function initRegistryPage() {
  const session = requireSession();
  if (!session) return;
  addLogoutHandler();
  loadNotifications();

  const list = document.getElementById("registry-list");
  const detail = document.getElementById("certificate-detail");
  const form = document.getElementById("registry-filter-form");
  const refreshBtn = document.getElementById("registry-refresh");

  const refresh = async () => {
    try {
      setAlert("registry-alert", "");
      const data = await loadRegistryList({
        status: document.getElementById("filter-status").value,
        energy_source: document.getElementById("filter-energy-source").value.trim(),
        start_from: document.getElementById("filter-start-from").value,
        start_to: document.getElementById("filter-start-to").value,
      });
      const items = data.items || [];
      list.innerHTML = items.length
        ? items.map(buildCertificateCard).join("")
        : `<div class="empty-state">No certificates match the current filters.</div>`;

      list.querySelectorAll("[data-action='view-cert']").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            const certData = await apiFetch(`/certificates/${encodeURIComponent(button.dataset.certId)}`);
            renderCertificateDetail("certificate-detail", certData);
          } catch (error) {
            setAlert("registry-alert", error.message);
          }
        });
      });

      if (items[0]) {
        const certData = await apiFetch(`/certificates/${encodeURIComponent(items[0].id)}`);
        renderCertificateDetail("certificate-detail", certData);
      } else {
        detail.className = "empty-state";
        detail.textContent = "No certificate selected.";
      }
    } catch (error) {
      setAlert("registry-alert", error.message);
      list.innerHTML = `<div class="empty-state">Unable to load the registry right now.</div>`;
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    refresh();
  });
  refreshBtn.addEventListener("click", refresh);
  refresh();
}

function buildMarketplaceCard(item, currentDid) {
  const mine = item.seller_did === currentDid;
  return `
    <article class="data-card">
      <div class="panel-header compact">
        <div>
          <h3>${escapeHtml(item.certificate_id || item.listing_id || "Listing")}</h3>
          <p class="muted">${escapeHtml(item.currency || "PKR")} ${formatNumber(item.price)}</p>
        </div>
        ${getStatusPill(item.status)}
      </div>
      <div class="meta-grid">
        <div class="meta-item"><label>Seller</label><div class="mono">${escapeHtml(item.seller_did || "—")}</div></div>
        <div class="meta-item"><label>Buyer</label><div class="mono">${escapeHtml(item.buyer_did || "—")}</div></div>
        <div class="meta-item"><label>Updated</label><div>${formatDate(item.updated_at)}</div></div>
        <div class="meta-item"><label>Tx hash</label><div class="mono">${escapeHtml(item.tx_hash || "—")}</div></div>
      </div>
      <div class="detail-actions">
        <button class="primary-btn" type="button" data-market-draft="${mine ? `Cancel marketplace listing ${item.listing_id || item.certificate_id}.` : `Buy certificate ${item.certificate_id || item.listing_id} from the marketplace.`}">${mine ? "Cancel via agent" : "Buy via agent"}</button>
        <a class="ghost-link" href="./certificate.html?id=${encodeURIComponent(item.certificate_id || "")}">View certificate</a>
      </div>
    </article>
  `;
}

async function initMarketplacePage() {
  const session = requireSession();
  if (!session) return;
  addLogoutHandler();
  loadNotifications();

  const list = document.getElementById("marketplace-list");
  let currentTab = "all";

  const refresh = async () => {
    try {
      setAlert("marketplace-alert", "");
      const data = await apiFetch("/marketplace");
      let items = data.items || [];
      if (currentTab === "mine") {
        items = items.filter((item) => item.seller_did === session.user?.did);
      }
      list.innerHTML = items.length
        ? items.map((item) => buildMarketplaceCard(item, session.user?.did)).join("")
        : `<div class="empty-state">No listings available for this view.</div>`;

      list.querySelectorAll("[data-market-draft]").forEach((button) => {
        button.addEventListener("click", () => {
          window.localStorage.setItem(STORAGE_KEYS.draftPrompt, button.dataset.marketDraft || "");
          window.location.href = "./chat.html";
        });
      });
    } catch (error) {
      setAlert("marketplace-alert", error.message);
      list.innerHTML = `<div class="empty-state">Unable to load marketplace listings.</div>`;
    }
  };

  document.querySelectorAll("[data-market-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      currentTab = button.dataset.marketTab;
      document.querySelectorAll("[data-market-tab]").forEach((btn) => btn.classList.remove("is-active"));
      button.classList.add("is-active");
      refresh();
    });
  });

  document.getElementById("marketplace-refresh").addEventListener("click", refresh);
  document.getElementById("open-buy-draft").addEventListener("click", () => {
    window.localStorage.setItem(STORAGE_KEYS.draftPrompt, "Buy a certificate from the marketplace.");
    window.location.href = "./chat.html";
  });
  document.getElementById("open-sell-draft").addEventListener("click", () => {
    window.localStorage.setItem(STORAGE_KEYS.draftPrompt, "List my certificate for sale on the marketplace.");
    window.location.href = "./chat.html";
  });

  refresh();
}

async function initCertificatePage() {
  const session = requireSession();
  if (!session) return;
  addLogoutHandler();
  loadNotifications();

  const params = new URLSearchParams(window.location.search);
  const certId = params.get("id");
  if (!certId) return;
  try {
    const data = await apiFetch(`/certificates/${encodeURIComponent(certId)}`);
    renderCertificateDetail("certificate-page-detail", data);
  } catch (error) {
    setAlert("certificate-alert", error.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "login") initLoginPage();
  if (page === "chat") initChatPage();
  if (page === "registry") initRegistryPage();
  if (page === "marketplace") initMarketplacePage();
  if (page === "certificate") initCertificatePage();
});
