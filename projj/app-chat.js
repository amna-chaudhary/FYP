/* =============================================================
   EnergyCert Bot — app-chat.js
   Replaces renderHistory + renderMessages with modern versions:
   - Pin/unpin chats (persisted via saveToStorage)
   - Section headers (Pinned / Chats) with counts
   - Proper empty states
   - Message Copy / Edit / Retry built-in
   ============================================================= */

/* ============================================
   Inline SVG icons
   ============================================ */
const SVG_ICONS = {
  kebab: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-2-5V6a3 3 0 0 0-3-3h-4a3 3 0 0 0-3 3v6l-2 5z"/></svg>',
  pinFill: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C10.9 2 10 2.9 10 4v6l-3 3v2h4v5l1 2 1-2v-5h4v-2l-3-3V4c0-1.1-.9-2-2-2z"/></svg>',
  chats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  emptyChat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
};

/* ============================================
   Small helpers
   ============================================ */
function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* Close any open .conv-menu when clicking outside or pressing Escape.
   Attached once per page load. */
(function setupConvMenuAutoClose() {
  if (window.__ecbConvMenuAutoClose) return;
  window.__ecbConvMenuAutoClose = true;
  document.addEventListener("click", () => {
    document.querySelectorAll(".conv-menu.open").forEach((m) => m.classList.remove("open"));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".conv-menu.open").forEach((m) => m.classList.remove("open"));
    }
  });
})();

/* ============================================
   History (sidebar chat list)
   ============================================ */
function renderHistory() {
  const historyEl = document.getElementById("history-list");
  if (!historyEl) return;

  // Hide the legacy "CHATS" header — we render our own section headers now
  const legacyHeader = document.querySelector(".history-header");
  if (legacyHeader) legacyHeader.style.display = "none";

  historyEl.innerHTML = "";
  const q = (state.search || "").toLowerCase();

  const withUserMsg = (state.conversations || []).filter(hasUserMessage);
  const visible = withUserMsg.filter((c) => (c.title || "").toLowerCase().includes(q));

  // Empty state — no chats at all
  if (withUserMsg.length === 0) {
    historyEl.appendChild(
      buildHistoryEmpty({
        title: "No conversations yet",
        sub: "Your chats will appear here once you start asking about GEC."
      })
    );
    return;
  }

  // Empty state — search with no matches
  if (visible.length === 0) {
    historyEl.appendChild(
      buildHistoryEmpty({
        title: "No matches",
        sub: `Nothing matches “${state.search}”`,
        icon: SVG_ICONS.search
      })
    );
    return;
  }

  const pinned = visible.filter((c) => !!c.pinned);
  const others = visible.filter((c) => !c.pinned);

  if (pinned.length > 0) {
    const section = document.createElement("div");
    section.className = "history-section history-section--pinned";
    section.appendChild(
      buildSectionHeader({
        title: "Pinned",
        count: pinned.length,
        variant: "pinned",
        icon: SVG_ICONS.pinFill
      })
    );
    pinned.forEach((conv) => section.appendChild(buildConvElement(conv)));
    historyEl.appendChild(section);
  }

  if (others.length > 0) {
    const section = document.createElement("div");
    section.className = "history-section history-section--chats";
    section.appendChild(
      buildSectionHeader({
        title: "Chats",
        count: others.length,
        icon: SVG_ICONS.chats
      })
    );
    others.forEach((conv) => section.appendChild(buildConvElement(conv)));
    historyEl.appendChild(section);
  }
}

function buildSectionHeader({ title, count, variant, icon }) {
  const header = document.createElement("div");
  header.className =
    "history-section-header" + (variant ? " history-section-header--" + variant : "");
  header.innerHTML = `
    ${icon || ""}
    <span>${escapeHtml(title)}</span>
    <span class="history-section-header-count">${count}</span>
  `;
  return header;
}

