const API_BASE = "http://localhost:3000/api/auth";

document.addEventListener("DOMContentLoaded", function () {
  const registerBtn = document.getElementById("register-submit");
  if (registerBtn) {
    registerBtn.addEventListener("click", handleRegisterSubmit);
  }
});

function setRegisterError(msg) {
  const errorEl = document.getElementById("register-error");
  if (errorEl) errorEl.textContent = msg || "";
}

function setRegisterSuccess(msg) {
  const successEl = document.getElementById("register-success");
  if (successEl) successEl.textContent = msg || "";
}

async function handleRegisterSubmit() {
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

    setRegisterSuccess("Registration successful. Redirecting to login\u2026");

    setTimeout(function () {
      window.location.href = "login.html";
    }, 1200);
  } catch (err) {
    console.error("Register error:", err);
    setRegisterError("Unable to reach the server. Is the backend running on port 3000?");
    if (submitBtn) submitBtn.disabled = false;
  }
}