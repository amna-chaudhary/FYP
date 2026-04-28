(function () {
  "use strict";

  const API_BASE = window.ECB_API?.AUTH_BASE || "http://127.0.0.1:3000/api/auth";
  const TOKEN_KEY = "ecb-token";
  const USER_KEY = "ecb-user";
  const WALLET_KEY = "ecb-ssi-wallet";

  const displayNameInput = document.getElementById("ssi-display-name");
  const walletMeta = document.getElementById("ssi-wallet-meta");
  const statusEl = document.getElementById("ssi-status");
  const challengeEl = document.getElementById("ssi-challenge");
  const qrImage = document.getElementById("ssi-qr-image");
  const challengeText = document.getElementById("ssi-challenge-text");
  const generateBtn = document.getElementById("ssi-generate-wallet");
  const startBtn = document.getElementById("ssi-start-login");
  const approveBtn = document.getElementById("ssi-approve-login");

  const state = {
    wallet: null,
    challenge: null,
  };

  function setStatus(kind, message) {
    if (!statusEl) return;
    statusEl.className = "ssi-status" + (kind ? ` is-${kind}` : "");
    statusEl.textContent = message || "";
  }

  function toBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function fromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function toBase64Url(buffer) {
    return toBase64(buffer).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function arrayBufferToPem(buffer, label) {
    const base64 = toBase64(buffer);
    const lines = base64.match(/.{1,64}/g) || [];
    return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
  }

  async function deriveDidFromSpki(spkiBuffer) {
    const digest = await crypto.subtle.digest("SHA-256", spkiBuffer);
    return `did:gec:${toBase64Url(digest)}`;
  }

  async function createWallet(displayName) {
    const name = (displayName || "SSI Wallet User").trim();
    const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const did = await deriveDidFromSpki(spki);
    const publicKeyPem = arrayBufferToPem(spki, "PUBLIC KEY");
    const didDocument = {
      "@context": [
        "https://www.w3.org/ns/did/v1",
        "https://w3id.org/security/suites/ed25519-2020/v1",
      ],
      id: did,
      controller: did,
      walletLabel: "Browser SSI Wallet",
      verificationMethod: [
        {
          id: `${did}#key-1`,
          type: "Ed25519VerificationKey2020",
          controller: did,
          publicKeyPem,
        },
      ],
      authentication: [`${did}#key-1`],
      assertionMethod: [`${did}#key-1`],
    };

    return {
      did,
      displayName: name,
      walletLabel: "Browser SSI Wallet",
      publicKeySpki: toBase64(spki),
      privateKeyPkcs8: toBase64(pkcs8),
      didDocument,
      createdAt: new Date().toISOString(),
    };
  }

  function saveWallet(wallet) {
    state.wallet = wallet;
    localStorage.setItem(WALLET_KEY, JSON.stringify(wallet));
    renderWallet();
  }

  function loadWallet() {
    try {
      const raw = localStorage.getItem(WALLET_KEY);
      if (!raw) return;
      state.wallet = JSON.parse(raw);
    } catch (err) {
      console.warn("Failed to load SSI wallet:", err);
    }
  }

  function saveSession(token, user) {
    const record = {
      id: user.did || user.email || user.id,
      name: user.name || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.did,
      email: user.email || null,
      did: user.did || null,
      loggedInAt: new Date().toISOString(),
      role: user.role || "SSI Wallet",
    };
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(record));
  }

  function renderWallet() {
    if (!walletMeta) return;
    if (!state.wallet) {
      walletMeta.hidden = true;
      approveBtn.disabled = true;
      return;
    }

    walletMeta.hidden = false;
    walletMeta.innerHTML = [
      `<div><strong>Holder:</strong> ${state.wallet.displayName}</div>`,
      `<div><strong>DID:</strong> ${state.wallet.did}</div>`,
      `<div><strong>Wallet:</strong> ${state.wallet.walletLabel}</div>`,
    ].join("");
    if (displayNameInput && !displayNameInput.value.trim()) {
      displayNameInput.value = state.wallet.displayName || "";
    }
    approveBtn.disabled = !state.challenge;
  }

  function renderChallenge(challenge) {
    state.challenge = challenge;
    approveBtn.disabled = !challenge || !state.wallet;
    if (!challengeEl || !challengeText || !qrImage) return;

    if (!challenge) {
      challengeEl.classList.remove("is-visible");
      qrImage.hidden = true;
      qrImage.removeAttribute("src");
      challengeText.value = "";
      return;
    }

    challengeEl.classList.add("is-visible");
    challengeText.value = challenge.statement;
    if (challenge.qrDataUrl) {
      qrImage.src = challenge.qrDataUrl;
      qrImage.hidden = false;
    } else {
      qrImage.hidden = true;
    }
  }

  async function registerWallet(wallet) {
    const res = await fetch(`${API_BASE}/ssi/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        did: wallet.did,
        didDocument: wallet.didDocument,
        displayName: wallet.displayName,
        walletLabel: wallet.walletLabel,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed to register wallet.");
    }
    return data;
  }

  async function ensureWallet() {
    if (state.wallet) return state.wallet;
    const displayName = (displayNameInput?.value || "").trim();
    if (!displayName) {
      throw new Error("Enter the wallet holder name first.");
    }
    const wallet = await createWallet(displayName);
    await registerWallet(wallet);
    saveWallet(wallet);
    return wallet;
  }

  async function importPrivateKey(base64Pkcs8) {
    return crypto.subtle.importKey(
      "pkcs8",
      fromBase64(base64Pkcs8),
      { name: "Ed25519" },
      false,
      ["sign"]
    );
  }

  async function signStatement(statement) {
    if (!state.wallet?.privateKeyPkcs8) {
      throw new Error("No wallet key available.");
    }
    const privateKey = await importPrivateKey(state.wallet.privateKeyPkcs8);
    const signature = await crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      new TextEncoder().encode(statement)
    );
    return toBase64Url(signature);
  }

  async function generateChallenge() {
    const wallet = await ensureWallet();
    const res = await fetch(`${API_BASE}/ssi-login/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        did: wallet.did,
        didDocument: wallet.didDocument,
        displayName: wallet.displayName,
        walletLabel: wallet.walletLabel,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success || !data.challenge) {
      throw new Error(data.error || "Failed to create SSI challenge.");
    }
    renderChallenge(data.challenge);
    setStatus("success", "SSI challenge created. Scan the QR or approve in this browser.");
  }

  async function approveChallenge() {
    if (!state.wallet || !state.challenge) {
      throw new Error("Create a wallet and generate a challenge first.");
    }

    const signature = await signStatement(state.challenge.statement);
    const res = await fetch(`${API_BASE}/ssi-login/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: state.challenge.challengeId,
        did: state.wallet.did,
        signature,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success || !data.token || !data.user) {
      throw new Error(data.error || "SSI approval failed.");
    }

    saveSession(data.token, data.user);
    setStatus("success", "SSI login approved. Redirecting...");
    setTimeout(function () {
      window.location.href = "chat.html";
    }, 500);
  }

  async function onGenerateWallet() {
    try {
      setStatus("", "");
      const wallet = await ensureWallet();
      setStatus("success", `Wallet ready for ${wallet.displayName}.`);
    } catch (err) {
      setStatus("error", err.message || "Failed to create wallet.");
    }
  }

  async function onGenerateChallenge() {
    try {
      setStatus("", "");
      await generateChallenge();
    } catch (err) {
      setStatus("error", err.message || "Failed to generate challenge.");
    }
  }

  async function onApproveChallenge() {
    try {
      approveBtn.disabled = true;
      await approveChallenge();
    } catch (err) {
      approveBtn.disabled = false;
      setStatus("error", err.message || "Failed to approve SSI challenge.");
    }
  }

  function boot() {
    if (!window.crypto?.subtle) {
      setStatus("error", "This browser does not support WebCrypto Ed25519 for SSI login.");
      if (generateBtn) generateBtn.disabled = true;
      if (startBtn) startBtn.disabled = true;
      if (approveBtn) approveBtn.disabled = true;
      return;
    }

    loadWallet();
    renderWallet();
    renderChallenge(null);

    if (generateBtn) generateBtn.addEventListener("click", onGenerateWallet);
    if (startBtn) startBtn.addEventListener("click", onGenerateChallenge);
    if (approveBtn) approveBtn.addEventListener("click", onApproveChallenge);
  }

  boot();
})();
