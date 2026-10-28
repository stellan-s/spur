ALTER TABLE knowledge_gaps
  ADD COLUMN status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  ADD COLUMN history_json JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(history_json) = 'array');

CREATE INDEX knowledge_gaps_status_idx
  ON knowledge_gaps (organization_id, status, times_asked DESC, last_asked_at DESC);
