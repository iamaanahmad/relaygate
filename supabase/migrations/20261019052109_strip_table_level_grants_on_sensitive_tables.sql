/*
# Strip table-level ALL grants so column revocations take effect

1. Plain-English summary
   Supabase grants ALL table-level privileges by default. A table-level ALL
   grant covers every column, which re-exposed the sensitive columns
   (encrypted provider keys, gateway key hashes) even after column-level
   REVOKEs. This migration removes the broad table-level grants and keeps
   only the explicit column-level grants from the previous migration, so
   sensitive columns are permanently excluded from the browser-facing Data
   API.

2. Security changes
   - REVOKE ALL ON TABLE for api_keys and provider_connections from anon and
     authenticated (drops the ALL covering every column).
   - Column-level grants for non-sensitive columns from the previous
     migration remain in force.
   - RLS policies continue to gate row access; edge functions use the
     service_role and are unaffected.

3. Notes
   - Idempotent; no destructive operations, no data changes.
   - request_logs keeps its table-level grants because it has no sensitive
     columns; RLS read-only policies already restrict it.
*/

REVOKE ALL ON TABLE api_keys FROM anon, authenticated;
REVOKE ALL ON TABLE provider_connections FROM anon, authenticated;