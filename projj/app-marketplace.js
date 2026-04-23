// app-marketplace.js
// Marketplace view powered by session registry data
// Includes:
// - working All / Buy / Sell tabs
// - working Advanced filters
// - empty-state + demo fallback opportunities
// - clickable cards that push info into chat
// - automatic refresh compatibility with registry updates

if (!state.marketplace) {
  state.marketplace = {
    tab: "all", // all | buy | sell
    filters: {
      minVolume: "",
      energySource: "",
      status: ""
    },
    selectedOppId: null,
    manualListings: [],
    manualDemands: []
  };
}

function getRegistryAccountsSafe() {
  return Object.values((state.registry && state.registry.accounts) || {});
}

function getRegistryTxsSafe() {
  return Array.isArray(state.registry?.txs) ? state.registry.txs : [];
}

function formatMWh(n) {
  const num = Number(n) || 0;
  return `${num.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} MWh`;
}

function formatPlainNumber(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("en-US");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getEnergyMixFromRegistry() {
  const txs = getRegistryTxsSafe();
  const mix = {};

  txs.forEach((tx) => {
    if (tx.action !== "issue") return;
    const source = tx.energySource || "Unknown";
    const qty = Number(tx.quantity) || 0;
    mix[source] = (mix[source] || 0) + qty;
  });

  return mix;
}

function getMarketplaceStats() {
  const accounts = getRegistryAccountsSafe();

  const totalIssued = accounts.reduce((sum, acc) => sum + (Number(acc.issued) || 0), 0);
  const totalRetired = accounts.reduce((sum, acc) => sum + (Number(acc.retired) || 0), 0);
  const totalActive = accounts.reduce((sum, acc) => sum + (Number(acc.balance) || 0), 0);

  const matchedAgainstLoad = totalRetired;
  const excessAvailable = totalActive;
  const unmatchedDemand = Math.max(0, totalRetired - totalIssued);

  return {
    totalIssued,
    matchedAgainstLoad,
    excessAvailable,
    unmatchedDemand
  };
}

function getDemoOpportunities() {
  return [
    {
      id: "demo-sell-1",
      type: "buy",
      status: "open",
      title: "Solar – 500 MWh (REC)",
      subtitle: "Mahad Solar Park · PAK · 2024 vintage",
      priceLabel: "Ask price",
      priceValue: "$ 1,850 / MWh",
      volume: 500,
      volumeText: "500 MWh",
      thirdLabel: "Delivery window",
      thirdValue: "Q1 2026",
      energySource: "Solar",
      buttonText: "View offer",
      raw: { demo: true }
    },
    {
      id: "demo-buy-1",
      type: "sell",
      status: "open",
      title: "Corporate buyer – 1,200 MWh",
      subtitle: "Wind or solar · PAK or SAARC region",
      priceLabel: "Bid price",
      priceValue: "$ 1,700 / MWh",
      volume: 1200,
      volumeText: "1,200 MWh",
      thirdLabel: "Deadline",
      thirdValue: "29 Dec 2025",
      energySource: "Wind",
      buttonText: "View demand",
      raw: { demo: true }
    },
    {
      id: "demo-sell-2",
      type: "buy",
      status: "open",
      title: "Wind – 900 MWh",
      subtitle: "Sindh Wind Corridor · Session sample listing",
      priceLabel: "Ask price",
      priceValue: "$ 1,760 / MWh",
      volume: 900,
      volumeText: "900 MWh",
      thirdLabel: "Delivery window",
      thirdValue: "Jan 2026",
      energySource: "Wind",
      buttonText: "View offer",
      raw: { demo: true }
    }
  ];
}

function parsePriceFromText(text) {
  const s = String(text || "").toLowerCase();
  const m = s.match(/(?:price|rate|ask|bid)\s*(?:is|=|:)?\s*\$?\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : null;
}

function isSellIntent(text) {
  const s = String(text || "").toLowerCase();
  return /\b(sell|listing|list|for sale|put on market)\b/.test(s);
}

function isBuyIntent(text) {
  const s = String(text || "").toLowerCase();
  return /\b(buy|purchase|need|looking for|bid)\b/.test(s);
}

function buildDynamicOpportunities() {
  const txs = getRegistryTxsSafe();
  const manualListings = Array.isArray(state.marketplace?.manualListings)
    ? state.marketplace.manualListings
    : [];
  const manualDemands = Array.isArray(state.marketplace?.manualDemands)
    ? state.marketplace.manualDemands
    : [];

  if (!txs.length && !manualListings.length) {
    return getDemoOpportunities();
  }

  const issued = txs.filter((tx) => tx.action === "issue");
  const buyRequestsFromPrompts = txs.filter((tx) => isBuyIntent(tx.prompt));

  const opportunities = [];
  let idCounter = 1;

  manualListings.forEach((listing) => {
    const qty = Number(listing.volume) || 0;
    if (qty <= 0) return;
    opportunities.push({
      id: listing.id || `manual-${idCounter++}`,
      type: "buy",
      status: listing.status || "open",
      title: `${listing.energySource || "Renewable"} – ${qty} MWh`,
      subtitle: `${listing.seller || "Seller"} · Listed on marketplace`,
      priceLabel: "Ask price",
      priceValue:
        listing.price != null
          ? `$ ${formatPlainNumber(listing.price)} / MWh`
          : "Price pending",
      volume: qty,
      volumeText: `${qty} MWh`,
      thirdLabel: "Seller",
      thirdValue: listing.seller || "Unknown",
      energySource: listing.energySource || "Unknown",
      buttonText: "View listing",
      raw: { manual: true, ...listing }
    });
  });

  manualDemands.forEach((demand) => {
    const qty = Number(demand.volume) || 0;
    if (qty <= 0) return;
    opportunities.push({
      id: demand.id || `demand-${idCounter++}`,
      type: "sell",
      status: demand.status || "open",
      title: `Buyer demand – ${qty} MWh`,
      subtitle: `${demand.buyer || "Market participant"} · Wants to purchase`,
      priceLabel: "Bid price",
      priceValue:
        demand.price != null
          ? `$ ${formatPlainNumber(demand.price)} / MWh`
          : "Bid not specified",
      volume: qty,
      volumeText: `${qty} MWh`,
      thirdLabel: "Preferred source",
      thirdValue: demand.energySource || "Any renewable",
      energySource: demand.energySource || "Any renewable",
      buttonText: "View demand",
      raw: { manualDemand: true, ...demand }
    });
  });

  // Buy opportunities tab should show what buyers can buy (sell listings).
  // We only list certificates when user intent says sell/list, or price is provided.
  issued.forEach((tx) => {
    const prompt = tx.prompt || "";
    const sellIntent = isSellIntent(prompt);
    const parsedPrice = parsePriceFromText(prompt);
    const qty = Number(tx.quantity) || 0;
    if (qty <= 0 || (!sellIntent && parsedPrice == null)) return;

    opportunities.push({
      id: `opp-${idCounter++}`,
      type: "buy",
      status: "open",
      title: `${tx.energySource || "Renewable"} – ${qty} MWh`,
      subtitle: `${tx.to || "Account"} · Listed by seller`,
      priceLabel: "Ask price",
      priceValue: parsedPrice != null ? `$ ${formatPlainNumber(parsedPrice)} / MWh` : "Price pending",
      volume: qty,
      volumeText: `${qty} MWh`,
      thirdLabel: "Seller",
      thirdValue: tx.to || "Unknown",
      energySource: tx.energySource || "Unknown",
      buttonText: "View listing",
      raw: tx
    });
  });

  // Sell opportunities tab should show active buy demand from buyers.
  buyRequestsFromPrompts.forEach((tx) => {
    const qty = Number(tx.quantity) || 0;
    if (qty <= 0) return;
    const parsedPrice = parsePriceFromText(tx.prompt || "");
    opportunities.push({
      id: `opp-${idCounter++}`,
      type: "sell",
      status: "open",
      title: `Buyer demand – ${qty} MWh`,
      subtitle: `${tx.to || tx.from || "Market participant"} · Wants to purchase`,
      priceLabel: "Bid price",
      priceValue: parsedPrice != null ? `$ ${formatPlainNumber(parsedPrice)} / MWh` : "Bid not specified",
      volume: qty,
      volumeText: `${qty} MWh`,
      thirdLabel: "Preferred source",
      thirdValue: tx.energySource || "Any renewable",
      energySource: tx.energySource || "Any renewable",
      buttonText: "View demand",
      raw: tx
    });
  });

  if (!opportunities.length) {
    return getDemoOpportunities();
  }

  return opportunities;
}

function getFilteredOpportunities() {
  const all = buildDynamicOpportunities();
  const { tab, filters } = state.marketplace;

  return all.filter((opp) => {
    if (tab !== "all" && opp.type !== tab) return false;

    if (filters.minVolume !== "" && Number(opp.volume) < Number(filters.minVolume)) {
      return false;
    }

    if (
      filters.energySource &&
      String(opp.energySource || "").toLowerCase() !==
        String(filters.energySource).toLowerCase()
    ) {
      return false;
    }

    if (
      filters.status &&
      String(opp.status || "").toLowerCase() !== String(filters.status).toLowerCase()
    ) {
      return false;
    }

    return true;
  });
}

function renderOpportunityCard(opp) {
  const typeClass = opp.type === "buy" ? "badge-buy" : "badge-sell";
  const typeLabel = opp.type === "buy" ? "Buy opportunity" : "Sell opportunity";
  const safeTitle = escapeHtml(opp.title);
  const safeSubtitle = escapeHtml(opp.subtitle);
  const safePriceLabel = escapeHtml(opp.priceLabel);
  const safePriceValue = escapeHtml(opp.priceValue);
  const safeVolume = escapeHtml(opp.volumeText);
  const safeThirdLabel = escapeHtml(opp.thirdLabel);
  const safeThirdValue = escapeHtml(opp.thirdValue);
  const safeButtonText = escapeHtml(opp.buttonText);
  const safeStatus = escapeHtml(opp.status);

  return `
    <article class="market-opp-card" data-id="${escapeHtml(opp.id)}" data-type="${escapeHtml(opp.type)}" data-status="${escapeHtml(opp.status)}">
      <div class="opp-top">
        <div class="opp-badges">
          <span class="badge ${typeClass}">${typeLabel}</span>
          <span class="badge badge-status">${safeStatus}</span>
        </div>
        <button class="opp-cta" type="button" data-opp-id="${escapeHtml(opp.id)}">${safeButtonText}</button>
      </div>

      <div class="opp-title">${safeTitle}</div>
      <div class="opp-subtitle">${safeSubtitle}</div>

      <div class="opp-meta-row">
        <div>
          <div class="opp-meta-label">${safePriceLabel}</div>
          <div>${safePriceValue}</div>
        </div>
        <div>
          <div class="opp-meta-label">Volume</div>
          <div>${safeVolume}</div>
        </div>
        <div>
          <div class="opp-meta-label">${safeThirdLabel}</div>
          <div>${safeThirdValue}</div>
        </div>
      </div>
    </article>
  `;
}

function updateMarketplaceKpis() {
  const totalIssuedEl = document.getElementById("kpi-total-issued");
  const matchedEl = document.getElementById("kpi-matching-gen");
  const excessEl = document.getElementById("kpi-excess");
  const unmatchedEl = document.getElementById("kpi-unmatched");

  const stats = getMarketplaceStats();

  if (totalIssuedEl) totalIssuedEl.textContent = formatMWh(stats.totalIssued);
  if (matchedEl) matchedEl.textContent = formatMWh(stats.matchedAgainstLoad);
  if (excessEl) excessEl.textContent = formatMWh(stats.excessAvailable);
  if (unmatchedEl) unmatchedEl.textContent = formatMWh(stats.unmatchedDemand);
}

function renderMiniBarChart(series) {
  const width = 360;
  const height = 160;
  const pad = 18;
  const barW = Math.max(16, Math.floor((width - pad * 2) / Math.max(series.length, 1) - 10));
  const max = Math.max(1, ...series.map((x) => x.value));

  const bars = series
    .map((d, idx) => {
      const h = Math.round((d.value / max) * (height - pad * 2));
      const x = pad + idx * (barW + 10);
      const y = height - pad - h;
      return `
        <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="#00988b"></rect>
        <text x="${x + barW / 2}" y="${height - 4}" text-anchor="middle" font-size="10" fill="#4b5563">${escapeHtml(d.label)}</text>
      `;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="160" role="img" aria-label="Marketplace chart">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#ecfeff"></rect>
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#9ca3af"></line>
      ${bars}
    </svg>
  `;
}

function renderSupplyDemandChart() {
  const stats = getMarketplaceStats();
  const data = [
    { label: "Issued", value: Number(stats.totalIssued) || 0 },
    { label: "Retired", value: Number(stats.matchedAgainstLoad) || 0 },
    { label: "Active", value: Number(stats.excessAvailable) || 0 }
  ];
  return renderMiniBarChart(data);
}

function renderPriceBandChart() {
  const sells = buildDynamicOpportunities().filter((opp) => opp.type === "buy");
  const bandMap = {};

  sells.forEach((opp) => {
    const p = parsePriceFromText(opp.raw?.prompt || "");
    if (p == null) return;
    const source = opp.energySource || "Unknown";
    if (!bandMap[source]) {
      bandMap[source] = { total: 0, count: 0 };
    }
    bandMap[source].total += p;
    bandMap[source].count += 1;
  });

  const entries = Object.entries(bandMap).map(([label, v]) => ({
    label: label.slice(0, 8),
    value: v.count ? v.total / v.count : 0
  }));

  if (!entries.length) {
    const mix = getEnergyMixFromRegistry();
    const fallback = Object.keys(mix).slice(0, 4).map((k) => ({
      label: k.slice(0, 8),
      value: Number(mix[k]) || 0
    }));
    return renderMiniBarChart(fallback.length ? fallback : [{ label: "No data", value: 1 }]);
  }

  return renderMiniBarChart(entries);
}

function updateMarketplaceCharts() {
  const chartCards = document.querySelectorAll(".chart-card");
  if (!chartCards || !chartCards.length) return;

  chartCards.forEach((card, idx) => {
    const placeholder = card.querySelector(".chart-placeholder");
    if (!placeholder) return;
    if (idx === 0) {
      placeholder.innerHTML = renderSupplyDemandChart();
    } else if (idx === 1) {
      placeholder.innerHTML = renderPriceBandChart();
    }
  });
}

function updateMarketplaceOpportunities() {
  const listEl = document.getElementById("market-opps-list");
  const footerEl = document.querySelector(".market-opps-footer");

  if (!listEl) return;

  const opportunities = getFilteredOpportunities();

  if (!opportunities.length) {
    listEl.innerHTML = `
      <article class="market-opp-card" data-type="empty" data-status="empty">
        <div class="opp-title">No opportunities match the current filters</div>
        <div class="opp-subtitle">
          Try switching tabs or clearing filters.
        </div>
      </article>
    `;

    if (footerEl) {
      footerEl.textContent =
        "No matching marketplace items for the current tab/filter selection.";
    }
    return;
  }

  listEl.innerHTML = opportunities.map(renderOpportunityCard).join("");

  if (footerEl) {
    const hasDemo = opportunities.some((opp) => opp.raw && opp.raw.demo);
    footerEl.textContent = hasDemo
      ? `Showing ${opportunities.length} sample opportunit${opportunities.length > 1 ? "ies" : "y"} for demo preview.`
      : `Showing ${opportunities.length} opportunit${opportunities.length > 1 ? "ies" : "y"} from session registry activity.`;
  }
}

function getFilterCount() {
  const f = state.marketplace.filters || {};
  let count = 0;
  if (String(f.minVolume || "").trim() !== "") count += 1;
  if (String(f.energySource || "").trim() !== "") count += 1;
  if (String(f.status || "").trim() !== "") count += 1;
  return count;
}

function renderMarketplaceControls() {
  const filterBtn = document.getElementById("market-filter-btn");
  const primaryBtn = document.getElementById("market-primary-action");
  const count = getFilterCount();
  if (filterBtn) {
    filterBtn.textContent = count > 0 ? `Filters (${count})` : "Filters";
  }
  if (!primaryBtn) return;

  if (state.marketplace.tab === "sell") {
    primaryBtn.textContent = "Sell Certificate";
  } else if (state.marketplace.tab === "buy") {
    primaryBtn.textContent = "Buy Certificate";
  } else {
    primaryBtn.textContent = "Marketplace Action";
  }
}

function applyMarketplaceTopbar() {
  const titleEl = document.getElementById("topbar-title");
  const subtitleEl = document.querySelector(".top-left p");

  if (titleEl) titleEl.textContent = "GEC Marketplace";
  if (subtitleEl) {
    subtitleEl.textContent = "";
    subtitleEl.style.display = "none";
  }
}

function syncMarketplaceTabsUi() {
  const tabs = document.querySelectorAll(".market-tab");
  tabs.forEach((tabBtn) => {
    const isActive = tabBtn.dataset.tab === state.marketplace.tab;
    tabBtn.classList.toggle("active", isActive);
    tabBtn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

function attachMarketplaceTabHandlers() {
  const tabs = document.querySelectorAll(".market-tab");
  tabs.forEach((tabBtn) => {
    if (tabBtn.dataset.bound === "1") return;
    tabBtn.dataset.bound = "1";

    tabBtn.addEventListener("click", () => {
      state.marketplace.tab = tabBtn.dataset.tab || "all";
      syncMarketplaceTabsUi();
      renderMarketplaceControls();
      updateMarketplaceOpportunities();
      saveToStorage();
    });
  });
}

function attachAdvancedFilterHandler() {
  const filterBtn = document.getElementById("market-filter-btn");
  const panel = document.getElementById("market-filters-panel");
  const applyBtn = document.getElementById("market-filter-apply");
  const clearBtn = document.getElementById("market-filter-clear");
  const minEl = document.getElementById("market-filter-min-volume");
  const sourceEl = document.getElementById("market-filter-source");
  const statusEl = document.getElementById("market-filter-status");

  if (filterBtn && filterBtn.dataset.bound !== "1") {
    filterBtn.dataset.bound = "1";
    filterBtn.addEventListener("click", () => {
      if (!panel) return;
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    });
  }

  if (applyBtn && applyBtn.dataset.bound !== "1") {
    applyBtn.dataset.bound = "1";
    applyBtn.addEventListener("click", () => {
      state.marketplace.filters = {
        minVolume: String(minEl?.value || "").trim(),
        energySource: String(sourceEl?.value || "").trim(),
        status: String(statusEl?.value || "").trim().toLowerCase()
      };
      renderMarketplaceControls();
      updateMarketplaceOpportunities();
      saveToStorage();
    });
  }

  if (clearBtn && clearBtn.dataset.bound !== "1") {
    clearBtn.dataset.bound = "1";
    clearBtn.addEventListener("click", () => {
      if (minEl) minEl.value = "";
      if (sourceEl) sourceEl.value = "";
      if (statusEl) statusEl.value = "";
      state.marketplace.filters = { minVolume: "", energySource: "", status: "" };
      renderMarketplaceControls();
      updateMarketplaceOpportunities();
      saveToStorage();
    });
  }

  if (minEl && sourceEl && statusEl) {
    minEl.value = state.marketplace.filters?.minVolume || "";
    sourceEl.value = state.marketplace.filters?.energySource || "";
    statusEl.value = state.marketplace.filters?.status || "";
  }
}

function openSellCertificateFlow() {
  const accounts = getRegistryAccountsSafe().filter((a) => Number(a.balance) > 0);
  if (!accounts.length) {
    window.alert("No account has available certificates to sell yet.");
    return;
  }

  const accountHint = accounts
    .map((a) => `${a.accountId} (${formatPlainNumber(a.balance)} MWh available)`)
    .join("\n");

  const seller = window.prompt(`Enter seller account ID:\n${accountHint}`, accounts[0].accountId);
  if (seller === null) return;

  const sellerAcc = accounts.find((a) => String(a.accountId) === String(seller).trim());
  if (!sellerAcc) return window.alert("Invalid seller account.");

  const qtyInput = window.prompt(
    `How many MWh do you want to sell? (Max ${formatPlainNumber(sellerAcc.balance)})`,
    String(Math.min(100, Number(sellerAcc.balance) || 0))
  );
  if (qtyInput === null) return;
  const qty = Number(qtyInput);
  if (!Number.isFinite(qty) || qty <= 0 || qty > Number(sellerAcc.balance)) {
    return window.alert("Invalid quantity.");
  }

  const priceInput = window.prompt("Set ask price per MWh (e.g. 1750):", "1750");
  if (priceInput === null) return;
  const price = Number(priceInput);
  if (!Number.isFinite(price) || price <= 0) return window.alert("Invalid price.");

  const sourceInput = window.prompt("Energy source (e.g. Solar, Wind):", "Solar");
  if (sourceInput === null) return;
  const energySource = String(sourceInput || "Renewable").trim() || "Renewable";

  if (!Array.isArray(state.marketplace.manualListings)) state.marketplace.manualListings = [];
  state.marketplace.manualListings.unshift({
    id: `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    seller: sellerAcc.accountId,
    volume: qty,
    price,
    energySource,
    status: "open",
    createdAt: new Date().toISOString()
  });

  updateMarketplaceCharts();
  updateMarketplaceOpportunities();
  saveToStorage();
}

function openBuyDemandFlow() {
  const buyer = window.prompt("Enter buyer account ID:", state.user?.id || "buyer-account");
  if (buyer === null || !String(buyer).trim()) return;
  const qtyInput = window.prompt("How many MWh do you want to buy?", "100");
  if (qtyInput === null) return;
  const qty = Number(qtyInput);
  if (!Number.isFinite(qty) || qty <= 0) return window.alert("Invalid quantity.");
  const bidInput = window.prompt("Set bid price per MWh (optional):", "1700");
  if (bidInput === null) return;
  const bid = String(bidInput).trim() === "" ? null : Number(bidInput);
  if (bid !== null && (!Number.isFinite(bid) || bid <= 0)) return window.alert("Invalid bid.");
  const sourceInput = window.prompt("Preferred energy source (optional):", "Solar");
  if (sourceInput === null) return;

  if (!Array.isArray(state.marketplace.manualDemands)) state.marketplace.manualDemands = [];
  state.marketplace.manualDemands.unshift({
    id: `demand-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    buyer: String(buyer).trim(),
    volume: qty,
    price: bid,
    energySource: String(sourceInput || "Any renewable").trim() || "Any renewable",
    status: "open",
    createdAt: new Date().toISOString()
  });

  updateMarketplaceCharts();
  updateMarketplaceOpportunities();
  saveToStorage();
}

function executeBuyFromListing(opp) {
  if (!opp?.raw) return;
  const listingId = opp.id;
  const listings = Array.isArray(state.marketplace.manualListings) ? state.marketplace.manualListings : [];
  const listing = listings.find((l) => l.id === listingId);
  if (!listing) return window.alert("This listing cannot be purchased directly.");

  const buyerId = window.prompt("Enter buyer account ID:", state.user?.id || "buyer-account");
  if (buyerId === null || !String(buyerId).trim()) return;

  const qtyInput = window.prompt(
    `Quantity to buy (max ${formatPlainNumber(listing.volume)} MWh):`,
    String(listing.volume)
  );
  if (qtyInput === null) return;
  const qty = Number(qtyInput);
  if (!Number.isFinite(qty) || qty <= 0 || qty > Number(listing.volume)) {
    return window.alert("Invalid quantity.");
  }

  const sellerAcc = ensureRegistryAccount ? ensureRegistryAccount(listing.seller) : null;
  const buyerAcc = ensureRegistryAccount ? ensureRegistryAccount(String(buyerId).trim()) : null;
  if (!sellerAcc || !buyerAcc) return window.alert("Could not resolve seller/buyer account.");
  if (Number(sellerAcc.balance) < qty) return window.alert("Seller balance is not enough.");

  sellerAcc.balance -= qty;
  sellerAcc.sent += qty;
  buyerAcc.balance += qty;
  buyerAcc.received += qty;

  listing.volume = Number(listing.volume) - qty;
  listing.status = listing.volume <= 0 ? "closed" : "partial";

  if (typeof addRegistryTx === "function") {
    addRegistryTx({
      action: "transfer",
      quantity: qty,
      from: listing.seller,
      to: String(buyerId).trim(),
      deviceId: "marketplace",
      energySource: listing.energySource || "Unknown",
      status: "Completed",
      prompt: `Marketplace purchase from listing ${listing.id}`
    });
  }

  updateMarketplaceKpis();
  updateMarketplaceCharts();
  updateMarketplaceOpportunities();
  if (typeof renderRegistry === "function" && state.view === "registry") renderRegistry();
  saveToStorage();
}

function attachPrimaryActionHandler() {
  const btn = document.getElementById("market-primary-action");
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", () => {
    if (state.marketplace.tab === "sell") {
      openSellCertificateFlow();
    } else if (state.marketplace.tab === "buy") {
      openBuyDemandFlow();
    } else {
      window.alert("Select Buy or Sell tab to perform marketplace actions.");
    }
  });
}

function attachOpportunityHandlers() {
  const listEl = document.getElementById("market-opps-list");
  if (!listEl || listEl.dataset.bound === "1") return;

  listEl.dataset.bound = "1";

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".opp-cta");
    if (!btn) return;

    const oppId = btn.dataset.oppId;
    const opportunities = getFilteredOpportunities();
    const opp = opportunities.find((x) => x.id === oppId);
    if (!opp) return;

    state.marketplace.selectedOppId = opp.id;

    if (state.marketplace.tab === "buy" && opp.type === "buy") {
      executeBuyFromListing(opp);
      return;
    }

    const detailMessage =
      `Selected opportunity:\n` +
      `• Title: ${opp.title}\n` +
      `• Type: ${opp.type}\n` +
      `• Status: ${opp.status}\n` +
      `• Volume: ${opp.volumeText}\n` +
      `• ${opp.thirdLabel}: ${opp.thirdValue}\n` +
      `• ${opp.priceLabel}: ${opp.priceValue}`;

    if (typeof pushSystemMessage === "function") {
      pushSystemMessage(detailMessage);
      state.view = "chat";
      renderAll();
      return;
    }

    window.alert(detailMessage);
  });
}

function renderMarketplace() {
  updateMarketplaceKpis();
  updateMarketplaceCharts();
  syncMarketplaceTabsUi();
  renderMarketplaceControls();
  updateMarketplaceOpportunities();
  attachMarketplaceTabHandlers();
  attachAdvancedFilterHandler();
  attachPrimaryActionHandler();
  attachOpportunityHandlers();
}