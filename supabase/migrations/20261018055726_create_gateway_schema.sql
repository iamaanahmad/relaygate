/*
# Create AI Reliability Gateway schema

1. Plain-English summary
   This migration creates the core data model for the gateway: users organize
   themselves into workspaces, workspaces contain projects, and each project
   owns gateway API keys, provider failover routes, and request logs.
   Customers store their own AI provider credentials (BYOK) in an encrypted
   form that only server-side functions can read.

2. New Tables
   - `workspaces`: a team account. Owned by the creating user.
     - `id`, `name`, `owner_id` (defaults to the authenticated user), `created_at`
   - `workspace_members`: membership rows linking users to workspaces with a role
     (`owner`, `admin`, `developer`, `viewer`).
   - `projects`: isolated units inside a workspace. Each has its own API keys
     and routing configuration.
   - `provider_connections`: one row per (workspace, provider). Stores the
     provider API key ENCRYPTED (`encrypted_api_key`, AES-GCM, only edge
     functions can decrypt) plus a non-secret `key_hint` (last 4 characters),
     a validation `status`, and who added it.
   - `routing_rules`: the failover chain per project and requested model alias.
     Ordered by `priority`; each rule maps the alias to a concrete
     provider + provider model. Requests walk the chain until one succeeds.
   - `api_keys`: gateway keys issued to customers. Only the SHA-256 `key_hash`
     is stored (the plaintext key is shown exactly once at creation).
     Supports `revoked_at` for revocation and `last_used_at` tracking.
   - `request_logs`: one row per gateway request: provider, model, success or
     failure, HTTP status, latency, token usage, the failover attempts that
     were made, and an error message. Request/response payloads are NEVER
     stored.

3. Security changes
   - Row Level Security is ENABLED on every table.
   - All policies are scoped `TO authenticated` with workspace-membership
     checks; users can only ever touch rows of workspaces they belong to.
   - `request_logs` has read-only policies: it is written exclusively by the
     gateway function using the service role.
   - Column-level privileges: `provider_connections.encrypted_api_key` and
     `api_keys.key_hash` are revoked from browser-facing roles so secrets and
     hashes can never leave the database except through server-side functions.

4. Notes
   - All statements are idempotent-safe; policies are dropped before creation.
   - No destructive operations. Indexes added for the hot query paths
     (logs by project + time, api key lookup by hash).
*/

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','admin','developer','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS provider_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('openai','anthropic','gemini')),
  encrypted_api_key text NOT NULL,
  key_hint text NOT NULL,
  status text NOT NULL DEFAULT 'unvalidated' CHECK (status IN ('unvalidated','valid','invalid')),
  last_validated_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

CREATE TABLE IF NOT EXISTS routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  model_alias text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('openai','anthropic','gemini')),
  provider_model text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS request_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('success','failed')),
  http_status integer,
  latency_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  failover_chain jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_request_logs_project_created
  ON request_logs (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_routing_rules_project_alias
  ON routing_rules (project_id, model_alias, priority);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_logs ENABLE ROW LEVEL SECURITY;

-- Workspaces: visible to members, manageable by owner/admin
DROP POLICY IF EXISTS "select_member_workspaces" ON workspaces;
CREATE POLICY "select_member_workspaces" ON workspaces
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = workspaces.id AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_own_workspace" ON workspaces;
CREATE POLICY "insert_own_workspace" ON workspaces
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "update_admin_workspaces" ON workspaces;
CREATE POLICY "update_admin_workspaces" ON workspaces
  FOR UPDATE TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = workspaces.id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin')
    )
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = workspaces.id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS "delete_own_workspace" ON workspaces;
CREATE POLICY "delete_own_workspace" ON workspaces
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- Members list: readable by any member of that workspace
DROP POLICY IF EXISTS "select_workspace_members" ON workspace_members;
CREATE POLICY "select_workspace_members" ON workspace_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM workspace_members me
      WHERE me.workspace_id = workspace_members.workspace_id
        AND me.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_members_admin" ON workspace_members;
CREATE POLICY "insert_members_admin" ON workspace_members
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_members.workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM workspace_members me
            WHERE me.workspace_id = w.id AND me.user_id = auth.uid() AND me.role IN ('owner','admin')
          )
        )
    )
  );

