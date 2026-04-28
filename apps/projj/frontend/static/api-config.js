// api-config.js
// Shared frontend endpoint resolution for chat + auth pages.

(function initApiConfig() {
  function normalizeHost(host) {
    const value = String(host || "").trim();
    if (!value || value === "::" || value === "[::]" || value === "0.0.0.0") {
      return "127.0.0.1";
    }
    return value;
  }

  function inferApiOrigin() {
    const isHttp = window.location.protocol === "http:" || window.location.protocol === "https:";
    const host = normalizeHost(isHttp && window.location.hostname ? window.location.hostname : "127.0.0.1");
    return `http://${host}:3000`;
  }

  const origin = inferApiOrigin();

  window.ECB_API = Object.freeze({
    ORIGIN: origin,
    CHAT_URL: `${origin}/api/chat`,
    AUTH_BASE: `${origin}/api/auth`,
    AUTH_ME_URL: `${origin}/api/auth/me`,
    AUTH_SSI_URL: `${origin}/api/auth/ssi-login`,
  });
})();
