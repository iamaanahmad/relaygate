# RelayGate backend setup guide

This guide prepares the Supabase backend from zero: database schema, security policies, encrypted credentials, and edge functions.

## 1. Create the Supabase project

1. Sign in at https://supabase.com/dashboard
2. **New project**, pick any name and a strong database password
3. Wait for provisioning, then note from **Project Settings → API**:
   - Project URL
   - anon public key

These two values go into `.env` (see `.env.example`). Never share the service role key; it is only used inside Supabase's own runtime for edge functions and is pre-provisioned there automatically.

## 2. Apply the database migrations

The repo contains three migrations that must be applied in order:

1. `20261018055726_create_gateway_schema.sql` — core schema (workspaces, projects, provider_connections, routing_rules, api_keys, request_logs) with RLS policies
2. `20261018061842_...add_gateway_secrets.sql` — private single-row table holding the AES-256-GCM master key for credential encryption
3. `harden_sensitive_column_privileges` + `strip_table_level_grants_on_sensitive_tables` — strip all browser-facing privileges on `api_keys.key_hash` and `provider_connections.encrypted_api_key` so secrets and hashes can never leave the database except through server-side functions

Apply them from **Project Settings → Database → Migrations**, or via the Supabase MCP tools (`apply_migration`) in order. All are idempotent; re-running is safe.

Verify after applying:

```sql
SELECT grantee, privilege_type, column_name
FROM information_schema.column_privileges
WHERE table_schema='public'
  AND table_name IN ('api_keys','provider_connections')
  AND grantee IN ('anon','authenticated')
  AND column_name IN ('key_hash','encrypted_api_key');
```

This must return **zero rows**.

## 3. Deploy the edge functions

Five functions live under `supabase/functions/`:

| Function | JWT | Purpose |
|---|---|---|
| `gateway` | no (auth via gateway key) | The AI endpoint; authenticates `gw_...` keys, walks the failover chain, logs requests |
| `api-keys` | yes | Create/revoke/delete gateway keys for a project |
| `provider-keys` | yes | Add (validate + encrypt) or delete provider credentials per workspace |
| `members` | yes | List/invite/update/remove workspace members |
| `bootstrap-workspace` | yes* | Create the user's first workspace (checks the session itself, so verify_jwt can stay off) |

Deploy with the Supabase MCP tools (`deploy_edge_functions`) — it picks up every function whose source changed and configures secrets automatically. After deploying, confirm all five show status ACTIVE.

## 4. How credential encryption works

- When a team adds a provider API key, the `provider-keys` function first validates it against the provider, then encrypts it with AES-256-GCM using the master key from `gateway_secrets` (32 random bytes generated inside the database).
- Storage format: `base64(iv).base64(ciphertext+tag)` in `provider_connections.encrypted_api_key`.
- Only edge functions can read that column; browser roles have zero privileges on it (migrations from step 2).
- The plaintext key is shown to the dashboard only as a last-4-character hint.

## 5. How gateway key authentication works

- The dashboard calls `api-keys` with action `create`; the function generates `gw_<32 random url-safe chars>`, stores only `SHA-256(raw)` plus a 10-char prefix, and returns the plaintext exactly once.
- `gateway` authenticates incoming requests by hashing the presented key and looking up the hash; `revoked_at IS NOT NULL` keys are rejected (401).
- Revocation takes effect immediately; there is no cache of key validity.

## 6. Gateway limits (beta values)

| Limit | Value | Where |
|---|---|---|
| Request body size | 1 MB | `gateway` |
| Upstream timeout | 60 s per provider call | `gateway` |
| Failover chain length | 10 rules | `gateway` |
| Messages per request | 1–100 | `gateway` |
| Per-key rate limit | 120 requests / 60 s (per edge instance) | `gateway` |
| Per-key concurrency | 5 active requests (per edge instance) | `gateway` |

## 7. What is logged, and what never is

`request_logs` stores: project, provider, model, success/failed, HTTP status, latency, token counts, the failover trail, and a safe error message.

Never stored, anywhere: prompt messages, AI response content, provider API keys (plaintext or encrypted — `request_logs` has no credential column), gateway key plaintext or hashes.

## 8. Health checks and monitoring

Beta: watch Supabase's built-in **Edge function logs** and **API logs** in the dashboard; request volume and failure rates are visible in `request_logs` via the dashboard Logs page.

Post-beta recommendations (not yet wired): a `/health` endpoint, external uptime monitoring, and error aggregation (e.g. Sentry) for edge functions.

## 9. Rollback

- **Dashboard (Netlify)**: redeploy any prior production deploy from the Netlify deploys page — instant rollback.
- **Edge functions**: redeploy a previous function source (Supabase MCP deploy from an earlier commit of `supabase/functions/`).
- **Database**: migrations are additive and idempotent; to undo a data-level change, write a new migration rather than dropping objects. Take a backup (Supabase → Database → Backups) before any risky change.

## 10. Beta deployment checklist

- [ ] Migrations applied; sensitive-column verification query returns zero rows
- [ ] All five edge functions ACTIVE
- [ ] `.env` populated on Netlify (Project URL + anon key) and deploy green
- [ ] Sign up works; workspace bootstraps; project, provider key, routing rule, and gateway key creation all work end to end
- [ ] A live `gateway` call returns content with a populated failover trail
- [ ] Revoked gateway key returns 401 immediately
- [ ] Supabase backups enabled (Database → Backups)