function buildHistoryEmpty({ title, sub, icon }) {
  const el = document.createElement("div");
  el.className = "history-empty";
  el.innerHTML = `
    <div class="history-empty-icon">${icon || SVG_ICONS.emptyChat}</div>
    <div class="history-empty-title">${escapeHtml(title)}</div>
    <div class="history-empty-sub">${escapeHtml(sub)}</div>
  `;
  return el;
}

function buildConvElement(conv) {
  const safeTitle =
    !conv.title || conv.title === "New chat" ? "Untitled chat" : conv.title;

  const div = document.createElement("div");
  div.className =
    "conv" +
    (conv.id === state.currentId ? " active" : "") +
    (conv.pinned ? " is-pinned" : "");
  div.setAttribute("data-conv-id", conv.id);

  div.innerHTML = `
    <div class="conv-title">
      ${conv.pinned ? `<span class="conv-pin-indicator">${SVG_ICONS.pinFill}</span>` : ""}
      <span class="conv-title-text">${escapeHtml(safeTitle)}</span>
    </div>
    <div class="conv-actions">
      <button class="conv-menu-btn" type="button" aria-label="More options" aria-haspopup="true" aria-expanded="false">
        ${SVG_ICONS.kebab}
      </button>
      <div class="conv-menu" role="menu">
        <button class="conv-menu-item conv-menu-item--pin" data-action="pin" type="button" role="menuitem">
          ${SVG_ICONS.pin}<span>${conv.pinned ? "Unpin" : "Pin"}</span>
        </button>
        <div class="conv-menu-divider"></div>
        <button class="conv-menu-item" data-action="rename" type="button" role="menuitem">
          ${SVG_ICONS.edit}<span>Rename</span>
        </button>
        <button class="conv-menu-item conv-menu-item--danger" data-action="delete" type="button" role="menuitem">
          ${SVG_ICONS.trash}<span>Delete</span>
        </button>
      </div>
    </div>
  `;

  const menuBtn = div.querySelector(".conv-menu-btn");
  const menu = div.querySelector(".conv-menu");

  if (menuBtn && menu) {
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".conv-menu.open").forEach((m) => {
        if (m !== menu) m.classList.remove("open");
      });
      const isOpen = menu.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    menu.addEventListener("click", (e) => {
      e.stopPropagation();
      const actionBtn = e.target.closest("[data-action]");
      if (!actionBtn) return;
      const action = actionBtn.dataset.action;

      if (action === "pin") {
        conv.pinned = !conv.pinned;
        renderAll();
      } else if (action === "rename") {
        const newTitle = window.prompt("Rename chat", safeTitle);
        if (newTitle && newTitle.trim()) {
          conv.title = newTitle.trim();
          renderAll();
        }
      } else if (action === "delete") {
        handleDeleteConversation(conv.id);
      }
      menu.classList.remove("open");
      menuBtn.setAttribute("aria-expanded", "false");
    });
  }

  div.addEventListener("click", () => {
    state.currentId = conv.id;
    state.view = "chat";
    saveToStorage();
    renderAll();
  });

  return div;
}

/* ============================================
   Topbar (unchanged apart from safety)
   ============================================ */
