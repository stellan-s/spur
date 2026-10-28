CREATE TABLE memory_aliases (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 160),
  normalized_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'verified', 'rejected')),
  origin TEXT NOT NULL CHECK (origin IN ('repository', 'document', 'user', 'system')),
  scope TEXT NOT NULL CHECK (scope IN ('organization', 'repository')),
  source_id TEXT,
  source_version TEXT,
  evidence_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_ids_json) = 'array'),
  actor TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_note TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata_json) = 'object'),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, memory_id)
    REFERENCES memory_objects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, source_id)
    REFERENCES sources(organization_id, id),
  CHECK ((scope = 'repository' AND source_id IS NOT NULL) OR scope = 'organization'),
  CHECK (origin <> 'repository' OR source_id IS NOT NULL)
);

CREATE UNIQUE INDEX memory_aliases_provenance_unique
  ON memory_aliases (
    organization_id,
    memory_id,
    normalized_name,
    origin,
    COALESCE(source_id, ''),
    COALESCE(actor, '')
  );

CREATE INDEX memory_aliases_memory_idx
  ON memory_aliases (organization_id, memory_id, created_at);

CREATE INDEX memory_aliases_search_idx
  ON memory_aliases (organization_id, normalized_name)
  WHERE status <> 'rejected';
