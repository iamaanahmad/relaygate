/*
# Harden column-level privileges on sensitive columns

1. Plain-English summary
   The encrypted provider credentials (provider_connections.encrypted_api_key)
   and the one-way gateway API-key hashes (api_keys.key_hash) must never be
   readable or writable through the browser-facing Data API. A previous
   migration revoked these columns, but default table-level grants re-exposed
   them. This migration removes ALL browser-facing privileges on those columns
   and re-establishes explicit table-level grants for every non-sensitive
   column, so the sensitive columns are permanently excluded.

2. Security changes
   - REVOKE ALL on the sensitive columns from anon and authenticated.
   - GRANT explicit column lists (SELECT/INSERT/UPDATE as appropriate) for all
     non-sensitive columns to anon and authenticated, matching what the app
     needs. RLS policies continue to gate row access as before.
   - Idempotent; no destructive operations, no data changes.

3. Notes
   - The gateway and other edge functions use the service_role, which is
     unaffected and keeps full access.
*/

-- Sensitive columns: strip every browser-facing privilege.
REVOKE ALL (key_hash) ON api_keys FROM anon, authenticated;
REVOKE ALL (encrypted_api_key) ON provider_connections FROM anon, authenticated;

-- api_keys: re-grant every non-sensitive column explicitly.
GRANT SELECT (id, project_id, name, key_prefix, created_by, last_used_at, revoked_at, created_at)
  ON api_keys TO anon, authenticated;
GRANT INSERT (id, project_id, name, key_prefix, created_by)
  ON api_keys TO anon, authenticated;
GRANT UPDATE (last_used_at, revoked_at)
  ON api_keys TO anon, authenticated;

-- provider_connections: re-grant every non-sensitive column explicitly.
GRANT SELECT (id, workspace_id, provider, key_hint, status, last_validated_at, created_by, created_at)
  ON provider_connections TO anon, authenticated;
GRANT INSERT (id, workspace_id, provider, key_hint, status, last_validated_at, created_by)
  ON provider_connections TO anon, authenticated;
GRANT UPDATE (status, last_validated_at, key_hint)
  ON provider_connections TO anon, authenticated;