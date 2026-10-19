/*
# Perf: wrap auth.uid() in policies + add covering indexes for foreign keys

1. Plain-English summary
   Two mechanical performance fixes flagged by the Supabase linter:
   - Row Level Security policies that call auth.uid() re-evaluate it per row.
     Wrapping it as (select auth.uid()) makes Postgres evaluate it once per
     query. Same value, same access decisions, faster queries.
   - Foreign key columns without covering indexes slow down joins and
     cascading deletes. Adds indexes for the five unindexed FKs.

2. Notes
   - Policies are recreated with identical predicates; access behavior is
     unchanged. No data changes; idempotent.
*/

-- workspaces
DROP POLICY IF EXISTS "select_member_workspaces" ON workspaces;
CREATE POLICY "select_member_workspaces" ON workspaces
  FOR SELECT TO authenticated
  USING (
    owner_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = workspaces.id AND wm.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "insert_own_workspace" ON workspaces;
CREATE POLICY "insert_own_workspace" ON workspaces
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "update_admin_workspaces" ON workspaces;
CREATE POLICY "update_admin_workspaces" ON workspaces
  FOR UPDATE TO authenticated
  USING (
    owner_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = workspaces.id
        AND wm.user_id = (select auth.uid())
        AND wm.role IN ('owner','admin')
    )
  )
  WITH CHECK (
    owner_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = workspaces.id
        AND wm.user_id = (select auth.uid())
        AND wm.role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS "delete_own_workspace" ON workspaces;
CREATE POLICY "delete_own_workspace" ON workspaces
  FOR DELETE TO authenticated
  USING (owner_id = (select auth.uid()));

-- workspace_members
DROP POLICY IF EXISTS "select_workspace_members" ON workspace_members;
CREATE POLICY "select_workspace_members" ON workspace_members
  FOR SELECT TO authenticated
  USING (
    user_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM workspace_members me
      WHERE me.workspace_id = workspace_members.workspace_id
        AND me.user_id = (select auth.uid())
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
          w.owner_id = (select auth.uid())
          OR EXISTS (
            SELECT 1 FROM workspace_members me
            WHERE me.workspace_id = w.id AND me.user_id = (select auth.uid()) AND me.role IN ('owner','admin')
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
          w.owner_id = (select auth.uid())
          OR EXISTS (
            SELECT 1 FROM workspace_members me
            WHERE me.workspace_id = w.id AND me.user_id = (select auth.uid()) AND me.role IN ('owner','admin')
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_members.workspace_id
        AND (
          w.owner_id = (select auth.uid())
          OR EXISTS (
            SELECT 1 FROM workspace_members me
            WHERE me.workspace_id = w.id AND me.user_id = (select auth.uid()) AND me.role IN ('owner','admin')
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
          w.owner_id = (select auth.uid())
          OR EXISTS (
            SELECT 1 FROM workspace_members me
            WHERE me.workspace_id = w.id AND me.user_id = (select auth.uid()) AND me.role IN ('owner','admin')
          )
        )
    )
  );

-- projects
DROP POLICY IF EXISTS "select_member_projects" ON projects;
CREATE POLICY "select_member_projects" ON projects
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = projects.workspace_id AND wm.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "insert_member_projects" ON projects;
CREATE POLICY "insert_member_projects" ON projects
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = projects.workspace_id
        AND wm.user_id = (select auth.uid())
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
        AND wm.user_id = (select auth.uid())
        AND wm.role IN ('owner','admin','developer')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = projects.workspace_id
        AND wm.user_id = (select auth.uid())
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
        AND wm.user_id = (select auth.uid())
        AND wm.role IN ('owner','admin')
    )
  );

-- provider_connections
DROP POLICY IF EXISTS "select_member_connections" ON provider_connections;
CREATE POLICY "select_member_connections" ON provider_connections
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = provider_connections.workspace_id AND wm.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "insert_member_connections" ON provider_connections;
CREATE POLICY "insert_member_connections" ON provider_connections
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = provider_connections.workspace_id
        AND wm.user_id = (select auth.uid())
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
        AND wm.user_id = (select auth.uid())
        AND wm.role IN ('owner','admin','developer')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = provider_connections.workspace_id
        AND wm.user_id = (select auth.uid())
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
        AND wm.user_id = (select auth.uid())
        AND wm.role IN ('owner','admin','developer')
    )
  );

-- routing_rules
DROP POLICY IF EXISTS "select_member_routes" ON routing_rules;
CREATE POLICY "select_member_routes" ON routing_rules
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = routing_rules.project_id AND wm.user_id = (select auth.uid())
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
        AND wm.user_id = (select auth.uid())
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
        AND wm.user_id = (select auth.uid())
        AND wm.role IN ('owner','admin','developer')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = routing_rules.project_id
        AND wm.user_id = (select auth.uid())
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
        AND wm.user_id = (select auth.uid())
        AND wm.role IN ('owner','admin','developer')
    )
  );

-- api_keys
DROP POLICY IF EXISTS "select_member_api_keys" ON api_keys;
CREATE POLICY "select_member_api_keys" ON api_keys
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = api_keys.project_id AND wm.user_id = (select auth.uid())
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
        AND wm.user_id = (select auth.uid())
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
        AND wm.user_id = (select auth.uid())
        AND wm.role IN ('owner','admin','developer')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = api_keys.project_id
        AND wm.user_id = (select auth.uid())
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
        AND wm.user_id = (select auth.uid())
        AND wm.role IN ('owner','admin','developer')
    )
  );

-- request_logs
DROP POLICY IF EXISTS "select_member_logs" ON request_logs;
CREATE POLICY "select_member_logs" ON request_logs
  FOR SELECT TO authenticated
  USING (
    project_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = request_logs.project_id AND wm.user_id = (select auth.uid())
    )
  );

-- Covering indexes for unindexed foreign keys.
CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys (project_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON api_keys (created_by);
CREATE INDEX IF NOT EXISTS idx_provider_connections_workspace ON provider_connections (workspace_id);
CREATE INDEX IF NOT EXISTS idx_provider_connections_created_by ON provider_connections (created_by);
CREATE INDEX IF NOT EXISTS idx_routing_rules_project ON routing_rules (project_id);