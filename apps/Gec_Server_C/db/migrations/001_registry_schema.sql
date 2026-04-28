CREATE TABLE IF NOT EXISTS users (
    did TEXT PRIMARY KEY,
    account_address TEXT NOT NULL,
    display_name TEXT DEFAULT '',
    email TEXT,
    role TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS certificates (
    id TEXT PRIMARY KEY,
    owner_did TEXT NOT NULL,
    owner_account_address TEXT NOT NULL,
    previous_owner_did TEXT,
    previous_owner_account_address TEXT,
    issuer_did TEXT,
    issuer_account_address TEXT,
    device_id TEXT,
    device_name TEXT,
    energy_source TEXT NOT NULL,
    energy_amount REAL NOT NULL,
    prod_start TEXT,
    prod_end TEXT,
    timestamp TEXT,
    location TEXT NOT NULL,
    status TEXT NOT NULL,
    tx_hash TEXT,
    explorer_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cert_owner_did ON certificates(owner_did);
CREATE INDEX IF NOT EXISTS idx_cert_status ON certificates(status);
CREATE INDEX IF NOT EXISTS idx_cert_energy_source ON certificates(energy_source);
CREATE INDEX IF NOT EXISTS idx_cert_timestamp ON certificates(timestamp);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    certificate_id TEXT,
    operation TEXT NOT NULL,
    actor_did TEXT NOT NULL,
    actor_account_address TEXT,
    recipient_did TEXT,
    recipient_account_address TEXT,
    tx_hash TEXT,
    metadata_json TEXT,
    occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_certificate_id ON transactions(certificate_id);
CREATE INDEX IF NOT EXISTS idx_tx_operation ON transactions(operation);
CREATE INDEX IF NOT EXISTS idx_tx_occurred_at ON transactions(occurred_at);

CREATE TABLE IF NOT EXISTS marketplace_listings (
    certificate_id TEXT PRIMARY KEY,
    seller_did TEXT NOT NULL,
    seller_account_address TEXT,
    buyer_did TEXT,
    buyer_account_address TEXT,
    listing_id TEXT,
    price REAL NOT NULL,
    currency TEXT NOT NULL,
    listed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL,
    tx_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_market_status ON marketplace_listings(status);
CREATE INDEX IF NOT EXISTS idx_market_seller_did ON marketplace_listings(seller_did);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_did TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    category TEXT NOT NULL,
    related_certificate_id TEXT,
    related_tx_hash TEXT,
    created_at TEXT NOT NULL,
    read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_did ON notifications(user_did);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
