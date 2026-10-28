CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_signed_in_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users(LOWER(email));

CREATE TABLE IF NOT EXISTS access_requests (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  requested_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  decided_by TEXT REFERENCES users(id),
  decision_reason TEXT,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS roles (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  organization_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY (organization_id, role_id, permission),
  FOREIGN KEY (organization_id, role_id)
    REFERENCES roles(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_roles (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL,
  granted_by TEXT REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (organization_id, user_id, role_id),
  FOREIGN KEY (organization_id, role_id)
    REFERENCES roles(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_permission_grants (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  granted BOOLEAN NOT NULL,
  changed_by TEXT REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (organization_id, user_id, permission)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address TEXT
);

CREATE TABLE IF NOT EXISTS oidc_transactions (
  state_hash TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (organization_id, id)
);

CREATE INDEX IF NOT EXISTS access_requests_status_idx
  ON access_requests(organization_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS user_roles_user_idx
  ON user_roles(organization_id, user_id);
CREATE INDEX IF NOT EXISTS user_permission_grants_user_idx
  ON user_permission_grants(organization_id, user_id);
CREATE INDEX IF NOT EXISTS sessions_user_idx
  ON sessions(organization_id, user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS sessions_active_idx
  ON sessions(token_hash, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS oidc_transactions_expiry_idx
  ON oidc_transactions(expires_at);
CREATE INDEX IF NOT EXISTS audit_log_created_idx
  ON audit_log(organization_id, created_at DESC);
