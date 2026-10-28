ALTER TABLE oidc_transactions ADD COLUMN return_to TEXT;

CREATE TABLE oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (organization_id, user_id)
    REFERENCES access_requests(organization_id, user_id) ON DELETE CASCADE
);

CREATE TABLE oauth_tokens (
  id TEXT PRIMARY KEY,
  access_token_hash TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by TEXT,
  FOREIGN KEY (organization_id, user_id)
    REFERENCES access_requests(organization_id, user_id) ON DELETE CASCADE
);

CREATE INDEX oauth_tokens_user_idx
  ON oauth_tokens(organization_id, user_id, created_at DESC);
CREATE INDEX oauth_tokens_active_access_idx
  ON oauth_tokens(access_token_hash, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX oauth_tokens_active_refresh_idx
  ON oauth_tokens(refresh_token_hash, refresh_expires_at) WHERE revoked_at IS NULL;

CREATE TABLE mcp_rate_limit_events (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (organization_id, id)
);

CREATE INDEX mcp_rate_limit_events_window_idx
  ON mcp_rate_limit_events(organization_id, user_id, created_at DESC);
