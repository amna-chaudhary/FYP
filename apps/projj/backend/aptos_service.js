async function mintCertificateOnChain() {
  return {
    cert_id: "demo-cert-id",
    tx_hash: "demo-tx-hash"
  };
}

async function logAuditOnChain() {
  return { ok: true };
}

module.exports = {
  mintCertificateOnChain,
  logAuditOnChain
};