-- Conversations belong to the person who started them. Rows from before this
-- migration have no owner and are no longer listed.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS created_by TEXT;

CREATE INDEX IF NOT EXISTS conversations_owner_idx
  ON conversations(organization_id, created_by, updated_at DESC);