function renderTopbar() {
  const active = getActiveConversation();
  const titleEl = document.getElementById("topbar-title");
  const subtitleEl = document.querySelector(".top-left p");
  const marketBtn = document.getElementById("btn-open-marketplace");
  const registryBtn = document.getElementById("btn-open-registry");

  if (!titleEl) return;

  if (marketBtn) marketBtn.classList.toggle("is-active", state.view === "market");
  if (registryBtn) registryBtn.classList.toggle("is-active", state.view === "registry");

  if (state.view === "market") {
    if (typeof applyMarketplaceTopbar === "function") applyMarketplaceTopbar();
    if (subtitleEl) {
      subtitleEl.textContent = "";
      subtitleEl.style.display = "none";
    }
    return;
  }

  if (state.view === "registry") {
    titleEl.textContent = "Registry Activity";
    if (subtitleEl) {
      subtitleEl.textContent = "";
      subtitleEl.style.display = "none";
    }
    return;
  }

  const chatTitle =
    active && hasUserMessage(active) ? active.title || "EnergyCert Bot" : "EnergyCert Bot";
  titleEl.textContent = chatTitle;

  if (subtitleEl) {
    subtitleEl.textContent = "";
    subtitleEl.style.display = "none";
  }

  const loginBtn = document.getElementById("btn-login");
  const logoutBtn = document.getElementById("btn-logout");
  const userPanel = document.getElementById("sb-user-panel");
  const userNameEl = document.getElementById("sb-user-name");
  const userAvatar = document.getElementById("sb-user-avatar");

  if (loginBtn) loginBtn.style.display = state.user ? "none" : "inline-flex";
  if (logoutBtn) logoutBtn.style.display = state.user ? "inline-flex" : "none";

  if (userPanel) {
    if (state.user && userNameEl && userAvatar) {
      const displayName = state.user.name || state.user.id || "User";
      userNameEl.textContent = displayName;
      userAvatar.textContent = displayName
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
      userPanel.style.display = "flex";
    } else {
      userPanel.style.display = "none";
    }
  }
}

/* ============================================
   Main view (unchanged)
   ============================================ */
function renderMainView() {
  const heroSec = document.getElementById("hero-section");
  const threadSec = document.getElementById("thread-section");
  const dock = document.getElementById("dock");
  const marketSec = document.getElementById("market-section");
  const regSec = document.getElementById("registry");
  const typing = document.getElementById("typing-indicator");
  const chatFooter = document.getElementById("chat-footer");

  const active = getActiveConversation();
  const showHero = !active || !hasUserMessage(active);
  const showDock = state.view === "chat" && active && !showHero;

  if (state.view === "market") {
    if (heroSec) heroSec.style.display = "none";
    if (threadSec) threadSec.style.display = "none";
    if (dock) dock.style.display = "none";
    if (typing) typing.style.display = "none";
    if (marketSec) marketSec.style.display = "block";
    if (regSec) regSec.style.display = "none";
    if (typeof renderMarketplace === "function") renderMarketplace();
    return;
  }

  if (state.view === "registry") {
    if (heroSec) heroSec.style.display = "none";
    if (threadSec) threadSec.style.display = "none";
    if (dock) dock.style.display = "none";
    if (typing) typing.style.display = "none";
    if (marketSec) marketSec.style.display = "none";
    if (regSec) regSec.style.display = "block";
    if (typeof renderRegistry === "function") renderRegistry();
    return;
  }

  if (marketSec) marketSec.style.display = "none";
  if (regSec) regSec.style.display = "none";

  if (heroSec) heroSec.style.display = showHero ? "flex" : "none";
  if (threadSec) threadSec.style.display = showHero ? "none" : "block";
  if (dock) dock.style.display = showDock ? "block" : "none";
  if (typing) typing.style.display = state.isTyping && !showHero ? "block" : "none";
  if (chatFooter) chatFooter.style.display = state.view === "chat" && !showHero ? "block" : "none";

  if (!showHero) renderMessages();
}

/* ============================================
   Messages (chat thread)
   ============================================ */
function renderMessages() {
  const threadInner = document.getElementById("thread-inner");
  const active = getActiveConversation();
  if (!threadInner || !active) return;

  threadInner.innerHTML = "";

  (active.messages || []).forEach((m, idx) => {
    threadInner.appendChild(buildMessageRow(active, m, idx));
  });

  const thread = document.getElementById("thread-section");
  if (thread) thread.scrollTop = thread.scrollHeight;
}

