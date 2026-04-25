const API_BASE = "http://localhost:3000/api/auth";
const USER_KEY = "ecb-user";
const TOKEN_KEY = "ecb-token";
const DEVICE_KEY = "ecb-device-token";
const OTP_CONTEXT_KEY = "ecb-otp-context";

document.addEventListener("DOMContentLoaded", function () {
  const registerForm = document.getElementById("register-form");
  if (registerForm) {
    registerForm.addEventListener("submit", handleRegisterSubmit);
  }
});

function setRegisterError(msg) {
  const errorEl = document.getElementById("register-error");
  if (!errorEl) return;
  errorEl.textContent = msg || "";
  errorEl.hidden = !msg;
}

function setRegisterSuccess(msg) {
  const successEl = document.getElementById("register-success");
  if (!successEl) return;
  successEl.textContent = msg || "";
  successEl.hidden = !msg;
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
  setRegisterSuccess("A new verification code has been sent to your email.");
}

function storeOtpContext(context) {
  try {
    sessionStorage.setItem(OTP_CONTEXT_KEY, JSON.stringify(context));
  } catch (e) {}
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  const firstName = (document.getElementById("register-first-name")?.value || "").trim();
  const lastName = (document.getElementById("register-last-name")?.value || "").trim();
  const email = (document.getElementById("register-email")?.value || "").trim().toLowerCase();
  const password = document.getElementById("register-password")?.value || "";
  const confirmPassword = document.getElementById("register-confirm-password")?.value || "";

  setRegisterError("");
  setRegisterSuccess("");

  if (!firstName || !lastName || !email || !password || !confirmPassword) {
    setRegisterError("Please fill in all fields.");
    return;
  }

  const nameOk =
    /^[A-Za-z\s]+$/.test(firstName) &&
    /^[A-Za-z\s]+$/.test(lastName);

  if (!nameOk) {
    setRegisterError("First name and last name must contain letters only.");
    return;
  }

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailOk) {
    setRegisterError("Please enter a valid email address.");
    return;
  }

  if (password.length < 8) {
    setRegisterError("Password must be at least 8 characters long.");
    return;
  }

  if (password !== confirmPassword) {
    setRegisterError("Passwords do not match.");
    return;
  }

  const submitBtn = document.getElementById("register-submit");
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName, lastName, email, password, confirmPassword }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      setRegisterError(data.error || "Registration failed. Please try again.");
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    if (data.nextStep === "verify-otp") {
      setRegisterSuccess(data.message || "Verification code sent. Check your email.");
      storeOtpContext({
        email: data.email,
        purpose: data.purpose,
        source: "register",
        successRedirect: "index.html",
        cancelRedirect: "register.html",
      });
      setTimeout(function () {
        window.location.href = "otp.html";
      }, 350);
      return;
    }

    setRegisterSuccess("Registration successful. Redirecting to login\u2026");

    setTimeout(function () {
      window.location.href = "login.html";
    }, 1200);
  } catch (err) {
    console.error("Register error:", err);
    if (err && err.message && err.message !== "Failed to fetch") {
      setRegisterError(err.message);
      return;
    }
    setRegisterError("Unable to reach the server. Is the backend running on port 3000?");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}
