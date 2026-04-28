const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const requireAuth = require("../middleware/requireAuth");
const router = require("../routes/auth");
const User = require("../models/User");
const SsiChallenge = require("../models/SsiChallenge");
const {
  buildDidDocument,
  deriveDidFromPublicKeyPem,
  verifyDidSignature,
} = require("../utils/ssi");

function makeRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

function getRouteHandler(method, path) {
  const layer = router.stack.find((entry) => entry.route && entry.route.path === path && entry.route.methods[method]);
  assert.ok(layer, `Missing route ${method.toUpperCase()} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function callRoute(method, path, { body = {}, params = {}, headers = {} } = {}) {
  const handler = getRouteHandler(method, path);
  const req = {
    body,
    params,
    headers,
    protocol: "http",
    get(name) {
      const key = String(name || "").toLowerCase();
      if (key === "origin") return headers.origin || null;
      if (key === "host") return headers.host || "localhost:3000";
      return headers[key] || null;
    },
  };
  const res = makeRes();
  await handler(req, res);
  return res;
}

const originalUserFindOne = User.findOne;
const originalUserCreate = User.create;
const originalSsiFindOne = SsiChallenge.findOne;
const originalSsiCreate = SsiChallenge.create;
const originalSsiDeleteMany = SsiChallenge.deleteMany;

function restoreModelStubs() {
  User.findOne = originalUserFindOne;
  User.create = originalUserCreate;
  SsiChallenge.findOne = originalSsiFindOne;
  SsiChallenge.create = originalSsiCreate;
  SsiChallenge.deleteMany = originalSsiDeleteMany;
}

test.afterEach(() => {
  restoreModelStubs();
});

test("buildDidDocument derives a stable did:gec identifier", () => {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });

  const did = deriveDidFromPublicKeyPem(publicKeyPem);
  const doc = buildDidDocument(publicKeyPem);

  assert.match(did, /^did:gec:/);
  assert.equal(doc.id, did);
  assert.equal(doc.verificationMethod[0].publicKeyPem, publicKeyPem);
});

test("verifyDidSignature accepts a valid ed25519 signature", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
  const didDocument = buildDidDocument(publicKeyPem);
  const statement = "EnergyCert Bot SSI Login\nNonce: abc123";
  const signature = crypto.sign(null, Buffer.from(statement, "utf8"), privateKey)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  assert.equal(
    verifyDidSignature({ didDocument, statement, signature }),
    true
  );
  assert.equal(
    verifyDidSignature({ didDocument, statement: `${statement}\nTampered`, signature }),
    false
  );
});

test("requireAuth accepts a valid JWT and decorates the request", () => {
  process.env.JWT_SECRET = "test-secret";
  const token = jwt.sign(
    { sub: "user-123", email: "ssi@example.com" },
    process.env.JWT_SECRET,
    { expiresIn: "5m" }
  );

  const req = {
    headers: {
      authorization: `Bearer ${token}`,
    },
  };
  const res = {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };

  let nextCalled = false;
  requireAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.userId, "user-123");
  assert.equal(req.userEmail, "ssi@example.com");
});

test("requireAuth rejects an expired JWT", () => {
  process.env.JWT_SECRET = "test-secret";
  const token = jwt.sign(
    { sub: "user-123", email: "ssi@example.com" },
    process.env.JWT_SECRET,
    { expiresIn: -1 }
  );

  const req = {
    headers: {
      authorization: `Bearer ${token}`,
    },
  };
  const res = {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };

  requireAuth(req, res, () => {});

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, {
    success: false,
    error: "Invalid or expired token",
  });
});

test("ssi wallet register rejects a mismatched did document", async () => {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
  const didDocument = buildDidDocument(publicKeyPem, { did: "did:gec:wrong" });

  const res = await callRoute("post", "/ssi/wallet/register", {
    body: {
      did: "did:gec:expected",
      didDocument,
      displayName: "Alice",
    },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.success, false);
  assert.match(res.payload.error, /does not match/i);
});

test("ssi login challenge creates a pending challenge with qr payload", async () => {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
  const didDocument = buildDidDocument(publicKeyPem);
  const createdChallenges = [];

  User.findOne = async () => null;
  User.create = async (payload) => ({ _id: "user-1", ...payload });
  SsiChallenge.deleteMany = async () => ({ acknowledged: true });
  SsiChallenge.create = async (payload) => {
    createdChallenges.push(payload);
    return payload;
  };

  const res = await callRoute("post", "/ssi-login/challenge", {
    body: {
      did: didDocument.id,
      didDocument,
      displayName: "Alice",
      walletLabel: "Browser Wallet",
    },
    headers: {
      origin: "http://localhost:8080",
      host: "localhost:3000",
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.success, true);
  assert.equal(createdChallenges.length, 1);
  assert.equal(createdChallenges[0].did, didDocument.id);
  assert.match(res.payload.challenge.approvalUrl, /frontend\/index\.html\?ssiChallenge=/);
  assert.equal(typeof res.payload.challenge.qrText, "string");
});

test("ssi login verify rejects invalid signatures", async () => {
  process.env.JWT_SECRET = "test-secret";
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const otherKeyPair = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
  const didDocument = buildDidDocument(publicKeyPem);
  const statement = "EnergyCert Bot SSI Login\nNonce: abc123";
  const invalidSignature = crypto.sign(null, Buffer.from(statement, "utf8"), otherKeyPair.privateKey)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  User.findOne = async () => ({
    _id: "user-1",
    did: didDocument.id,
    didDocument,
    authMethods: ["ssi"],
  });
  SsiChallenge.findOne = async () => ({
    challengeId: "challenge-1",
    did: didDocument.id,
    statement,
    status: "pending",
    expiresAt: new Date(Date.now() + 60_000),
    save: async function save() {
      return this;
    },
  });

  const res = await callRoute("post", "/ssi-login/verify", {
    body: {
      challengeId: "challenge-1",
      did: didDocument.id,
      signature: invalidSignature,
    },
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.success, false);
  assert.match(res.payload.error, /invalid did signature/i);
});

test("ssi login verify expires stale pending challenges", async () => {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
  const didDocument = buildDidDocument(publicKeyPem);
  const challenge = {
    challengeId: "challenge-expired",
    did: didDocument.id,
    statement: "EnergyCert Bot SSI Login\nNonce: abc123",
    status: "pending",
    expiresAt: new Date(Date.now() - 60_000),
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    },
  };

  SsiChallenge.findOne = async () => challenge;

  const res = await callRoute("post", "/ssi-login/verify", {
    body: {
      challengeId: "challenge-expired",
      did: didDocument.id,
      signature: "bogus",
    },
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /expired/i);
  assert.equal(challenge.status, "expired");
  assert.equal(challenge.saveCalls, 1);
});

test("ssi login verify succeeds with a valid signature and returns a token", async () => {
  process.env.JWT_SECRET = "test-secret";
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
  const didDocument = buildDidDocument(publicKeyPem);
  const statement = "EnergyCert Bot SSI Login\nNonce: abc123";
  const signature = crypto.sign(null, Buffer.from(statement, "utf8"), privateKey)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  const user = {
    _id: "user-1",
    did: didDocument.id,
    didDocument,
    firstName: "Alice",
    lastName: "Khan",
    authMethods: ["ssi"],
  };
  const challenge = {
    challengeId: "challenge-ok",
    did: didDocument.id,
    statement,
    status: "pending",
    expiresAt: new Date(Date.now() + 60_000),
    verifiedAt: null,
    sessionToken: null,
    async save() {
      return this;
    },
  };

  User.findOne = async () => user;
  SsiChallenge.findOne = async () => challenge;

  const res = await callRoute("post", "/ssi-login/verify", {
    body: {
      challengeId: "challenge-ok",
      did: didDocument.id,
      signature,
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.success, true);
  assert.equal(typeof res.payload.token, "string");
  assert.equal(challenge.status, "verified");
  assert.equal(typeof challenge.sessionToken, "string");
  assert.equal(res.payload.user.did, didDocument.id);
});
