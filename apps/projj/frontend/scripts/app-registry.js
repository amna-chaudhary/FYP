

function ensureRegistryAccount(id) {
  const key = id || "unknown";

  if (!state.registry) {
    state.registry = { accounts: {}, txs: [], rejected: [] };
  }

  if (!state.registry.accounts) {
    state.registry.accounts = {};
  }

  if (!state.registry.accounts[key]) {
    state.registry.accounts[key] = {
      accountId: key,
      balance: 0,
      issued: 0,
      received: 0,
      sent: 0,
      retired: 0
    };
  }

  return state.registry.accounts[key];
}

function addRegistryTx(entry) {
  if (!state.registry) {
    state.registry = { accounts: {}, txs: [], rejected: [] };
  }

  if (!Array.isArray(state.registry.txs)) {
    state.registry.txs = [];
  }

  state.registry.txs.push({
    time: nowTime(),
    ...entry
  });
}

function registerRejected(prompt, reason) {
  if (!state.registry) {
    state.registry = { accounts: {}, txs: [], rejected: [] };
  }

  if (!Array.isArray(state.registry.rejected)) {
    state.registry.rejected = [];
  }

  state.registry.rejected.push({
    time: nowTime(),
    prompt: prompt || "(empty prompt)",
    reason: reason || "Unknown reason"
  });
}

