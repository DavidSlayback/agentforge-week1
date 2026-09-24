-- AgentForge module tables. Idempotent: safe to apply on every deploy.
-- public/api.php answers 503 ledger_not_installed until both tables exist.

-- One row per idempotent write; a repeated request returns response_json.
CREATE TABLE IF NOT EXISTS agentforge_write_ledger (
  idempotency_key VARCHAR(160) NOT NULL PRIMARY KEY,
  operation VARCHAR(32) NOT NULL,
  pid BIGINT NOT NULL,
  content_sha256 CHAR(64) NULL,
  document_id BIGINT NULL,
  procedure_order_id BIGINT NULL,
  response_json TEXT NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  actor_user_id BIGINT NOT NULL,
  issuer VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL,
  KEY pid_sha (pid, content_sha256),
  KEY pid_document (pid, document_id)
) ENGINE=InnoDB;

-- Single-use request nonces (replay protection), pruned by expires_at.
CREATE TABLE IF NOT EXISTS agentforge_request_nonce (
  nonce CHAR(32) NOT NULL PRIMARY KEY,
  expires_at INT UNSIGNED NOT NULL,
  KEY expires_at (expires_at)
) ENGINE=InnoDB;