function buildMessageRow(conv, m, idx) {
  const row = document.createElement("div");
  row.className = "row " + (m.sender === "user" ? "user" : "bot");
  row.setAttribute("data-msg-id", m.id);
  row.setAttribute("data-msg-index", String(idx));

  if (m.sender === "bot") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = "GEC";
    row.appendChild(avatar);
  }

  const wrap = document.createElement("div");
  wrap.className = "bubble-wrap";

  const bubble = document.createElement("div");
  bubble.className = "bubble" + (m.sender === "user" ? " user" : "");
  if (m.sender === "bot") {
    bubble.innerHTML = m.html ? (m.text || "") : markdownToHtml(m.text || "");
  } else {
    bubble.textContent = m.text || "";
  }
  wrap.appendChild(bubble);

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.innerHTML = `
    <span>${m.sender === "user" ? "You" : "GEC Assistant"}${m.time ? " · " + escapeHtml(m.time) : ""}</span>
  `;

  const actions = document.createElement("div");
  actions.className = "actions";

  // Copy (all messages)
  const copyBtn = makeMsgActionBtn("copy", "Copy", SVG_ICONS.copy);
  copyBtn.addEventListener("click", () => {
    copyToClipboardWithFeedback(extractMessageText(m), copyBtn);
  });
  actions.appendChild(copyBtn);

  if (m.sender === "user") {
    // Edit (user messages only)
    const editBtn = makeMsgActionBtn("edit", "Edit", SVG_ICONS.edit);
    editBtn.addEventListener("click", () => {
      startMessageEdit(conv, m, bubble);
    });
    actions.appendChild(editBtn);
  } else {
    // Retry (bot messages with a prior user message)
    const prior = findPriorUserMessage(conv, m.id);
    if (prior) {
      const retryBtn = makeMsgActionBtn("retry", "Retry", SVG_ICONS.retry);
      retryBtn.addEventListener("click", () => {
        retryBtn.classList.add("is-retrying");
        setTimeout(() => retryBtn.classList.remove("is-retrying"), 1200);
        handleRegenerateBotMessage(conv, m, prior);
      });
      actions.appendChild(retryBtn);
    }
  }

  meta.appendChild(actions);
  wrap.appendChild(meta);
  row.appendChild(wrap);

  return row;
}

function makeMsgActionBtn(type, label, iconSvg) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "msg-action-btn msg-action-" + type;
  btn.innerHTML = iconSvg + '<span class="msg-action-label">' + label + "</span>";
  return btn;
}

function extractMessageText(m) {
  if (m.sender === "user") return m.text || "";
  if (m.html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = m.text || "";
    return (tmp.innerText || tmp.textContent || "").trim();
  }
  return m.text || "";
}

function copyToClipboardWithFeedback(text, btn) {
  const originalHTML = btn.innerHTML;
  function showCopied() {
    btn.classList.add("is-copied");
    btn.innerHTML = SVG_ICONS.check + '<span class="msg-action-label">Copied</span>';
    setTimeout(() => {
      btn.classList.remove("is-copied");
      btn.innerHTML = originalHTML;
    }, 1400);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(showCopied).catch(fallback);
  } else {
    fallback();
  }
  function fallback() {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); showCopied(); } catch (e) {}
    document.body.removeChild(ta);
  }
}

function findPriorUserMessage(conv, botMsgId) {
  const msgs = conv.messages || [];
  const botIdx = msgs.findIndex((x) => x.id === botMsgId);
  if (botIdx <= 0) return null;
  for (let i = botIdx - 1; i >= 0; i--) {
    if (msgs[i].sender === "user") return msgs[i];
  }
  return null;
}

