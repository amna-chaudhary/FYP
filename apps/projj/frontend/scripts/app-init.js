// app-init.js
// ---------------------------------------------------------------
// Startup + event wiring. Runs once on DOMContentLoaded.
// NOTE: the sidebar user-menu (kebab -> Settings / Logout) and the
//       Settings modal are wired up inside index.html's inline
//       script — do NOT re-wire them here or the toggle fires twice
//       and the menu appears to do nothing.
// ---------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  // ── Restore persisted state ────────────────────────────────────
  if (typeof loadFromStorage === "function") loadFromStorage();
  if (typeof loadUser === "function") loadUser();
  if (typeof protectPrivateRoute === "function" && !protectPrivateRoute()) return;

  // ── DOM refs ───────────────────────────────────────────────────
  const btnNewChat      = document.getElementById("btn-new-chat");
  const btnOpenMarket   = document.getElementById("btn-open-marketplace");
  const btnOpenRegistry = document.getElementById("btn-open-registry");
  const btnClearAll     = document.getElementById("btn-clear-all");
  const searchInput     = document.getElementById("search-input");

  const heroInput   = document.getElementById("hero-input");
  const heroSendBtn = document.getElementById("hero-send-btn");
  const dockInput   = document.getElementById("dock-input");
  const dockSendBtn = document.getElementById("dock-send-btn");

  const btnLogin  = document.getElementById("btn-login");
  // btn-logout is handled by index.html's inline script (opens confirmation modal)

  // ── New chat ───────────────────────────────────────────────────
  if (btnNewChat) {
    btnNewChat.addEventListener("click", () => {
      state.currentId = null;
      state.view      = "chat";
      state.search    = "";
      state.isTyping  = false;
      renderAll();
    });
  }

  // ── Marketplace ────────────────────────────────────────────────
  if (btnOpenMarket) {
    btnOpenMarket.addEventListener("click", () => {
      state.view = "market";
      renderAll();
    });
  }

  // ── Registry ───────────────────────────────────────────────────
  if (btnOpenRegistry) {
    btnOpenRegistry.addEventListener("click", () => {
      state.view = "registry";
      renderAll();
    });
  }

  // ── Clear all (optional button) ────────────────────────────────
  if (btnClearAll) {
    btnClearAll.addEventListener("click", handleClearAll);
  }

  // ── Search ─────────────────────────────────────────────────────
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.search = e.target.value || "";
      renderHistory();
    });
  }

  // ── Hero send ──────────────────────────────────────────────────
  if (heroSendBtn && heroInput) {
    heroSendBtn.addEventListener("click", () => {
      const text = heroInput.value;
      heroInput.value = "";
      handleSend(text, false);
    });

    heroInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const text = heroInput.value;
        heroInput.value = "";
        handleSend(text, false);
      }
    });
  }

  // ── Dock send ──────────────────────────────────────────────────
  if (dockSendBtn && dockInput) {
    dockSendBtn.addEventListener("click", () => {
      const text = dockInput.value;
      dockInput.value = "";
      handleSend(text, false);
    });

    dockInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const text = dockInput.value;
        dockInput.value = "";
        handleSend(text, false);
      }
    });
  }

  // ── Login / Logout ─────────────────────────────────────────────
  if (btnLogin) {
    btnLogin.addEventListener("click", () => {
      window.location.href = "login.html";
    });
  }
  // Logout is owned by index.html's inline script (confirmation modal →
  // clear localStorage → redirect). We don't wire btn-logout here.

  // ── Sidebar user-menu (kebab) + Settings modal ─────────────────
  // Handled inside index.html's inline script. DO NOT duplicate
  // handlers here or the toggle cancels itself out.

  // ── First paint ────────────────────────────────────────────────
  renderAll();
});
