const crypto = require("crypto");
const { Resolver } = require("did-resolver");
const { decodeJWT } = require("did-jwt");

function toBase64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  return Buffer.from(normalized + "=".repeat(padding), "base64");
}

function normalizeDidMethod(did) {
  const match = String(did || "").match(/^did:([^:]+):/i);
  return match ? match[1].toLowerCase() : "unknown";
}

function deriveDidFromPublicKeyPem(publicKeyPem) {
  const der = crypto.createPublicKey(publicKeyPem).export({ format: "der", type: "spki" });
  const digest = crypto.createHash("sha256").update(der).digest();
  return `did:gec:${toBase64Url(digest)}`;
}

function buildDidDocument(publicKeyPem, options = {}) {
  const did = options.did || deriveDidFromPublicKeyPem(publicKeyPem);
  const walletLabel = options.walletLabel || "GEC SSI Wallet";
  const verificationMethodId = `${did}#key-1`;

  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/suites/ed25519-2020/v1",
    ],
    id: did,
    controller: did,
    walletLabel,
    verificationMethod: [
      {
        id: verificationMethodId,
        type: "Ed25519VerificationKey2020",
        controller: did,
        publicKeyPem,
      },
    ],
    authentication: [verificationMethodId],
    assertionMethod: [verificationMethodId],
  };
}

function extractPublicKeyPem(didDocument) {
  const method = didDocument?.verificationMethod?.[0];
  if (!method?.publicKeyPem) {
    throw new Error("DID document is missing verificationMethod[0].publicKeyPem");
  }
  return method.publicKeyPem;
}

function buildDidResolver(didDocuments = {}) {
  return new Resolver({
    gec: async (did) => {
      const didDocument = didDocuments[did] || null;
      if (!didDocument) {
        return {
          didResolutionMetadata: { error: "notFound" },
          didDocument: null,
          didDocumentMetadata: {},
        };
      }
      return {
        didResolutionMetadata: { contentType: "application/did+ld+json" },
        didDocument,
        didDocumentMetadata: {},
      };
    },
  });
}

async function resolveDidDocument({ did, didDocument, didDocuments = {} }) {
  if (didDocument?.id === did) {
    return didDocument;
  }

  const resolver = buildDidResolver({
    ...didDocuments,
    ...(did && didDocument ? { [did]: didDocument } : {}),
  });
  const resolved = await resolver.resolve(did);
  if (!resolved?.didDocument) {
    throw new Error(`Unable to resolve DID document for ${did}`);
  }
  return resolved.didDocument;
}

function createChallengeStatement({ did, challengeId, nonce, origin, issuedAt }) {
  const lines = [
    "EnergyCert Bot SSI Login",
    `DID: ${did}`,
    `Challenge ID: ${challengeId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ];

  if (origin) {
    lines.push(`Origin: ${origin}`);
  }

  lines.push("Purpose: Approve a one-time sign-in request for the GEC platform.");
  return lines.join("\n");
}

function verifyDidSignature({ didDocument, statement, signature }) {
  const publicKeyPem = extractPublicKeyPem(didDocument);
  return crypto.verify(
    null,
    Buffer.from(statement, "utf8"),
    publicKeyPem,
    fromBase64Url(signature)
  );
}

function sanitizeUserForSession(user) {
  return {
    id: user.email || user.did || String(user._id),
    email: user.email || null,
    did: user.did || null,
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.walletLabel || user.did || user.email,
    role: "SSI Wallet",
    authMethods: Array.isArray(user.authMethods) ? user.authMethods : [],
  };
}

function decodeDidJwtToken(token) {
  if (!token || typeof token !== "string") {
    throw new Error("JWT credential token is required.");
  }
  return decodeJWT(token);
}

module.exports = {
  buildDidDocument,
  buildDidResolver,
  createChallengeStatement,
  decodeDidJwtToken,
  deriveDidFromPublicKeyPem,
  extractPublicKeyPem,
  fromBase64Url,
  normalizeDidMethod,
  resolveDidDocument,
  sanitizeUserForSession,
  toBase64Url,
  verifyDidSignature,
};
