// auth_login.js (FULL CODE - improved + aligned with your earlier apiPostJson helper)
//
// ✅ Keeps your UI/DOM behavior
// ✅ Validates inputs
// ✅ Uses apiPostJson() (adds Authorization automatically if token exists)
// ✅ Preserves your "demo mode" fallback if backend not reachable
// ✅ Stores user+token via saveUser() when login/logout happens (blockchain/MCP ready)

function openLoginModal() {
  const screen = document.getElementById("login-screen");
  const nameInput = document.getElementById("login-name");
  const didInput = document.getElementById("login-did");
  const roleInput = document.getElementById("login-role");
  const errorEl = document.getElementById("login-error");

  if (!screen) {
    console.error("login-screen not found in DOM");
    return;
  }

  screen.style.display = "flex";

  if (nameInput) nameInput.value = "";
  if (didInput) didInput.value = "";
  if (roleInput) roleInput.value = "";
  if (errorEl) errorEl.textContent = "";
}

function closeLoginModal() {
  const screen = document.getElementById("login-screen");
  if (screen) screen.style.display = "none";
}

function _setLoginError(msg) {
  const errorEl = document.getElementById("login-error");
  if (errorEl) errorEl.textContent = msg || "";
}

function _buildDemoCredential({ did, name, role }) {
  // NOTE: This is demo SSI data. In a real SSI flow, you'd sign/verifiable credential.
  return {
    id: "cred-" + Date.now(),
    did,
    name,
    role,
    issuer: "GEC Authority (Demo)",
    issuedAt: new Date().toISOString(),
    expiration: "2026-01-01T00:00:00Z",
    signature: "demo-signature-123"
  };
}

async function handleLoginSubmit() {
  const nameInput = document.getElementById("login-name");
  const roleInput = document.getElementById("login-role");
  const didInput = document.getElementById("login-did");

  const name = (nameInput?.value || "").trim();
  const role = roleInput?.value || "";
  const did = (didInput?.value || "").trim();

  console.log("Login attempt with:", { name, role, did });
  _setLoginError("");

  // Required fields
  if (!name || !did || !role) {
    _setLoginError("Please fill in DID, holder name, and select a role.");
    return;
  }

  // Name: letters + spaces only
  const nameOk = /^[A-Za-z\s]+$/.test(name);
  if (!nameOk) {
    _setLoginError("Name must contain letters and spaces only.");
    return;
  }

  // DID: your original rule was numbers only
  // (If later you want a real DID like did:example:123, tell me and I'll update this)
  const didOk = /^\d+$/.test(did);
  if (!didOk) {
    _setLoginError("DID must contain numbers only.");
    return;
  }

  if (role === "") {
    _setLoginError("Please select a role in the registry.");
    return;
  }

  const credential = _buildDemoCredential({ did, name, role });
  console.log("Sending credential:", credential);

  try {
    // Prefer the shared helper (adds token header if any)
    // Requires AUTH_SSI_URL and apiPostJson() to be defined (from your earlier file)
    const data = await apiPostJson(AUTH_SSI_URL, { credential });

    if (!data || data.success === false) {
      throw new Error((data && data.error) || "SSI login failed.");
    }

    // Expected response: { success: true, user: {...}, token: "..." }
    state.user = data.user || { id: did, name, role };
    state.token = data.token || null;

    // Persist immediately
    if (typeof saveUser === "function") saveUser();

    if (typeof pushSystemMessage === "function") {
      pushSystemMessage(
        "✅ Logged in as " +
          (state.user.name || state.user.id) +
          " (" +
          (state.user.role || "unknown") +
          "). New certificates will use your DID as owner."
      );
    }

    closeLoginModal();
    if (typeof renderAll === "function") renderAll();
  } catch (e) {
    console.error("Login request failed:", e);

    // Demo/offline fallback (your original behavior)
    const fakeUser = { id: did, name, role };
    state.user = fakeUser;
    state.token = "demo-token";

    if (typeof saveUser === "function") saveUser();

    if (typeof pushSystemMessage === "function") {
      pushSystemMessage(
        "Logged in locally as " +
          name +
          " (" +
          role +
          "). Backend SSI endpoint was not reachable (demo mode)."
      );
    }

    closeLoginModal();
    if (typeof renderAll === "function") renderAll();
  }
}

function handleLogout() {
  openLogoutModal();
}

function openLogoutModal() {
  const screen = document.getElementById("logout-screen");
  if (screen) screen.style.display = "flex";
}

function closeLogoutModal() {
  const screen = document.getElementById("logout-screen");
  if (screen) screen.style.display = "none";
}

function performLogout() {
  state.user = null;
  state.token = null;

  // Clear both current + legacy keys used elsewhere in this project
  try {
    if (typeof USER_KEY === "string") localStorage.removeItem(USER_KEY);
    if (typeof TOKEN_KEY === "string") localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("energycert_user");
    localStorage.removeItem("energycert_registered_users");
  } catch (e) {
    console.warn("Failed to clear auth storage:", e);
  }

  if (typeof saveUser === "function") saveUser();

  // Go back to landing page after logout
  window.location.href = "landing.html";
}

function bindLogoutModalEvents() {
  const confirmBtn = document.getElementById("logout-confirm");
  const cancelBtn = document.getElementById("logout-cancel");
  const screen = document.getElementById("logout-screen");

  if (confirmBtn && confirmBtn.dataset.bound !== "1") {
    confirmBtn.dataset.bound = "1";
    confirmBtn.addEventListener("click", performLogout);
  }

  if (cancelBtn && cancelBtn.dataset.bound !== "1") {
    cancelBtn.dataset.bound = "1";
    cancelBtn.addEventListener("click", closeLogoutModal);
  }

  if (screen && screen.dataset.bound !== "1") {
    screen.dataset.bound = "1";
    screen.addEventListener("click", (e) => {
      if (e.target === screen) closeLogoutModal();
    });
  }
}

document.addEventListener("DOMContentLoaded", bindLogoutModalEvents);