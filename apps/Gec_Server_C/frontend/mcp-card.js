/* =============================================================
 * MCP Certificate Card — Renderer
 *
 * Converts an MCP response body into the green certificate
 * card HTML. Extracted from the old chatbot file, with all
 * chat / history / storage / login / registry code removed.
 *
 * Public API (attached to window):
 *   MCPCard.format(body)            -> HTML string
 *   MCPCard.render(body, targetEl)  -> writes HTML into targetEl
 *
 * Supported response shapes (same as the old chatbot used):
 *
 *   Aptos blockchain tx:
 *     { tx_hash, success, vm_status, explorer_url }
 *
 *   Issue GECs:
 *     { action: "issue_gecs", status: "success",
 *       issued_quantity, account_id, device_id,
 *       energy_source, time_window: { from, to }, message }
 *
 *   Transfer GECs:
 *     { action: "transfer_gecs", status: "success",
 *       transferred_quantity,
 *       source_account_id, target_account_id, message }
 *
 *   Retire / Cancel GECs:
 *     { action: "retire_gecs" | "cancel_gecs", status: "success",
 *       retired_quantity, account_id, reason, message }
 *
 *   Query GECs (balance):
 *     { action: "query_gecs", status: "success",
 *       results: [{ quantity, energy_source, device_id, account_id }],
 *       message }
 *
 *   Any object missing status or with status !== "success" falls
 *   through to the red "Operation Failed" card.
 * ============================================================= */
(function (global) {
  "use strict";

  function formatMcpBodyHtml(body) {
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

    /* ---- Real Aptos blockchain tx response ---- */
    if ("tx_hash" in body || "success" in body || "vm_status" in body) {
      const ok = body.success === true;
      const txHash = body.tx_hash || "—";
      const vmStatus =
        body.vm_status || (ok ? "Executed successfully" : "Execution failed");
      const explorerUrl = body.explorer_url || "";

      return `
      <div class="mcp-card">
        <div class="mcp-header ${ok ? "success" : "error"}">
          <div class="mcp-header-left">
            <div class="mcp-header-icon">${ok ? "✅" : "⚠️"}</div>
            <div class="mcp-header-title">${
              ok
                ? "Blockchain Transaction Successful"
                : "Blockchain Transaction Failed"
            }</div>
          </div>
          <span class="mcp-tag">APTOS TX</span>
        </div>
        <div class="mcp-main-row">
          <div class="mcp-primary-label">Transaction status</div>
          <div class="mcp-primary-number" style="font-size:18px;">${
            ok ? "Success" : "Failed"
          }</div>
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

    /* ---- Old mock / custom MCP format ---- */
    const action = body.action || "";
    const status = body.status || "";
    const msg = body.message || "";
    const isSuccess = status === "success";

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
      </div>`;
    }

    /* ---- Issue GECs ---- */
    if (action === "issue_gecs") {
      const q   = body.issued_quantity ?? body.quantity ?? "?";
      const acc = body.account_id   || "—";
      const dev = body.device_id    || "—";
      const src = body.energy_source || "—";
      const from = body.time_window?.from || "Not specified";
      const to   = body.time_window?.to   || "Not specified";

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
        </div>
      </div>`;
    }

    /* ---- Transfer GECs ---- */
    if (action === "transfer_gecs") {
      const q    = body.transferred_quantity ?? body.quantity ?? "?";
      const from = body.source_account_id || "—";
      const to   = body.target_account_id || "—";

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
        </div>
      </div>`;
    }

    /* ---- Retire / Cancel GECs ---- */
    if (action === "retire_gecs" || action === "cancel_gecs") {
      const q      = body.retired_quantity ?? body.quantity ?? "?";
      const acc    = body.account_id || "—";
      const reason = body.reason     || "Not provided";

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
        </div>
      </div>`;
    }

    /* ---- Query GECs (balance) ---- */
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
        </div>`;
      }

      let totalQty = 0;
      let accountId = "—";
      const itemsHtml = results
        .map((r, idx) => {
          const q = typeof r.quantity === "number" ? r.quantity : 0;
          totalQty += q;
          accountId = r.account_id || accountId;
          const src = r.energy_source || "—";
          const dev = r.device_id     || "—";
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
        </div>
      </div>`;
    }

    /* ---- Fallback: generic success card with raw JSON ---- */
    return `
    <div class="mcp-card">
      <div class="mcp-header success">
        <div class="mcp-header-left">
          <div class="mcp-header-icon">ℹ️</div>
          <div class="mcp-header-title">MCP Result</div>
        </div>
        <span class="mcp-tag">${action || "MCP"}</span>
      </div>
      <pre style="font-size:11px; white-space:pre-wrap; margin:0;">${JSON.stringify(
        body,
        null,
        2
      )}</pre>
    </div>`;
  }

  function renderMcpCard(body, targetEl) {
    if (!targetEl) return;
    targetEl.innerHTML = formatMcpBodyHtml(body);
  }

  global.MCPCard = {
    format: formatMcpBodyHtml,
    render: renderMcpCard,
  };
})(window);