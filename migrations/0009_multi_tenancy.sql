CREATE TABLE organization_settings (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings_json) = 'object'),
  first_admin_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE organization_secrets (
  organization_id TEXT NOT NULL REFERENCES organization_settings(organization_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, name)
);

CREATE TABLE instance_administrators (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE instance_bootstrap (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE instance_audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  organization_id TEXT REFERENCES organizations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX instance_audit_actor_idx ON instance_audit_log(actor_user_id, created_at DESC);
CREATE INDEX instance_audit_organization_idx ON instance_audit_log(organization_id, created_at DESC);
CREATE INDEX access_requests_user_idx ON access_requests(user_id, status);

ALTER TABLE sessions ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE oidc_transactions ALTER COLUMN organization_id DROP NOT NULL;
