const API_BASE = window.ECB_API?.AUTH_BASE || "http://127.0.0.1:3000/api/auth";
const USER_KEY = "ecb-user";
const TOKEN_KEY = "ecb-token";
const DEVICE_KEY = "ecb-device-token";
const OTP_CONTEXT_KEY = "ecb-otp-context";

function readOtpContext() {
  try {
    const raw = sessionStorage.getItem(OTP_CONTEXT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearOtpContext() {
  try {
    sessionStorage.removeItem(OTP_CONTEXT_KEY);
  } catch (e) {}
}

function saveSession(token, user) {
  if (!token || !user) return;
  const record = {
    id: user.email,
    name: ((user.firstName || "") + " " + (user.lastName || "")).trim() || user.email,
    email: user.email,
    did: null,
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

document.addEventListener("DOMContentLoaded", function () {
  const context = readOtpContext();

  const banner = document.getElementById("otp-banner");
  const form = document.getElementById("otp-form");
  const submitBtn = document.getElementById("otp-submit");
  const resendBtn = document.getElementById("otp-resend");
  const cancelBtn = document.getElementById("otp-cancel");
  const emailValue = document.getElementById("otp-email");
  const purposeValue = document.getElementById("otp-purpose");
  const hiddenCode = document.getElementById("otp-code");
  const digitInputs = Array.from(document.querySelectorAll("[data-otp-digit]"));

  function showBanner(type, message) {
    if (!banner) return;
    banner.className = "auth-banner auth-banner--" + type;
    banner.textContent = message;
    banner.hidden = false;
  }

  function hideBanner() {
    if (banner) banner.hidden = true;
  }

  function getCode() {
    return digitInputs.map(function (input) {
      return (input.value || "").trim();
    }).join("");
  }

  function syncCode() {
    const code = getCode();
    if (hiddenCode) hiddenCode.value = code;
    return code;
  }

  function focusDigit(index) {
    const input = digitInputs[index];
    if (!input) return;
    input.focus();
    input.select();
  }

  if (!context || !context.email || !context.purpose) {
    showBanner("error", "Verification context is missing. Please start again from sign in or registration.");
    if (submitBtn) submitBtn.disabled = true;
    if (resendBtn) resendBtn.disabled = true;
    if (cancelBtn) {
      cancelBtn.textContent = "Back to sign in";
      cancelBtn.href = "login.html";
    }
    return;
  }

  if (emailValue) emailValue.textContent = context.email;
  if (purposeValue) {
    purposeValue.textContent = context.source === "register"
      ? "Enter the code to activate your new account."
      : "Enter the code to approve this sign-in.";
  }
  if (cancelBtn && context.cancelRedirect) cancelBtn.href = context.cancelRedirect;

  digitInputs.forEach(function (input, index) {
    input.addEventListener("input", function () {
      input.value = (input.value || "").replace(/\D/g, "").slice(0, 1);
      syncCode();
      hideBanner();
      if (input.value && index < digitInputs.length - 1) {
        focusDigit(index + 1);
      }
    });

    input.addEventListener("keydown", function (event) {
      if (event.key === "Backspace" && !input.value && index > 0) {
        focusDigit(index - 1);
      }
      if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        focusDigit(index - 1);
      }
      if (event.key === "ArrowRight" && index < digitInputs.length - 1) {
        event.preventDefault();
        focusDigit(index + 1);
      }
    });

    input.addEventListener("paste", function (event) {
      const pasted = (event.clipboardData || window.clipboardData).getData("text");
      const digits = String(pasted || "").replace(/\D/g, "").slice(0, digitInputs.length).split("");
      if (digits.length === 0) return;
      event.preventDefault();
      digitInputs.forEach(function (field, idx) {
        field.value = digits[idx] || "";
      });
      syncCode();
      focusDigit(Math.min(digits.length, digitInputs.length) - 1);
    });
  });

  if (resendBtn) {
    resendBtn.addEventListener("click", async function () {
      resendBtn.disabled = true;
      hideBanner();
      try {
        const res = await fetch(`${API_BASE}/resend-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: context.email, purpose: context.purpose }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to resend verification code.");
        }
        showBanner("success", "A fresh verification code has been sent.");
        digitInputs.forEach(function (field) { field.value = ""; });
        syncCode();
        focusDigit(0);
      } catch (err) {
        showBanner("error", err.message || "Unable to resend the verification code.");
      } finally {
        resendBtn.disabled = false;
      }
    });
  }

  if (form) {
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const code = syncCode();

      if (!/^\d{6}$/.test(code)) {
        showBanner("error", "Enter the full 6-digit code.");
        focusDigit(0);
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add("is-loading");
      }
      hideBanner();

      try {
        const verifyRes = await fetch(`${API_BASE}/verify-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: context.email,
            code,
            purpose: context.purpose,
          }),
        });
        const verifyData = await verifyRes.json();

        if (!verifyRes.ok || !verifyData.success) {
          throw new Error(verifyData.error || "Verification failed.");
        }

        if (!verifyData.token || !verifyData.user) {
          throw new Error("Verification completed, but no session was returned.");
        }

        saveSession(verifyData.token, verifyData.user);
        saveDeviceToken(verifyData.deviceToken);
        clearOtpContext();
        showBanner("success", "Verification complete. Redirecting...");
        setTimeout(function () {
          window.location.href = context.successRedirect || "index.html";
        }, 700);
      } catch (err) {
        showBanner("error", err.message || "Unable to verify the code.");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.classList.remove("is-loading");
        }
      }
    });
  }

  focusDigit(0);
});