function _parseQty(qRaw) {
  if (typeof qRaw === "number" && Number.isFinite(qRaw)) return qRaw;
  const n = parseFloat(String(qRaw ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function _normalizeMcpBody(body) {
  if (!body || typeof body !== "object") {
    return null;
  }

  if (body.body && typeof body.body === "object") {
    const inner = body.body;

    if (
      inner &&
      typeof inner === "object" &&
      (
        "tx_hash" in inner ||
        "success" in inner ||
        "vm_status" in inner ||
        "explorer_url" in inner ||
        "action" in inner ||
        "status" in inner
      )
    ) {
      return inner;
    }
  }

  return body;
}

function refreshRegistryLinkedViews() {
  saveToStorage();

  if (state.view === "registry" && typeof renderRegistry === "function") {
    renderRegistry();
  }

  if (typeof renderMarketplace === "function") {
    renderMarketplace();
  }
}

/**
 * Update session registry state from MCP response body.
 */
function updateRegistryFromMcp(body, prompt) {
  body = _normalizeMcpBody(body);

  if (!body || typeof body !== "object") return;

  // -----------------------------
  // Direct blockchain tx response
  // -----------------------------
  if ("tx_hash" in body || "success" in body || "vm_status" in body) {
    const ok = body.success === true;
    const lowerPrompt = String(prompt || "").toLowerCase();

    if (!ok) {
      registerRejected(prompt, body.vm_status || body.detail || "Transaction failed");
      addRegistryTx({
        action: "failed",
        quantity: 0,
        from: "—",
        to: "—",
        deviceId: "—",
        energySource: "—",
        status: "Failed",
        prompt,
        proof: {
          tx_hash: body.tx_hash || null,
          metadata_hash: body.metadata_hash || null,
          onchain_id: body.onchain_id || null,
          explorer_url: body.explorer_url || null
        }
      });

      refreshRegistryLinkedViews();
      return;
    }

    const qtyMatch = lowerPrompt.match(/\b(\d+(?:\.\d+)?)\b/);
    const qty = qtyMatch ? _parseQty(qtyMatch[1]) : 0;

    const source =
      ["solar", "wind", "hydro", "biomass", "geothermal", "thermal"].find((x) =>
        lowerPrompt.includes(x)
      ) || "unknown";

    const proof = {
      tx_hash: body.tx_hash || null,
      metadata_hash: body.metadata_hash || null,
      onchain_id: body.onchain_id || null,
      explorer_url: body.explorer_url || null
    };

    if (
      lowerPrompt.includes("issue") ||
      lowerPrompt.includes("create") ||
      lowerPrompt.includes("mint")
    ) {
      const accId =
        body.account_id || body.owner_account_id || body.sender_address || "onchain-account";
      const acc = ensureRegistryAccount(accId);
      acc.balance += qty;
      acc.issued += qty;

      addRegistryTx({
        action: "issue",
        quantity: qty,
        from: "Registry",
        to: accId,
        deviceId: body.device_id || "—",
        energySource: body.energy_source || source,
        status: "Completed",
        prompt,
        proof
      });

      refreshRegistryLinkedViews();
      return;
    }

    if (lowerPrompt.includes("transfer")) {
      const fromId = body.source_account_id || body.from_account_id || "source-account";
      const toId = body.target_account_id || body.to_account_id || "target-account";

      const fromAcc = ensureRegistryAccount(fromId);
      const toAcc = ensureRegistryAccount(toId);

      fromAcc.balance = Math.max(0, fromAcc.balance - qty);
      fromAcc.sent += qty;

      toAcc.balance += qty;
      toAcc.received += qty;

      addRegistryTx({
        action: "transfer",
        quantity: qty,
        from: fromId,
        to: toId,
        deviceId: body.device_id || "—",
        energySource: body.energy_source || source,
        status: "Completed",
        prompt,
        proof
      });

      refreshRegistryLinkedViews();
      return;
    }

    if (
      lowerPrompt.includes("retire") ||
      lowerPrompt.includes("claim") ||
      lowerPrompt.includes("cancel")
    ) {
      const accId = body.account_id || body.owner_account_id || "owner-account";
      const acc = ensureRegistryAccount(accId);

      acc.balance = Math.max(0, acc.balance - qty);
      acc.retired += qty;

      addRegistryTx({
        action: "retire",
        quantity: qty,
        from: accId,
        to: "Retired",
        deviceId: body.device_id || "—",
        energySource: body.energy_source || source,
        status: "Completed",
        prompt,
        proof
      });

      refreshRegistryLinkedViews();
      return;
    }

    addRegistryTx({
      action: "tx",
      quantity: qty,
      from: "—",
      to: "—",
      deviceId: body.device_id || "—",
      energySource: body.energy_source || source,
      status: "Completed",
      prompt,
      proof
    });

    refreshRegistryLinkedViews();
    return;
  }

  // -----------------------------
  // Old / custom MCP response
  // -----------------------------
  const action = body.action || "";
  const status = body.status || "";

  if (status !== "success") {
    registerRejected(prompt, body.message || body.detail || "MCP operation failed.");
    refreshRegistryLinkedViews();
    return;
  }

  const qRaw =
    body.issued_quantity ??
    body.transferred_quantity ??
    body.retired_quantity ??
    body.quantity ??
    body.amount ??
    body.amount_mwh;

  const q = _parseQty(qRaw);

  const proof = {
    tx_hash: body.tx_hash || body.transaction_hash || body.onchain_tx_hash || null,
    metadata_hash: body.metadata_hash || null,
    onchain_id: body.onchain_id || body.token_id || body.bundle_onchain_id || null,
    explorer_url: body.explorer_url || null
  };

  if (action === "issue_gecs") {
    const accId = body.account_id || body.owner_account_id || "unknown";
    const acc = ensureRegistryAccount(accId);
    acc.balance += q;
    acc.issued += q;

    addRegistryTx({
      action: "issue",
      quantity: q,
      from: "Registry",
      to: accId,
      deviceId: body.device_id || "—",
      energySource: body.energy_source || body.source || "—",
      status: "Completed",
      prompt,
      proof
    });

    refreshRegistryLinkedViews();
    return;
  }

  if (action === "transfer_gecs") {
    const fromId = body.source_account_id || body.from_account_id || "unknown";
    const toId = body.target_account_id || body.to_account_id || "unknown";

    const fromAcc = ensureRegistryAccount(fromId);
    const toAcc = ensureRegistryAccount(toId);

    fromAcc.balance = Math.max(0, fromAcc.balance - q);
    fromAcc.sent += q;

    toAcc.balance += q;
    toAcc.received += q;

    addRegistryTx({
      action: "transfer",
      quantity: q,
      from: fromId,
      to: toId,
      deviceId: body.device_id || "—",
      energySource: body.energy_source || body.source || "—",
      status: "Completed",
      prompt,
      proof
    });

    refreshRegistryLinkedViews();
    return;
  }

  if (action === "retire_gecs" || action === "cancel_gecs") {
    const accId = body.account_id || body.owner_account_id || "unknown";
    const acc = ensureRegistryAccount(accId);

    acc.balance = Math.max(0, acc.balance - q);
    acc.retired += q;

    addRegistryTx({
      action: "retire",
      quantity: q,
      from: accId,
      to: "Retired",
      deviceId: body.device_id || "—",
      energySource: body.energy_source || body.source || "—",
      status: "Completed",
      prompt,
      proof
    });

    refreshRegistryLinkedViews();
    return;
  }

  if (action === "query_gecs") {
    const results = Array.isArray(body.results) ? body.results : [];

    if (results.length) {
      const accId = body.account_id || results[0].account_id || "unknown";
      const acc = ensureRegistryAccount(accId);

      const sum = results.reduce((s, r) => {
        const qty = _parseQty(r.quantity ?? r.amount ?? r.amount_mwh);
        return s + qty;
      }, 0);

      acc.balance = sum;
    }

    addRegistryTx({
      action: "query",
      quantity: 0,
      from: "—",
      to: "—",
      deviceId: "—",
      energySource: "—",
      status: "Completed",
      prompt,
      proof
    });

    refreshRegistryLinkedViews();
    return;
  }

  addRegistryTx({
    action: action || "unknown",
    quantity: q,
    from: "—",
    to: "—",
    deviceId: body.device_id || "—",
    energySource: body.energy_source || body.source || "—",
    status: "Completed",
    prompt,
    proof
  });

  refreshRegistryLinkedViews();
}

function formatMcpBodyHtml(body) {
  body = _normalizeMcpBody(body);

  if (!body || typeof body !== "object") {
    return `<div class="mcp-card">
      <div class="mcp-header error">
        <div class="mcp-header-left">
          <div class="mcp-header-icon">⚠️</div>
          <div class="mcp-header-title">Unknown MCP Response</div>
        </div>
        <span class="mcp-tag">MCP</span>
      </div>
      <div>Empty or invalid response.</div>
    </div>`;
  }

  if ("tx_hash" in body || "success" in body || "vm_status" in body) {
    const ok = body.success === true;
    const txHash = body.tx_hash || "—";
    const vmStatus = body.vm_status || (ok ? "Executed successfully" : "Execution failed");
    const explorerUrl = body.explorer_url || "";

    return `
    <div class="mcp-card">
      <div class="mcp-header ${ok ? "success" : "error"}">
        <div class="mcp-header-left">
          <div class="mcp-header-icon">${ok ? "✅" : "⚠️"}</div>
          <div class="mcp-header-title">${ok ? "Blockchain Transaction Successful" : "Blockchain Transaction Failed"}</div>
        </div>
        <span class="mcp-tag">APTOS TX</span>
      </div>
      <div class="mcp-main-row">
        <div class="mcp-primary-label">Transaction status</div>
        <div class="mcp-primary-number" style="font-size:18px;">${ok ? "Success" : "Failed"}</div>
      </div>
      <div class="mcp-grid">
        <div style="grid-column: span 3;">
          <div class="mcp-field-label">Transaction Hash</div>
          <div class="mcp-field-value" style="word-break: break-all;">${txHash}</div>
        </div>
      </div>
      <div class="mcp-grid">
        <div style="grid-column: span 3;">
          <div class="mcp-field-label">VM Status</div>
          <div class="mcp-field-value">${vmStatus}</div>
        </div>
      </div>
      <div class="mcp-footer">
        ${
          explorerUrl
            ? `<a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" style="color:#166534;font-weight:600;text-decoration:none;">Open in Aptos Explorer ↗</a>`
            : "No explorer link available."
        }
      </div>
    </div>`;
  }

  const action = body.action || "";
  const status = body.status || "";
  const msg = body.message || "";
  const isSuccess = status === "success";

  const previewSvgUrl = body.preview_svg_url || "";
  const downloadSvgUrl = body.download_svg_url || "";
  const downloadFileName = body.download_file_name || "gec-document.svg";

  const txHash = body.tx_hash || body.transaction_hash || body.onchain_tx_hash || "";
  const metaHash = body.metadata_hash || "";
  const onchainId = body.onchain_id || body.token_id || body.bundle_onchain_id || "";
  const explorerUrl = body.explorer_url || "";

  const proofBlock = (txHash || metaHash || onchainId || explorerUrl)
    ? `
      <div style="margin-top:10px;padding:10px;border:1px dashed #d1d5db;border-radius:10px;background:#fafafa;">
        <div style="font-weight:700;margin-bottom:6px;">Proof / Audit</div>
        ${txHash ? `<div style="font-size:12px;"><strong>tx_hash:</strong> ${txHash}</div>` : ""}
        ${metaHash ? `<div style="font-size:12px;"><strong>metadata_hash:</strong> ${metaHash}</div>` : ""}
        ${onchainId ? `<div style="font-size:12px;"><strong>onchain_id:</strong> ${onchainId}</div>` : ""}
        ${explorerUrl ? `<div style="font-size:12px;margin-top:4px;"><a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" style="color:#166534;font-weight:600;text-decoration:none;">Open in Explorer ↗</a></div>` : ""}
      </div>
    `
    : "";

  const downloadBlock = downloadSvgUrl
    ? `
      <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <a href="${downloadSvgUrl}" download="${downloadFileName}" class="mcp-badge" style="text-decoration:none;">
          Download Document
        </a>
      </div>`
    : "";

  const previewBlock = previewSvgUrl
    ? `
      <div style="margin-top:12px;">
        <img src="${previewSvgUrl}" alt="Generated document preview"
             style="max-width:100%;border:1px solid #d1d5db;border-radius:10px;background:#fff;" />
      </div>`
    : "";

  if (!isSuccess) {
    const detail = body.detail || msg || "MCP call failed.";
    return `<div class="mcp-card">
      <div class="mcp-header error">
        <div class="mcp-header-left">
          <div class="mcp-header-icon">⚠️</div>
          <div class="mcp-header-title">Operation Failed</div>
        </div>
        <span class="mcp-tag">${action || "MCP"}</span>
      </div>
      <div>${detail}</div>
      ${proofBlock}
    </div>`;
  }

  if (action === "issue_gecs") {
    const q = body.issued_quantity ?? body.quantity ?? "?";
    const acc = body.account_id || body.owner_account_id || "—";
    const dev = body.device_id || "—";
    const src = body.energy_source || body.source || "—";
    const from = body.time_window?.from || "Not specified";
    const to = body.time_window?.to || "Not specified";

    return `
    <div class="mcp-card">
      <div class="mcp-header success">
        <div class="mcp-header-left">
          <div class="mcp-header-icon">⚡</div>
          <div class="mcp-header-title">GECs Issued</div>
        </div>
        <span class="mcp-tag">issue_gecs</span>
      </div>
      <div class="mcp-main-row">
        <div class="mcp-primary-number">${q}</div>
        <div class="mcp-primary-label">GECs issued</div>
      </div>
      <div class="mcp-grid">
        <div>
          <div class="mcp-field-label">Device ID</div>
          <div class="mcp-field-value">${dev}</div>
        </div>
        <div>
          <div class="mcp-field-label">Energy Source</div>
          <div class="mcp-field-value">${src}</div>
        </div>
        <div>
          <div class="mcp-field-label">Account ID</div>
          <div class="mcp-field-value">${acc}</div>
        </div>
      </div>
      <div class="mcp-grid">
        <div>
          <div class="mcp-field-label">Time From</div>
          <div class="mcp-field-value">${from}</div>
        </div>
        <div>
          <div class="mcp-field-label">Time To</div>
          <div class="mcp-field-value">${to}</div>
        </div>
        <div>
          <div class="mcp-field-label">Status</div>
          <div class="mcp-field-value">Completed</div>
        </div>
      </div>
      <div class="mcp-footer">
        <div>${msg || "GECs have been successfully created for this device and account."}</div>
        <div class="mcp-badge-row">
          <div class="mcp-badge">Device: ${dev}</div>
          <div class="mcp-badge">Source: ${src}</div>
          <div class="mcp-badge">Account: ${acc}</div>
        </div>
        ${proofBlock}
        ${downloadBlock}
        ${previewBlock}
      </div>
    </div>`;
  }

  if (action === "transfer_gecs") {
    const q = body.transferred_quantity ?? body.quantity ?? "?";
    const from = body.source_account_id || body.from_account_id || "—";
    const to = body.target_account_id || body.to_account_id || "—";

    return `
    <div class="mcp-card">
      <div class="mcp-header success">
        <div class="mcp-header-left">
          <div class="mcp-header-icon">🔁</div>
          <div class="mcp-header-title">GECs Transferred</div>
        </div>
        <span class="mcp-tag">transfer_gecs</span>
      </div>
      <div class="mcp-main-row">
        <div class="mcp-primary-number">${q}</div>
        <div class="mcp-primary-label">GECs moved</div>
      </div>
      <div class="mcp-grid">
        <div>
          <div class="mcp-field-label">Source Account</div>
          <div class="mcp-field-value">${from}</div>
        </div>
        <div>
          <div class="mcp-field-label">Target Account</div>
          <div class="mcp-field-value">${to}</div>
        </div>
        <div>
          <div class="mcp-field-label">Status</div>
          <div class="mcp-field-value">Completed</div>
        </div>
      </div>
      <div class="mcp-footer">
        <div>${msg || "Certificates have been moved between accounts."}</div>
        <div class="mcp-badge-row">
          <div class="mcp-badge">From: ${from}</div>
          <div class="mcp-badge">To: ${to}</div>
          <div class="mcp-badge">Quantity: ${q}</div>
        </div>
        ${proofBlock}
        ${downloadBlock}
        ${previewBlock}
      </div>
    </div>`;
  }

  if (action === "retire_gecs" || action === "cancel_gecs") {
    const q = body.retired_quantity ?? body.quantity ?? "?";
    const acc = body.account_id || body.owner_account_id || "—";
    const reason = body.reason || "Not provided";

    return `
    <div class="mcp-card">
      <div class="mcp-header success">
        <div class="mcp-header-left">
          <div class="mcp-header-icon">🪪</div>
          <div class="mcp-header-title">GECs Retired</div>
        </div>
        <span class="mcp-tag">${action}</span>
      </div>
      <div class="mcp-main-row">
        <div class="mcp-primary-number">${q}</div>
        <div class="mcp-primary-label">GECs removed</div>
      </div>
      <div class="mcp-grid">
        <div>
          <div class="mcp-field-label">Account ID</div>
          <div class="mcp-field-value">${acc}</div>
        </div>
        <div>
          <div class="mcp-field-label">Reason</div>
          <div class="mcp-field-value">${reason}</div>
        </div>
        <div>
          <div class="mcp-field-label">Status</div>
          <div class="mcp-field-value">Retired</div>
        </div>
      </div>
      <div class="mcp-footer">
        <div>${msg || "These certificates can no longer be transferred or traded."}</div>
        <div class="mcp-badge-row">
          <div class="mcp-badge">Account: ${acc}</div>
          <div class="mcp-badge">Quantity: ${q}</div>
        </div>
        ${proofBlock}
      </div>
    </div>`;
  }

  if (action === "query_gecs") {
    const results = Array.isArray(body.results) ? body.results : [];
    if (results.length === 0) {
      return `
      <div class="mcp-card">
        <div class="mcp-header success">
          <div class="mcp-header-left">
            <div class="mcp-header-icon">📊</div>
            <div class="mcp-header-title">GEC Balance</div>
          </div>
          <span class="mcp-tag">query_gecs</span>
        </div>
        <div>No GEC bundles found for this account or filter.</div>
        ${proofBlock}
      </div>`;
    }

    let totalQty = 0;
    let accountId = "—";
    const itemsHtml = results
      .map((r, idx) => {
        const q = _parseQty(r.quantity ?? r.amount ?? r.amount_mwh);
        totalQty += q;
        accountId = r.account_id || accountId;
        const src = r.energy_source || r.source || "—";
        const dev = r.device_id || "—";
        return `
          <div class="mcp-balance-item">
            <span class="key">Bundle ${idx + 1} – ${src}, Device ${dev}</span>
            <span class="val">${q} GECs</span>
          </div>`;
      })
      .join("");

    return `
    <div class="mcp-card">
      <div class="mcp-header success">
        <div class="mcp-header-left">
          <div class="mcp-header-icon">📊</div>
          <div class="mcp-header-title">GEC Balance</div>
        </div>
        <span class="mcp-tag">query_gecs</span>
      </div>
      <div class="mcp-main-row">
        <div class="mcp-primary-number">${totalQty}</div>
        <div class="mcp-primary-label">Total GECs (approx)</div>
      </div>
      <div class="mcp-grid">
        <div>
          <div class="mcp-field-label">Account ID</div>
          <div class="mcp-field-value">${accountId}</div>
        </div>
        <div>
          <div class="mcp-field-label">Bundles</div>
          <div class="mcp-field-value">${results.length}</div>
        </div>
        <div></div>
      </div>
      <div class="mcp-balance-list">
        ${itemsHtml}
      </div>
      <div class="mcp-footer">
        <div>${msg || "Breakdown of GEC bundles matched by your query."}</div>
        ${proofBlock}
      </div>
    </div>`;
  }

  return `
  <div class="mcp-card">
    <div class="mcp-header success">
      <div class="mcp-header-left">
        <div class="mcp-header-icon">ℹ️</div>
        <div class="mcp-header-title">MCP Result</div>
      </div>
      <span class="mcp-tag">${action || "MCP"}</span>
    </div>
    ${proofBlock}
    <pre style="font-size:11px; white-space:pre-wrap; margin:0;">${JSON.stringify(body, null, 2)}</pre>
  </div>`;
}

function formatGecNumber(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("en-US");
}

function shortPrompt(text, max = 80) {
  const s = (text || "").trim();
  if (!s) return "—";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function renderRegistry() {
  const summaryEl = document.getElementById("registry-summary");
  const holdingsEl = document.getElementById("registry-holdings");
  const timelineEl = document.getElementById("registry-timeline");
  const rejectedEl = document.getElementById("registry-rejected");
  const accountFilterEl = document.getElementById("reg-account-filter");

  if (!summaryEl || !holdingsEl || !timelineEl || !rejectedEl || !accountFilterEl) return;

  const accounts = Object.values((state.registry && state.registry.accounts) || {});
  const txsSource = Array.isArray(state.registry?.txs) ? state.registry.txs : [];
  const rejectedSource = Array.isArray(state.registry?.rejected) ? state.registry.rejected : [];

  const totalIssued = accounts.reduce((s, a) => s + (a.issued || 0), 0);
  const totalRetired = accounts.reduce((s, a) => s + (a.retired || 0), 0);
  const totalBalance = accounts.reduce((s, a) => s + (a.balance || 0), 0);

  summaryEl.innerHTML = `
    <div class="reg-summary-card reg-summary-card--issued reg-card">
      <div class="reg-summary-label">Issued</div>
      <div class="reg-summary-value">${formatGecNumber(totalIssued)}</div>
      <div class="reg-summary-sub">Session total</div>
    </div>
    <div class="reg-summary-card reg-summary-card--balance reg-card">
      <div class="reg-summary-label">Active balance</div>
      <div class="reg-summary-value">${formatGecNumber(totalBalance)}</div>
      <div class="reg-summary-sub">Currently available</div>
    </div>
    <div class="reg-summary-card reg-summary-card--retired reg-card">
      <div class="reg-summary-label">Retired</div>
      <div class="reg-summary-value">${formatGecNumber(totalRetired)}</div>
      <div class="reg-summary-sub">Permanently removed</div>
    </div>
    <div class="reg-summary-card reg-summary-card--accounts reg-card">
      <div class="reg-summary-label">Accounts</div>
      <div class="reg-summary-value">${accounts.length}</div>
      <div class="reg-summary-sub">With activity in this session</div>
    </div>
  `;

  const currentVal = accountFilterEl.value || "ALL";
  const opts = ["ALL", ...accounts.map((a) => a.accountId)];

  accountFilterEl.innerHTML = opts
    .map((v) => {
      const label = v === "ALL" ? "All accounts" : v;
      const selected = v === currentVal ? "selected" : "";
      return `<option value="${v}" ${selected}>${label}</option>`;
    })
    .join("");

  const filterAcc = accountFilterEl.value || "ALL";
  const filteredAccounts = accounts.filter((a) =>
    filterAcc === "ALL" ? true : a.accountId === filterAcc
  );

  if (filteredAccounts.length === 0) {
    holdingsEl.innerHTML =
      '<div class="reg-empty">No account balances yet. Issue, transfer or retire GECs to see holdings here.</div>';
  } else {
    holdingsEl.innerHTML = filteredAccounts
      .map((a) => {
        const statusText = (a.balance || 0) > 0 ? "Active" : "Zero balance";
        return `
          <div class="reg-holding-card">
            <div class="reg-holding-header">
              <div class="reg-holding-title">Account ${a.accountId}</div>
              <span class="reg-status-pill">${statusText}</span>
            </div>
            <div>Balance: <strong>${formatGecNumber(a.balance)} GECs</strong></div>
            <div style="margin-top:4px;font-size:0.78rem;color:#6b7280;">
              Issued: <strong>${formatGecNumber(a.issued)}</strong> ·
              Received: <strong>${formatGecNumber(a.received)}</strong> ·
              Sent: <strong>${formatGecNumber(a.sent)}</strong> ·
              Retired: <strong>${formatGecNumber(a.retired)}</strong>
            </div>
          </div>
        `;
      })
      .join("");
  }

  const txs = txsSource.filter((t) =>
    filterAcc === "ALL" ? true : t.from === filterAcc || t.to === filterAcc
  );

  if (txs.length === 0) {
    timelineEl.innerHTML =
      '<div class="reg-empty">No registry activity yet. Ask the assistant to issue, transfer, retire or query GECs.</div>';
  } else {
    timelineEl.innerHTML = txs
      .map((t) => {
        const pillClass =
          "reg-tx-pill " +
          (t.action === "transfer"
            ? "transfer"
            : t.action === "retire"
            ? "retire"
            : t.action === "query"
            ? "query"
            : t.action === "failed"
            ? "fail"
            : "");

        const label =
          t.action === "issue"
            ? "Issue"
            : t.action === "transfer"
            ? "Transfer"
            : t.action === "retire"
            ? "Retire"
            : t.action === "failed"
            ? "Failed"
            : t.action === "query"
            ? "Query"
            : "Tx";

        const mainLine =
          t.action === "query"
            ? `<span>Balance query</span>`
            : t.action === "failed"
            ? `<span>Transaction failed</span>`
            : `<span><strong>${formatGecNumber(t.quantity)}</strong> GECs</span>
               <span>${t.from} → ${t.to}</span>`;

        const proof = t.proof || {};
        const proofLine =
          (proof.tx_hash || proof.metadata_hash || proof.onchain_id || proof.explorer_url)
            ? `<div class="reg-tx-proof" style="margin-top:4px;font-size:0.75rem;color:#6b7280;">
                 ${proof.tx_hash ? `<div><strong>tx_hash:</strong> ${proof.tx_hash}</div>` : ""}
                 ${proof.metadata_hash ? `<div><strong>metadata_hash:</strong> ${proof.metadata_hash}</div>` : ""}
                 ${proof.onchain_id ? `<div><strong>onchain_id:</strong> ${proof.onchain_id}</div>` : ""}
                 ${proof.explorer_url ? `<div><a href="${proof.explorer_url}" target="_blank" rel="noopener noreferrer" style="color:#166534;font-weight:600;text-decoration:none;">Open in Explorer ↗</a></div>` : ""}
               </div>`
            : "";

        return `
          <div class="reg-tx-row">
            <div class="reg-tx-time">${t.time}</div>
            <div><span class="${pillClass}">${label}</span></div>
            <div class="reg-tx-main">
              ${mainLine}
              <span class="reg-tx-prompt">Prompt · ${shortPrompt(t.prompt, 70)}</span>
              ${proofLine}
            </div>
          </div>
        `;
      })
      .join("");
  }

  if (!rejectedSource.length) {
    rejectedEl.innerHTML =
      '<div class="reg-empty">No rejected commands in this session.</div>';
  } else {
    rejectedEl.innerHTML = rejectedSource
      .map((r) => {
        return `
          <div class="reg-rejected-item">
            <div class="reg-rejected-time">${r.time}</div>
            <div><strong>Prompt:</strong> ${shortPrompt(r.prompt, 90)}</div>
            <div class="reg-rejected-reason"><strong>Reason:</strong> ${r.reason}</div>
          </div>
        `;
      })
      .join("");
  }

  if (!accountFilterEl.dataset.bound) {
    accountFilterEl.dataset.bound = "1";
    accountFilterEl.addEventListener("change", renderRegistry);
  }
}