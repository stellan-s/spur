CREATE TABLE IF NOT EXISTS organization_features (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  value_json JSONB NOT NULL,
  updated_by TEXT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (organization_id, feature)
);

CREATE INDEX IF NOT EXISTS organization_features_updated_idx
  ON organization_features(organization_id, updated_at DESC);
