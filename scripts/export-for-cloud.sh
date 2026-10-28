#!/usr/bin/env bash
# Exports one Spur database's memory for gcloud sql import into a freshly
# migrated cloud database. Identity, sessions, tokens, feature switches and
# the audit log are left out; the cloud sets those up afresh.
#
# Usage: scripts/export-for-cloud.sh DATABASE_URL OUTPUT.sql
#
# Local repository sources are rewritten to their GitHub remotes, so evidence
# is verified through the GitHub App. Sources without a GitHub remote and no
# evidence are dropped. The output holds restricted records: keep it private.
set -euo pipefail

database_url="${1:?database URL}"
output="${2:?output file}"

tables=(
  organizations sources evidence memory_objects relationships memory_merges
  isms_controls isms_control_revisions knowledge_gaps investigations
  conversations conversation_turns source_analysis_runs
  source_analysis_run_objects source_analysis_run_relationships
)
table_args=()
for table in "${tables[@]}"; do table_args+=(--table="public.${table}"); done

umask 077
pg_dump "$database_url" --data-only --column-inserts --on-conflict-do-nothing \
  --no-owner --no-privileges "${table_args[@]}" > "$output"

cat >> "$output" <<'SQL'

-- Repository sources now read through GitHub.
UPDATE sources
SET metadata_json = (metadata_json - 'repository_root' - 'credential_env') || jsonb_build_object(
  'provider', 'github',
  'authentication', 'github_app',
  'github_owner', substring(metadata_json->>'remote_url' from '^https://github\.com/([^/]+)/'),
  'github_repository', substring(metadata_json->>'remote_url' from '^https://github\.com/[^/]+/([^/]+?)(?:\.git)?/?$'),
  'repository_root', 'github://' ||
    substring(metadata_json->>'remote_url' from '^https://github\.com/([^/]+)/') || '/' ||
    substring(metadata_json->>'remote_url' from '^https://github\.com/[^/]+/([^/]+?)(?:\.git)?/?$')
)
WHERE kind = 'repository' AND metadata_json->>'remote_url' ~ '^https://github\.com/';

DELETE FROM sources s
WHERE s.kind = 'repository'
  AND coalesce(s.metadata_json->>'provider', '') <> 'github'
  AND NOT EXISTS (
    SELECT 1 FROM evidence e WHERE e.organization_id = s.organization_id AND e.source_id = s.id
  );
SQL

echo "Wrote ${output}: $(grep -c '^INSERT INTO' "$output") rows."
