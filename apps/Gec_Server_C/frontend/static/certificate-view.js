(function () {
  "use strict";

  /* ---------------- helpers ---------------- */

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isMissing(value) {
    if (value === null || value === undefined) return true;
    const s = String(value).trim();
    return s === "" || s === "—" || s.toLowerCase() === "null" || s.toLowerCase() === "undefined";
  }

  function pick(...values) {
    for (const v of values) {
      if (!isMissing(v)) return v;
    }
    return undefined;
  }

  function formatNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num.toLocaleString() : value;
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  function parseDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // The certificate document must show times exactly as recorded, so we
  // render in UTC rather than the viewer's local timezone.
  function isoLooksLocal(value) {
    if (typeof value !== "string") return false;
    return !/Z$|[+\-]\d\d:?\d\d$/.test(value.trim());
  }

  function formatIssueDate(value) {
    const d = parseDate(value);
    if (!d) return value || "—";
    const useLocal = isoLooksLocal(value);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const day = useLocal ? d.getDate() : d.getUTCDate();
    const mon = useLocal ? d.getMonth() : d.getUTCMonth();
    const year = useLocal ? d.getFullYear() : d.getUTCFullYear();
    return `${pad2(day)}-${months[mon]}-${year}`;
  }

  function formatDateRange(start, end) {
    const s = parseDate(start);
    if (!s) return "—";
    const e = parseDate(end);
    const useLocal = isoLooksLocal(start);
    const fmtDate = (d) => {
      if (useLocal) {
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      }
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    };
    const fmtTime = (d) => {
      const h = useLocal ? d.getHours() : d.getUTCHours();
      const mins = pad2(useLocal ? d.getMinutes() : d.getUTCMinutes());
      const ampm = h >= 12 ? "PM" : "AM";
      const hour12 = ((h + 11) % 12) + 1;
      return `${pad2(hour12)}:${mins} ${ampm}`;
    };
    const date = fmtDate(s);
    if (e) return `${date} | ${fmtTime(s)} – ${fmtTime(e)}`;
    return `${date} | ${fmtTime(s)}`;
  }

  function formatCertId(rawId, createdAt) {
    if (!rawId) return "—";
    const text = String(rawId);
    if (/^GEC-\d{4}-\d{4,}$/i.test(text)) return text.toUpperCase();
    const numericMatch = text.match(/(\d+)/);
    const numeric = numericMatch ? numericMatch[1] : text;
    const padded = numeric.padStart(6, "0");
    const year = (parseDate(createdAt) || new Date()).getFullYear();
    return `GEC-${year}-${padded}`;
  }

  function shortenAddress(addr, head = 8, tail = 6) {
    if (!addr) return "—";
    const s = String(addr);
    if (s.length <= head + tail + 2) return s;
    return `${s.slice(0, head)}…${s.slice(-tail)}`;
  }

  function humanStatus(value) {
    if (!value) return "UNKNOWN";
    return String(value).toUpperCase();
  }

  function titleCase(value) {
    if (!value) return "";
    return String(value)
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }

  function energySourceLabel(value) {
    if (!value) return "—";
    const v = String(value).toLowerCase();
    if (v.includes("solar")) return "Solar Energy";
    if (v.includes("wind")) return "Wind Energy";
    if (v.includes("hydro")) return "Hydro Energy";
    if (v.includes("bio")) return "Biomass Energy";
    if (v.includes("geo")) return "Geothermal Energy";
    return titleCase(v) + " Energy";
  }

  /* ---------------- icons (inline SVG) ---------------- */

  const ICONS = {
    document: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>`,
    solar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.2"/><path d="M12 2v1.6M19 8h-1.6M6.6 8H5M16.6 3.4l-1.1 1.1M8.5 4.5 7.4 3.4"/><path d="M4 21h16M6 17h12l-1.5-4h-9z"/></svg>`,
    star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="m12 3 2.7 5.5 6 .9-4.4 4.3 1 6-5.3-2.8L6.7 19.7l1-6L3.3 9.4l6-.9z"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
    pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/></svg>`,
    userVerified: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="8" r="3.5"/><path d="M4.5 20a6.5 6.5 0 0 1 12-3.5"/><path d="m17 18 1.6 1.6L22 16"/></svg>`,
    user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>`,
    userOutline: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 3 4 6 4 9s-1.4 6-4 9c-2.6-3-4-6-4-9s1.4-6 4-9z"/></svg>`,
    chain: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M15 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/></svg>`,
    contract: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="m9 14 2 2 4-4"/></svg>`,
    aptos: `<svg viewBox="0 0 24 24" fill="none" stroke="#1d6549" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M5 13h4l1.4-2 2 4 1.6-3 1.4 2H19"/></svg>`,
  };

  /* ---------------- decorative SVGs ---------------- */

  const LOGO_SVG = `
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="32" cy="32" r="30" fill="#fffaf0" stroke="#1d5b3a" stroke-width="2"/>
      <!-- sun -->
      <circle cx="32" cy="22" r="5.5" fill="#f3c452" stroke="#8a6a2c" stroke-width="1"/>
      <g stroke="#c9a14e" stroke-width="1.4" stroke-linecap="round">
        <path d="M32 11.5v3"/><path d="M32 29.5v3"/>
        <path d="M22.5 22h3"/><path d="M38.5 22h3"/>
        <path d="m25.4 15.4 2.1 2.1"/><path d="m36.5 26.5 2.1 2.1"/>
        <path d="m38.6 15.4-2.1 2.1"/><path d="m27.5 26.5-2.1 2.1"/>
      </g>
      <!-- solar panel -->
      <g transform="translate(20 32)">
        <rect x="0" y="0" width="24" height="11" fill="#1d5b3a" stroke="#143f29" stroke-width="1" rx="1"/>
        <path d="M6 0v11M12 0v11M18 0v11M0 5.5h24" stroke="#fffaf0" stroke-width="0.8"/>
        <path d="M2 11l2 5h16l2-5z" fill="#143f29"/>
      </g>
      <!-- leaves / sprouts -->
      <path d="M14 47c2-4 6-5 9-5-1 4-4 6-9 5z" fill="#2c7a4f"/>
      <path d="M50 47c-2-4-6-5-9-5 1 4 4 6 9 5z" fill="#2c7a4f"/>
    </svg>`;

  const CORNER_SVG = `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <path d="M6 6 L40 6"/>
        <path d="M6 6 L6 40"/>
        <path d="M14 14 L36 14"/>
        <path d="M14 14 L14 36"/>
        <!-- floral curls -->
        <path d="M22 22c4 0 8 2 10 6"/>
        <path d="M22 22c0 4 2 8 6 10"/>
        <path d="M30 30c2 4 6 6 10 6"/>
        <path d="M30 30c4 2 6 6 6 10"/>
        <circle cx="22" cy="22" r="1.4" fill="currentColor"/>
        <circle cx="40" cy="36" r="1.2" fill="currentColor"/>
        <circle cx="36" cy="40" r="1.2" fill="currentColor"/>
      </g>
    </svg>`;

  const VERIFIED_BADGE_SVG = `
    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <radialGradient id="goldGrad" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stop-color="#f3d27a"/>
          <stop offset="55%" stop-color="#c9a14e"/>
          <stop offset="100%" stop-color="#8a6a2c"/>
        </radialGradient>
      </defs>
      <!-- ribbons -->
      <path d="M30 80 L18 110 L36 100 L42 112 L54 88" fill="#b78535" stroke="#7a5320" stroke-width="1"/>
      <path d="M90 80 L102 110 L84 100 L78 112 L66 88" fill="#b78535" stroke="#7a5320" stroke-width="1"/>
      <!-- rays -->
      <g fill="url(#goldGrad)" stroke="#7a5320" stroke-width="0.8">
        <polygon points="60,4 64,18 56,18"/>
        <polygon points="60,116 64,102 56,102" />
        <polygon points="4,60 18,64 18,56"/>
        <polygon points="116,60 102,64 102,56"/>
        <polygon points="20,20 32,28 28,32"/>
        <polygon points="100,20 88,28 92,32"/>
        <polygon points="20,100 28,88 32,92"/>
        <polygon points="100,100 92,88 88,92"/>
      </g>
      <!-- outer disk -->
      <circle cx="60" cy="60" r="40" fill="url(#goldGrad)" stroke="#7a5320" stroke-width="1.4"/>
      <circle cx="60" cy="60" r="32" fill="#f6e3b0" stroke="#8a6a2c" stroke-width="1"/>
      <!-- inner disk: green -->
      <circle cx="60" cy="60" r="22" fill="#1d5b3a" stroke="#143f29" stroke-width="1.2"/>
      <!-- mini cert icon -->
      <g stroke="#fffaf0" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <rect x="50" y="50" width="20" height="20" rx="2"/>
        <path d="M55 58h10M55 62h10M55 66h6"/>
      </g>
      <!-- top text "VERIFIED" arc -->
      <path id="vArc" d="M30 60a30 30 0 0 1 60 0" fill="none"/>
      <text font-family="Georgia, serif" font-size="8.5" font-weight="700" fill="#5b3f12" letter-spacing="2">
        <textPath href="#vArc" startOffset="50%" text-anchor="middle">VERIFIED</textPath>
      </text>
      <!-- bottom text "AUTHORITY" arc -->
      <path id="aArc" d="M30 60a30 30 0 0 0 60 0" fill="none"/>
      <text font-family="Georgia, serif" font-size="7" font-weight="700" fill="#5b3f12" letter-spacing="2">
        <textPath href="#aArc" startOffset="50%" text-anchor="middle">★ AUTHORITY ★</textPath>
      </text>
    </svg>`;

  const SIGNATURE_SVG = `
    <svg class="squiggle" viewBox="0 0 130 36" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M4 22
               c 6 -16 14 -16 18 0
               s 12 16 18 0
               s 12 -16 18 0
               s 12 16 18 0
               s 12 -16 18 0
               s 12 16 18 0"/>
    </svg>`;

  /* ---------------- normalize input ---------------- */

  function normalizeCertificate(payload) {
    const cert = (payload && payload.certificate) || payload || {};

    const rawStatus = humanStatus(cert.status);
    const energySourceRaw = pick(cert.energy_source, cert.energySource);
    const energyAmount = pick(cert.energy_amount, cert.energyAmount);

    const ownerAccount = pick(cert.owner_account_address, cert.ownerAccount, cert.owner);
    const ownerDid = pick(cert.owner_did, cert.ownerDid);
    const previousOwner = pick(
      cert.previous_owner_account_address,
      cert.previous_owner,
      cert.previous_owner_did,
      cert.previousOwner,
    );

    const issuedBy = pick(
      cert.device_name,
      cert.deviceName,
      cert.issuer_name,
      cert.issuerName,
      cert.issuer_did,
      cert.issuer,
      cert.device_id,
    );

    const txHash = pick(cert.tx_hash, cert.txHash);
    const explorer = pick(cert.explorer_url, cert.explorerUrl);
    const moduleAddress = pick(
      cert.module_address,
      cert.moduleAddress,
      cert.smart_contract_id,
      cert.smartContractId,
      cert.contract_address,
    );

    const createdAt = pick(cert.created_at, cert.createdAt, cert.timestamp);

    const location = (() => {
      if (!isMissing(cert.location)) return cert.location;
      const city = pick(cert.city);
      const country = pick(cert.country);
      return [city, country].filter(Boolean).join(", ") || "—";
    })();

    return {
      rawId: cert.id,
      displayId: formatCertId(cert.id, createdAt),
      status: rawStatus,
      issueDate: formatIssueDate(createdAt),
      energySource: energySourceLabel(energySourceRaw),
      energyAmountText: !isMissing(energyAmount)
        ? `${formatNumber(energyAmount)} kWh`
        : "—",
      generationTime: formatDateRange(
        pick(cert.prod_start, cert.productionStart, cert.timestamp),
        pick(cert.prod_end, cert.productionEnd),
      ),
      location: location || "—",
      generatedBy: !isMissing(issuedBy) ? String(issuedBy) : "GEC Issuing Device",
      currentOwner: !isMissing(ownerAccount)
        ? String(ownerAccount)
        : !isMissing(ownerDid) ? String(ownerDid) : "—",
      previousOwner: !isMissing(previousOwner) ? String(previousOwner) : "N/A",
      network: "Aptos",
      txHash: !isMissing(txHash) ? String(txHash) : "—",
      explorerUrl: !isMissing(explorer) ? String(explorer) : "",
      smartContractId: !isMissing(moduleAddress) ? String(moduleAddress) : "—",
    };
  }

  /* ---------------- markup builders ---------------- */

  function row(icon, label, valueHtml, opts = {}) {
    const valueClass = ["row-value", opts.mono ? "mono" : ""].filter(Boolean).join(" ");
    return `
      <div class="cert-row">
        <span class="row-icon">${icon}</span>
        <span class="row-label">${escapeHtml(label)}</span>
        <span class="row-sep">:</span>
        <span class="${valueClass}">${valueHtml}</span>
      </div>
    `;
  }

  function buildMarkup(d) {
    const statusAttr = escapeHtml(d.status);
    return `
      <section class="certificate-shell" role="document" aria-label="Granular Energy Certificate">
        <span class="corner tl">${CORNER_SVG}</span>
        <span class="corner tr">${CORNER_SVG}</span>
        <span class="corner bl">${CORNER_SVG}</span>
        <span class="corner br">${CORNER_SVG}</span>

        <div class="certificate-document">
          <header class="certificate-header">
            <div class="certificate-logo">${LOGO_SVG}</div>
            <h1 class="certificate-title">GRANULAR ENERGY CERTIFICATE</h1>
            <p class="certificate-subtitle">— <span class="gec">( G E C )</span> —</p>
          </header>

          <section class="certificate-topbar">
            <div class="stat stat--id">
              <span class="icon">${ICONS.document}</span>
              <div>
                <label>Certificate ID</label>
                <div class="value mono">${escapeHtml(d.displayId)}</div>
              </div>
            </div>
            <div class="stat stat--status" data-status="${statusAttr}">
              <span class="icon">${ICONS.check}</span>
              <div>
                <label>Status</label>
                <div class="value"><span class="pill">${statusAttr}</span></div>
              </div>
            </div>
            <div class="stat stat--date">
              <span class="icon">${ICONS.calendar}</span>
              <div>
                <label>Issue Date</label>
                <div class="value">${escapeHtml(d.issueDate)}</div>
              </div>
            </div>
          </section>

          <section class="cert-section">
            <div class="cert-section__header">
              <span class="arrow">→</span>
              <span>ENERGY DETAILS</span>
              <span class="arrow">←</span>
            </div>
            <div class="cert-section__body">
              ${row(ICONS.solar, "Energy Source", escapeHtml(d.energySource))}
              ${row(ICONS.star, "Energy Generated", escapeHtml(d.energyAmountText))}
              ${row(ICONS.clock, "Generation Time", escapeHtml(d.generationTime))}
              ${row(ICONS.pin, "Location", escapeHtml(d.location))}
            </div>
          </section>

          <section class="cert-section">
            <div class="cert-section__header">
              <span class="arrow">→</span>
              <span>OWNERSHIP DETAILS</span>
              <span class="arrow">←</span>
            </div>
            <div class="cert-section__body">
              ${row(ICONS.userVerified, "Generated By", escapeHtml(d.generatedBy))}
              ${row(ICONS.user, "Current Owner",
                `<span class="hash" title="${escapeHtml(d.currentOwner)}">${escapeHtml(shortenAddress(d.currentOwner))}</span>`,
                { mono: true })}
              ${row(ICONS.userOutline, "Previous Owner",
                d.previousOwner === "N/A"
                  ? "N/A"
                  : `<span class="hash" title="${escapeHtml(d.previousOwner)}">${escapeHtml(shortenAddress(d.previousOwner))}</span>`,
                { mono: d.previousOwner !== "N/A" })}
            </div>
          </section>

          <section class="cert-section">
            <div class="cert-section__header">
              <span class="arrow">→</span>
              <span>BLOCKCHAIN DETAILS</span>
              <span class="arrow">←</span>
            </div>
            <div class="cert-section__body">
              ${row(ICONS.globe, "Network",
                `<span class="aptos">${ICONS.aptos}<span>${escapeHtml(d.network)}</span></span>`)}
              ${row(ICONS.chain, "Transaction Hash",
                d.explorerUrl
                  ? `<a class="hash" href="${escapeHtml(d.explorerUrl)}" target="_blank" rel="noopener" title="${escapeHtml(d.txHash)}">${escapeHtml(shortenAddress(d.txHash, 6, 6))}</a>`
                  : `<span class="hash" title="${escapeHtml(d.txHash)}">${escapeHtml(shortenAddress(d.txHash, 6, 6))}</span>`,
                { mono: true })}
              ${row(ICONS.contract, "Smart Contract ID",
                `<span class="hash" title="${escapeHtml(d.smartContractId)}">${escapeHtml(shortenAddress(d.smartContractId, 6, 6))}</span>`,
                { mono: true })}
            </div>
          </section>

          <footer class="certificate-footer">
            <div class="verified-badge">${VERIFIED_BADGE_SVG}</div>
            <div class="authority">
              <h3>Energy Certification Authority</h3>
              <p>Certifying Clean Energy &middot; Building a Sustainable Future</p>
            </div>
            <div class="signature">
              ${SIGNATURE_SVG}
              <div class="signed-line">Authorized Signature</div>
            </div>
          </footer>
        </div>
      </section>
    `;
  }

  /* ---------------- public API ---------------- */

  window.normalizeCertificate = normalizeCertificate;

  window.renderCertificate = function renderCertificate(container, payload) {
    if (!container) return;
    const data = normalizeCertificate(payload);
    container.classList.remove("empty-state");
    container.innerHTML = buildMarkup(data);
  };
})();
