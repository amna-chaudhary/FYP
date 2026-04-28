(function () {
  "use strict";

  const API_BASE     = window.ECB_API?.AUTH_BASE || "http://127.0.0.1:3000/api/auth";
  const USER_KEY     = "ecb-user";
  const TOKEN_KEY    = "ecb-token";
  const DEVICE_KEY   = "ecb-device-token";
  const OTP_CONTEXT_KEY = "ecb-otp-context";

  const form      = document.getElementById("login-form");
  const banner    = document.getElementById("auth-banner");
  const submitBtn = document.getElementById("auth-submit");
  const idField   = document.getElementById("login-identifier");
  const passField = document.getElementById("login-password");

  document.querySelectorAll(".auth-pass-toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const id = btn.getAttribute("data-pass-toggle");
      const input = document.getElementById(id);
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.classList.toggle("is-showing", show);
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });

  function saveSession(token, user) {
    const record = {
      id:    user.email,
      name:  ((user.firstName || "") + " " + (user.lastName || "")).trim() || user.email,
      email: user.email,
      did:   null,
      loggedInAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(record));
    } catch (e) {}
  }

  function saveDeviceToken(deviceToken) {
    if (!deviceToken) return;
    try {
      localStorage.setItem(DEVICE_KEY, deviceToken);
    } catch (e) {}
  }

  function readDeviceToken() {
    try {
      return localStorage.getItem(DEVICE_KEY);
    } catch (e) {
      return null;
    }
  }

  function storeOtpContext(context) {
    try {
      sessionStorage.setItem(OTP_CONTEXT_KEY, JSON.stringify(context));
    } catch (e) {}
  }

  async function resendOtp(email, purpose) {
    const res = await fetch(`${API_BASE}/resend-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, purpose }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed to resend verification code.");
    }
    showBanner("success", "A new verification code has been sent to your email.");
  }

  function showBanner(type, message) {
    if (!banner) return;
    banner.className = "auth-banner auth-banner--" + type;
    banner.textContent = message;
    banner.hidden = false;
  }
  function hideBanner() { if (banner) banner.hidden = true; }

  function setFieldValid(field, valid) {
    const wrap = field.closest(".auth-field");
    if (!wrap) return;
    wrap.classList.toggle("is-valid",   !!valid && field.value.trim().length > 0);
    wrap.classList.toggle("is-invalid", valid === false);
  }

  idField.addEventListener("blur", function () {
    if (idField.value.trim().length > 0) setFieldValid(idField, true);
  });
  passField.addEventListener("blur", function () {
    if (passField.value.length > 0) setFieldValid(passField, true);
  });
  idField.addEventListener("input",  () => setFieldValid(idField, null));
  passField.addEventListener("input", () => setFieldValid(passField, null));

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    hideBanner();

    const identifier = idField.value.trim();
    const password   = passField.value;

    if (!identifier) {
      setFieldValid(idField, false);
      showBanner("error", "Please enter your email.");
      idField.focus();
      return;
    }
    if (!password) {
      setFieldValid(passField, false);
      showBanner("error", "Please enter your password.");
      passField.focus();
      return;
    }

    submitBtn.classList.add("is-loading");
    submitBtn.disabled = true;

    try {
      const deviceToken = readDeviceToken();
      const res = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: identifier.toLowerCase(),
          password,
          deviceToken,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Invalid credentials.");
      }

      let finalData = data;
      if (data.nextStep === "verify-otp") {
        showBanner("success", data.message || "Verification required. Check your email for the code.");
        storeOtpContext({
          email: data.email,
          purpose: data.purpose,
          source: "login",
          successRedirect: "chat.html",
          cancelRedirect: "index.html",
        });
        setTimeout(function () {
          window.location.href = "otp.html";
        }, 350);
        return;
      }

      if (!finalData.token || !finalData.user) {
        throw new Error("Login did not return a valid session.");
      }

      saveSession(finalData.token, finalData.user);
      saveDeviceToken(finalData.deviceToken);

      showBanner("success", "Signed in. Redirecting\u2026");
      form.classList.add("is-success");
      setTimeout(function () { window.location.href = "chat.html"; }, 650);

    } catch (err) {
      submitBtn.classList.remove("is-loading");
      submitBtn.disabled = false;
      const msg = err.message === "Failed to fetch"
        ? "Unable to reach the server. Is the backend running on port 3000?"
        : (err.message || "Unable to sign in.");
      showBanner("error", msg);
      setFieldValid(passField, false);
      passField.focus();
      passField.select();
    }
  });

  window.handleLogout = window.handleLogout || function () {
    try {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(DEVICE_KEY);
    } catch (e) {}
    window.location.href = "index.html";
  };
})();
