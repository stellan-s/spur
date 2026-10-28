-- Deleted and merged memory gets its own state. Stale now only means outdated.
UPDATE memory_objects
SET state = 'deleted'
WHERE metadata_json ? 'deleted_at' AND state <> 'deleted';