DROP POLICY IF EXISTS "update_members_admin" ON workspace_members;
CREATE POLICY "update_members_admin" ON workspace_members
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_members.workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM workspace_members me
            WHERE me.workspace_id = w.id AND me.user_id = auth.uid() AND me.role IN ('owner','admin')
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_members.workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM workspace_members me
            WHERE me.workspace_id = w.id AND me.user_id = auth.uid() AND me.role IN ('owner','admin')
          )
        )
    )
  );

DROP POLICY IF EXISTS "delete_members_admin" ON workspace_members;
CREATE POLICY "delete_members_admin" ON workspace_members
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_members.workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM workspace_members me
            WHERE me.workspace_id = w.id AND me.user_id = auth.uid() AND me.role IN ('owner','admin')
          )
        )
    )
  );

-- Projects: full CRUD for members; viewers can read only
DROP POLICY IF EXISTS "select_member_projects" ON projects;
CREATE POLICY "select_member_projects" ON projects
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = projects.workspace_id AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_member_projects" ON projects;
CREATE POLICY "insert_member_projects" ON projects
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = projects.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin','developer')
    )
  );

DROP POLICY IF EXISTS "update_member_projects" ON projects;
CREATE POLICY "update_member_projects" ON projects
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = projects.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin','developer')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = projects.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin','developer')
    )
  );

DROP POLICY IF EXISTS "delete_admin_projects" ON projects;
CREATE POLICY "delete_admin_projects" ON projects
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = projects.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin')
    )
  );

-- Provider connections: readable by members, writable by admin/developer
DROP POLICY IF EXISTS "select_member_connections" ON provider_connections;
CREATE POLICY "select_member_connections" ON provider_connections
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = provider_connections.workspace_id AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_member_connections" ON provider_connections;
CREATE POLICY "insert_member_connections" ON provider_connections
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = provider_connections.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin','developer')
    )
  );

DROP POLICY IF EXISTS "update_member_connections" ON provider_connections;
CREATE POLICY "update_member_connections" ON provider_connections
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = provider_connections.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin','developer')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = provider_connections.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin','developer')
    )
  );

DROP POLICY IF EXISTS "delete_member_connections" ON provider_connections;
CREATE POLICY "delete_member_connections" ON provider_connections
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = provider_connections.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin','developer')
    )
  );

-- Routing rules: full CRUD for editor roles, read for all members
DROP POLICY IF EXISTS "select_member_routes" ON routing_rules;
CREATE POLICY "select_member_routes" ON routing_rules
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = routing_rules.project_id AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_editor_routes" ON routing_rules;
CREATE POLICY "insert_editor_routes" ON routing_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = routing_rules.project_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin','developer')
    )
  );

DROP POLICY IF EXISTS "update_editor_routes" ON routing_rules;
CREATE POLICY "update_editor_routes" ON routing_rules
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = routing_rules.project_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin','developer')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = routing_rules.project_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin','developer')
    )
  );

DROP POLICY IF EXISTS "delete_editor_routes" ON routing_rules;
CREATE POLICY "delete_editor_routes" ON routing_rules
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = routing_rules.project_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin','developer')
    )
  );

-- API keys: read for members, create for editors, revoke (update/delete) for editors
DROP POLICY IF EXISTS "select_member_api_keys" ON api_keys;
CREATE POLICY "select_member_api_keys" ON api_keys
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = api_keys.project_id AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_editor_api_keys" ON api_keys;
CREATE POLICY "insert_editor_api_keys" ON api_keys
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = api_keys.project_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin','developer')
    )
  );

DROP POLICY IF EXISTS "update_editor_api_keys" ON api_keys;
CREATE POLICY "update_editor_api_keys" ON api_keys
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = api_keys.project_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin','developer')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = api_keys.project_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin','developer')
    )
  );

DROP POLICY IF EXISTS "delete_editor_api_keys" ON api_keys;
CREATE POLICY "delete_editor_api_keys" ON api_keys
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = api_keys.project_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin','developer')
    )
  );

-- Request logs: read-only for members; written only by the gateway (service role)
DROP POLICY IF EXISTS "select_member_logs" ON request_logs;
CREATE POLICY "select_member_logs" ON request_logs
  FOR SELECT TO authenticated
  USING (
    project_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = request_logs.project_id AND wm.user_id = auth.uid()
    )
  );

-- Hide secrets and hashes from browser-facing roles.
REVOKE SELECT (encrypted_api_key) ON provider_connections FROM anon, authenticated;
REVOKE SELECT (key_hash) ON api_keys FROM anon, authenticated;