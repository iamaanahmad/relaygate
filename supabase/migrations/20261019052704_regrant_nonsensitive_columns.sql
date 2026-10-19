/*
# Re-establish column grants for non-sensitive columns

The table-level REVOKE dropped the explicit column-level grants for the
columns the dashboard reads directly. Re-grants every non-sensitive column
to anon and authenticated so PostgREST reads keep working, while the
sensitive columns (api_keys.key_hash, provider_connections.encrypted_api_key)
remain excluded.
*/

GRANT SELECT (id, project_id, name, key_prefix, created_by, last_used_at, revoked_at, created_at)
  ON api_keys TO anon, authenticated;
GRANT INSERT (id, project_id, name, key_prefix, created_by)
  ON api_keys TO anon, authenticated;
GRANT UPDATE (last_used_at, revoked_at)
  ON api_keys TO anon, authenticated;

GRANT SELECT (id, workspace_id, provider, key_hint, status, last_validated_at, created_by, created_at)
  ON provider_connections TO anon, authenticated;
GRANT INSERT (id, workspace_id, provider, key_hint, status, last_validated_at, created_by)
  ON provider_connections TO anon, authenticated;
GRANT UPDATE (status, last_validated_at, key_hint)
  ON provider_connections TO anon, authenticated;