function startMessageEdit(conv, m, bubble) {
  if (bubble.dataset.editing === "1") return;
  bubble.dataset.editing = "1";

  const originalText = m.text || "";
  const originalHTML = bubble.innerHTML;
  bubble.classList.add("bubble-editing");

  const editor = document.createElement("div");
  editor.className = "bubble-edit-mode";
  editor.innerHTML = `
    <textarea class="bubble-edit-textarea" rows="2">${escapeHtml(originalText)}</textarea>
    <div class="bubble-edit-actions">
      <div class="bubble-edit-hint"><kbd>Esc</kbd> cancel &nbsp;·&nbsp; <kbd>\u2318/Ctrl</kbd>+<kbd>Enter</kbd> save</div>
      <div class="bubble-edit-btns">
        <button type="button" class="bubble-edit-btn bubble-edit-cancel">Cancel</button>
        <button type="button" class="bubble-edit-btn bubble-edit-save">Save &amp; Send</button>
      </div>
    </div>
  `;

  bubble.innerHTML = "";
  bubble.appendChild(editor);

  const ta = editor.querySelector(".bubble-edit-textarea");
  function autoGrow() {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  }
  autoGrow();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener("input", autoGrow);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(); }
  });

  editor.querySelector(".bubble-edit-cancel").addEventListener("click", cancelEdit);
  editor.querySelector(".bubble-edit-save").addEventListener("click", saveEdit);

  function cleanup() {
    bubble.classList.remove("bubble-editing");
    delete bubble.dataset.editing;
  }

  function cancelEdit() {
    bubble.innerHTML = originalHTML;
    cleanup();
  }

  function saveEdit() {
    const newText = ta.value.trim();
    if (!newText) { cancelEdit(); return; }
    if (newText === originalText) { cancelEdit(); return; }
    handleEditUserMessage(conv, m.id, newText);
  }
}

function handleEditUserMessage(conv, messageId, newText) {
  const msgs = conv.messages || [];
  const idx = msgs.findIndex((x) => x.id === messageId);
  if (idx === -1) return;
  // Truncate everything from the edited message forward, then re-send as a fresh turn
  conv.messages = msgs.slice(0, idx);
  handleSend(newText, false);
}

function handleRegenerateBotMessage(conv, botMsg, priorUserMsg) {
  const msgs = conv.messages || [];
  const botIdx = msgs.findIndex((x) => x.id === botMsg.id);
  if (botIdx === -1) return;
  // Drop the bot message (and anything after) and re-send with isRegenerate=true so
  // handleSend does not push a duplicate user message.
  conv.messages = msgs.slice(0, botIdx);
  renderAll();
  handleSend(priorUserMsg.text || "", true);
}

/* ============================================
   renderAll (unchanged)
   ============================================ */
function renderAll() {
  saveToStorage();
  saveUser();
  renderHistory();
  renderTopbar();
  renderMainView();
}

/* ============================================
   Conversation + message helpers (unchanged)
   ============================================ */
function createConversation(withWelcome) {
  const id = genId();
  const conv = {
    id,
    title: "New chat",
    createdAt: new Date().toISOString(),
    messages: [],
    pinned: false
  };

  if (withWelcome) {
    conv.messages.push({
      id: genId(),
      sender: "bot",
      text:
        `Assalam-o-Alaikum! 👋 I’m your GEC Assistant.\n\nAsk about certificates, issuance, transfer, retirement, flows, roles, MCP tools, or registry APIs.`,
      time: nowTime(),
      html: false
    });
  }

  state.conversations.unshift(conv);
  state.currentId = id;
  return conv;
}

function pushMessage(convId, sender, text, opts = {}) {
  const conv = state.conversations.find((c) => c.id === convId);
  if (!conv) return;

  conv.messages.push({
    id: genId(),
    sender,
    text,
    time: nowTime(),
    html: !!opts.html
  });

  if (sender === "user") {
    const t = (text || "").trim().replace(/\s+/g, " ");
    if (!conv.title || conv.title === "New chat") {
      conv.title = t.length > 48 ? t.slice(0, 45) + "…" : (t || "Untitled chat");
    }
  }
}

function pushSystemMessage(text) {
  let conv = getActiveConversation();
  if (!conv) conv = createConversation(false);
  pushMessage(conv.id, "bot", text, { html: false });
}

