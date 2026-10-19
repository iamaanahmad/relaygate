'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from './supabase';
import { useAuth } from './auth-context';
import type {
  Project,
  ProviderConnection,
  Role,
  Workspace,
  WorkspaceMember,
} from './types';

interface WorkspaceContextValue {
  workspaces: Workspace[];
  workspace: Workspace | null;
  role: Role | null;
  projects: Project[];
  project: Project | null;
  setProjectId: (id: string) => void;
  members: WorkspaceMember[];
  connections: ProviderConnection[];
  canEdit: boolean;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  loading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/signin');
  }, [authLoading, user, router]);

  const load = useCallback(async () => {
    if (!user) return;
    const supabase = getSupabase();
    setLoading(true);
    try {
      const { data: wsData, error: wsErr } = await supabase
        .from('workspaces')
        .select('*')
        .order('created_at');
      if (wsErr) throw wsErr;
      const list = wsData ?? [];
      setWorkspaces(list);
      const current = list[0] ?? null;
      setWorkspace(current);
      if (!current) {
        setProjects([]);
        setMembers([]);
        setConnections([]);
        setRole(null);
        setProjectId(null);
        return;
      }

      const [memberRes, projectRes, connRes] = await Promise.all([
        supabase
          .from('workspace_members')
          .select('id, workspace_id, user_id, role, created_at')
          .eq('workspace_id', current.id),
        supabase
          .from('projects')
          .select('*')
          .eq('workspace_id', current.id)
          .order('created_at'),
        supabase
          .from('provider_connections')
          .select('id, workspace_id, provider, key_hint, status, last_validated_at, created_by, created_at')
          .eq('workspace_id', current.id),
      ]);
      if (memberRes.error) throw memberRes.error;
      if (projectRes.error) throw projectRes.error;
      if (connRes.error) throw connRes.error;

      const memberRows: WorkspaceMember[] = memberRes.data ?? [];
      setMembers(memberRows);
      const mine = memberRows.find((m) => m.user_id === user.id);
      setRole((mine?.role as Role) ?? null);
      const projectRows: Project[] = projectRes.data ?? [];
      setProjects(projectRows);
      setProjectId(projectRows[0]?.id ?? null);
      setConnections((connRes.data ?? []) as ProviderConnection[]);
    } catch (err) {
      console.error('Failed to load workspace data:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId]
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      workspace,
      role,
      projects,
      project,
      setProjectId,
      members,
      connections,
      canEdit: role === 'owner' || role === 'admin' || role === 'developer',
      isAdmin: role === 'owner' || role === 'admin',
      refresh: load,
      loading,
    }),
    [workspaces, workspace, role, projects, project, members, connections, load, loading]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
