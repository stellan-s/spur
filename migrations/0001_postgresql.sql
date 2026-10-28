CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  locator TEXT NOT NULL,
  status TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (organization_id, id)
);

CREATE TABLE IF NOT EXISTS evidence (
  organization_id TEXT NOT NULL,
  id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  excerpt TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, source_id)
    REFERENCES sources(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_objects (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  statement TEXT NOT NULL,
  state TEXT NOT NULL,
  authority TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  subjects_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_version TEXT,
  actor TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS relationships (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  to_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, from_id, predicate, to_id),
  FOREIGN KEY (organization_id, from_id)
    REFERENCES memory_objects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, to_id)
    REFERENCES memory_objects(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_merges (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  merged_at TEXT NOT NULL,
  merged_by TEXT NOT NULL,
  PRIMARY KEY (organization_id, source_id),
  FOREIGN KEY (organization_id, source_id)
    REFERENCES memory_objects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, target_id)
    REFERENCES memory_objects(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_gaps (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  question TEXT NOT NULL,
  reason TEXT NOT NULL,
  times_asked INTEGER NOT NULL DEFAULT 1,
  first_asked_at TEXT NOT NULL,
  last_asked_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, id)
);

CREATE TABLE IF NOT EXISTS investigations (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  analysis_json JSONB NOT NULL,
  recalled_memory_ids_json JSONB NOT NULL,
  learned_memory_ids_json JSONB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, id)
);

CREATE TABLE IF NOT EXISTS conversations (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  repository_commit_sha TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, id)
);

CREATE TABLE IF NOT EXISTS conversation_turns (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  investigation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, investigation_id),
  FOREIGN KEY (organization_id, conversation_id)
    REFERENCES conversations(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, investigation_id)
    REFERENCES investigations(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_analysis_runs (
  organization_id TEXT NOT NULL,
  id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_version TEXT,
  model TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, source_id, source_version, idempotency_key),
  FOREIGN KEY (organization_id, source_id)
    REFERENCES sources(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_analysis_run_objects (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  PRIMARY KEY (organization_id, run_id, external_id),
  FOREIGN KEY (organization_id, run_id)
    REFERENCES source_analysis_runs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, memory_id)
    REFERENCES memory_objects(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_analysis_run_relationships (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  PRIMARY KEY (organization_id, run_id, relationship_id),
  FOREIGN KEY (organization_id, run_id)
    REFERENCES source_analysis_runs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, relationship_id)
    REFERENCES relationships(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS isms_controls (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  reference_key TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  PRIMARY KEY (organization_id, id)
);

CREATE TABLE IF NOT EXISTS isms_control_revisions (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  control_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload_json JSONB NOT NULL,
  actor TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, control_id, version),
  FOREIGN KEY (organization_id, control_id)
    REFERENCES isms_controls(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS memory_updated_idx
  ON memory_objects(organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS memory_kind_idx
  ON memory_objects(organization_id, kind);
CREATE INDEX IF NOT EXISTS relationship_from_idx
  ON relationships(organization_id, from_id);
CREATE INDEX IF NOT EXISTS relationship_to_idx
  ON relationships(organization_id, to_id);
CREATE INDEX IF NOT EXISTS source_analysis_run_source_idx
  ON source_analysis_runs(organization_id, source_id, source_version, created_at DESC);
CREATE INDEX IF NOT EXISTS source_analysis_run_memory_idx
  ON source_analysis_run_objects(organization_id, memory_id);
CREATE INDEX IF NOT EXISTS source_analysis_run_relationship_idx
  ON source_analysis_run_relationships(organization_id, relationship_id);
CREATE INDEX IF NOT EXISTS conversation_updated_idx
  ON conversations(organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS conversation_turn_conversation_idx
  ON conversation_turns(organization_id, conversation_id, created_at ASC);
CREATE UNIQUE INDEX IF NOT EXISTS isms_control_reference_active_idx
  ON isms_controls(organization_id, reference_key) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS isms_control_updated_idx
  ON isms_controls(organization_id, updated_at DESC);
