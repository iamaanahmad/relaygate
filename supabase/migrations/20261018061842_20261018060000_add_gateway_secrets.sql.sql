/*
# Add gateway_secrets table for master encryption key

1. Plain-English summary
   The gateway encrypts each customer's AI provider API key (OpenAI,
   Anthropic, Gemini) before storing it. This migration adds a private table
   that holds the master key material used for that encryption. Only the
   server-side gateway function can read it; no browser-facing role can.

2. New Tables
   - `gateway_secrets`
     - `id` (integer primary key, always 1 - single-row table)
     - `master_key_hex` (text): 64 hex characters of random key material
     - `created_at` (timestamp)

3. Security changes
   - Row Level Security is ENABLED.
   - NO policies are created: every browser-facing role (anon,
     authenticated) is denied all access by default.
   - SELECT/UPDATE on this table is granted ONLY to `service_role`, which
     server-side functions use. The service role bypasses RLS, but the
     explicit grant documents intent and keeps the table out of the
     public-facing Data API surface.

4. Notes
   - The row is initialized with 32 random bytes from the database's own
     cryptographically secure random generator.
   - Idempotent: re-running will not duplicate or overwrite the key.
*/

CREATE TABLE IF NOT EXISTS gateway_secrets (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  master_key_hex text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO gateway_secrets (id, master_key_hex)
SELECT 1, encode(gen_random_bytes(32), 'hex')
WHERE NOT EXISTS (SELECT 1 FROM gateway_secrets WHERE id = 1);

ALTER TABLE gateway_secrets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON gateway_secrets FROM anon, authenticated;
GRANT SELECT, UPDATE ON gateway_secrets TO service_role;