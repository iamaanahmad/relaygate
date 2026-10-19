/*
# Perf: covering indexes for user/owner foreign keys

Adds indexes on workspace_members.user_id and workspaces.owner_id,
the last two FK columns flagged by the linter.
*/

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members (user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces (owner_id);