function extractMcpBody(reply) {
  if (!reply || reply.type !== "mcp_result") return null;

  const mcpResp = reply.mcp_response || {};

  if (mcpResp.body && typeof mcpResp.body === "object") {
    return mcpResp.body;
  }

  if (
    typeof mcpResp === "object" &&
    (
      "tx_hash" in mcpResp ||
      "success" in mcpResp ||
      "vm_status" in mcpResp ||
      "explorer_url" in mcpResp ||
      "detail" in mcpResp
    )
  ) {
    return mcpResp;
  }

  return {
    success: false,
    detail: "Empty MCP body"
  };
}

async function handleSend(text, isRegenerate) {
  const trimmed = (text || "").trim();
  if (!trimmed) return;

  let conv = getActiveConversation();
  if (!conv) conv = createConversation(true);

  state.view = "chat";

  if (!isRegenerate) pushMessage(conv.id, "user", trimmed);

  state.lastUserMessage = trimmed;
  state.isTyping = true;
  renderAll();

  try {
    const payload = {
      message: trimmed,
      userId: state.user?.id || state.user?.did || "anonymous",
      mode: state.mode,
      audience: state.audience,
      include_sources: !!state.showSources
    };

    const data = await apiPostJson(API_URL, payload);

    console.log("FULL API RESPONSE:", data);
    console.log("RAW REPLY:", data?.reply);

    if (!data) {
      pushMessage(conv.id, "bot", "Backend returned empty response.", { html: false });
      return;
    }

    const reply = data.reply || null;

    if (!reply) {
      if (typeof data.answer === "string") {
        pushMessage(conv.id, "bot", data.answer, { html: false });
      } else {
        pushMessage(
          conv.id,
          "bot",
          "Unexpected backend response:\n" + JSON.stringify(data, null, 2),
          { html: false }
        );
      }
      return;
    }

    if (typeof reply === "string") {
      pushMessage(conv.id, "bot", reply, { html: false });
      return;
    }

    if (reply.type === "answer") {
      const txt = reply.text || "No answer.";
      pushMessage(conv.id, "bot", txt, { html: false });

      if (typeof registerRejected === "function" && txt.startsWith("⚠")) {
        registerRejected(state.lastUserMessage, txt);
      }
      return;
    }

    if (reply.type === "mcp_result") {
      const body = extractMcpBody(reply);

      console.log("MCP RESPONSE:", reply.mcp_response);
      console.log("MCP BODY:", body);

      const prettyHtml =
        typeof formatMcpBodyHtml === "function"
          ? formatMcpBodyHtml(body)
          : "<pre>" + JSON.stringify(body, null, 2) + "</pre>";

      if (typeof updateRegistryFromMcp === "function") {
        updateRegistryFromMcp(body, state.lastUserMessage);
      }

      pushMessage(conv.id, "bot", prettyHtml, { html: true });
      return;
    }

    pushMessage(
      conv.id,
      "bot",
      "Unknown reply format:\n" + JSON.stringify(reply, null, 2),
      { html: false }
    );
  } catch (e) {
    console.error("handleSend error:", e);
    pushMessage(
      conv.id,
      "bot",
      "I couldn't reach the backend (http://localhost:3000/api/chat). Please start backend and try again.",
      { html: false }
    );
  } finally {
    state.isTyping = false;
    renderAll();
  }
}

function handleDeleteConversation(id) {
  if (!window.confirm("Delete this chat?")) return;
  state.conversations = state.conversations.filter((c) => c.id !== id);
  if (state.currentId === id) {
    state.currentId = state.conversations[0] ? state.conversations[0].id : null;
  }
  renderAll();
}

function handleClearAll() {
  if (!window.confirm("Clear all chat history?")) return;
  state.conversations = [];
  state.currentId = null;
  state.registry = { accounts: {}, txs: [], rejected: [] };
  renderAll();
}