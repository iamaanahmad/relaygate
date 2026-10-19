'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { useEdgeFunction } from '@/lib/edge-client';
import { getSupabase } from '@/lib/supabase';
import type { Role, WorkspaceMember } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, UserPlus, Trash2, Building2 } from 'lucide-react';

const ROLE_OPTIONS: Role[] = ['owner', 'admin', 'developer', 'viewer'];

export default function SettingsPage() {
  const { workspace, members, role, isAdmin, refresh, loading } = useWorkspace();
  const callEdge = useEdgeFunction();
  const supabase = getSupabase();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('developer');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteOk, setInviteOk] = useState<string | null>(null);

  const [removeTarget, setRemoveTarget] = useState<WorkspaceMember | null>(null);
  const [removing, setRemoving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);

  const invite = useCallback(async () => {
    if (!workspace) return;
    setInviting(true);
    setInviteError(null);
    setInviteOk(null);
    try {
      await callEdge('members', {
        body: {
          action: 'invite',
          workspace_id: workspace.id,
          email: inviteEmail.trim(),
          role: inviteRole,
        },
      });
      setInviteOk(`Invitation ready for ${inviteEmail.trim()}`);
      setInviteEmail('');
      await refresh();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Could not add the member');
    } finally {
      setInviting(false);
    }
  }, [workspace, inviteEmail, inviteRole, callEdge, refresh]);

  async function changeRole(memberId: string, newRole: Role) {
    if (!workspace) return;
    setActionError(null);
    try {
      await callEdge('members', {
        body: { action: 'update_role', workspace_id: workspace.id, member_id: memberId, role: newRole },
      });
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not change the role');
    }
  }

  async function removeMember() {
    if (!workspace || !removeTarget) return;
    setRemoving(true);
    try {
      await callEdge('members', {
        body: { action: 'remove', workspace_id: workspace.id, member_id: removeTarget.id },
      });
      setRemoveTarget(null);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not remove the member');
    } finally {
      setRemoving(false);
    }
  }

  async function createProject() {
    if (!workspace || !newProjectName.trim()) return;
    setCreatingProject(true);
    setProjectError(null);
    try {
      const { error } = await supabase
        .from('projects')
        .insert({ workspace_id: workspace.id, name: newProjectName.trim() });
      if (error) throw error;
      setNewProjectName('');
      await refresh();
    } catch (err) {
      setProjectError(
        err instanceof Error && err.message.includes('duplicate')
          ? 'A project with that name already exists.'
          : 'Could not create the project.'
      );
    } finally {
      setCreatingProject(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!workspace) return null;

  return (
    <div className="max-w-3xl space-y-6">
      <Card className="border-slate-800 bg-[#0d1524]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <Building2 className="h-4 w-4 text-emerald-400" />
            Workspace
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-sm text-slate-300">{workspace.name}</p>
          <p className="text-xs text-slate-500">
            Created {new Date(workspace.created_at).toLocaleDateString()} · Your role:{' '}
            <span className="capitalize text-slate-400">{role}</span>
          </p>
        </CardContent>
      </Card>

      <Card className="border-slate-800 bg-[#0d1524]">
        <CardHeader>
          <CardTitle className="text-base text-white">Projects</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="New project name"
              className="border-slate-700 bg-[#0a0f1a]"
            />
            <Button
              onClick={createProject}
              disabled={creatingProject || !newProjectName.trim()}
              className="shrink-0 bg-emerald-500 text-[#06281f] hover:bg-emerald-400"
            >
              {creatingProject && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add project
            </Button>
          </div>
          {projectError && <p className="text-sm text-red-400">{projectError}</p>}
        </CardContent>
      </Card>

      <Card className="border-slate-800 bg-[#0d1524]">
        <CardHeader>
          <CardTitle className="text-base text-white">Members</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="border-slate-700 bg-[#0a0f1a]"
              />
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
                <SelectTrigger className="w-full shrink-0 border-slate-700 bg-[#0a0f1a] sm:w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-slate-800 bg-[#0d1524] text-slate-100">
                  {['admin', 'developer', 'viewer'].map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={invite}
                disabled={inviting || !inviteEmail.trim()}
                className="shrink-0 bg-emerald-500 text-[#06281f] hover:bg-emerald-400"
              >
                {inviting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                Add
              </Button>
            </div>
          )}
          {inviteError && <p className="text-sm text-red-400">{inviteError}</p>}
          {inviteOk && <p className="text-sm text-emerald-400">{inviteOk}</p>}
          {actionError && <p className="text-sm text-red-400">{actionError}</p>}

          <div className="divide-y divide-slate-800">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-200">{m.email ?? 'Unknown user'}</p>
                  <p className="text-xs text-slate-500">
                    Joined {new Date(m.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isAdmin && m.role !== 'owner' ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) => changeRole(m.id, v as Role)}
                    >
                      <SelectTrigger className="w-32 border-slate-700 bg-[#0a0f1a] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-slate-800 bg-[#0d1524] text-slate-100">
                        {ROLE_OPTIONS.map((r) => (
                          <SelectItem key={r} value={r} className="capitalize">
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="rounded-md bg-slate-800 px-2.5 py-1 text-xs capitalize text-slate-300">
                      {m.role}
                    </span>
                  )}
                  {isAdmin && m.role !== 'owner' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRemoveTarget(m)}
                      className="h-8 px-2 text-red-400 hover:bg-red-950/40 hover:text-red-300"
                      aria-label={`Remove ${m.email ?? 'member'}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={removeTarget !== null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent className="border-slate-800 bg-[#0d1524] text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {removeTarget?.email} will lose access to this workspace immediately. Their API keys
              keep working until revoked separately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                removeMember();
              }}
              className="bg-red-600 hover:bg-red-500"
              disabled={removing}
            >
              {removing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
