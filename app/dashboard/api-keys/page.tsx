'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { useEdgeFunction } from '@/lib/edge-client';
import { getSupabase } from '@/lib/supabase';
import type { ApiKey } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Loader2, Plus, Copy, Check, KeyRound, Ban } from 'lucide-react';

export default function ApiKeysPage() {
  const { project, canEdit, loading } = useWorkspace();
  const callEdge = useEdgeFunction();
  const supabase = getSupabase();

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [keysError, setKeysError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    if (!project) {
      setKeys([]);
      setLoadingKeys(false);
      return;
    }
    setLoadingKeys(true);
    setKeysError(null);
    try {
      const { data, error } = await supabase
        .from('api_keys')
        .select('id, project_id, name, key_prefix, last_used_at, revoked_at, created_at')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setKeys((data ?? []) as ApiKey[]);
    } catch (err) {
      setKeysError(err instanceof Error ? err.message : 'Could not load API keys');
    } finally {
      setLoadingKeys(false);
    }
  }, [project, supabase]);

  useEffect(() => {
    (async () => {
      await loadKeys();
    })();
  }, [loadKeys]);

  async function handleCreate() {
    if (!project) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await callEdge<{ api_key: string; key: { id: string } }>('api-keys', {
        body: { action: 'create', project_id: project.id, name: keyName.trim() },
      });
      setNewSecret(res.api_key);
      setCreateOpen(false);
      setKeyName('');
      await loadKeys();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create the key');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke() {
    if (!project || !revokeTarget) return;
    setRevoking(true);
    try {
      await callEdge('api-keys', {
        body: { action: 'revoke', project_id: project.id, key_id: revokeTarget.id },
      });
      setRevokeTarget(null);
      await loadKeys();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not revoke the key');
    } finally {
      setRevoking(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <Card className="border-slate-800 bg-[#0d1524]">
        <CardContent className="py-10 text-center text-slate-400">
          Create a project first, then issue API keys for it.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Gateway keys authenticate requests to the AI endpoint for project{' '}
          <span className="text-slate-200">{project.name}</span>.
        </p>
        {canEdit && (
          <Button
            onClick={() => {
              setCreateError(null);
              setKeyName('');
              setCreateOpen(true);
            }}
            className="shrink-0 bg-emerald-500 text-[#06281f] hover:bg-emerald-400"
          >
            <Plus className="mr-2 h-4 w-4" />
            New key
          </Button>
        )}
      </div>

      {keysError && <p className="text-sm text-red-400">{keysError}</p>}
      {actionError && <p className="text-sm text-red-400">{actionError}</p>}

      <Card className="border-slate-800 bg-[#0d1524]">
        <CardHeader>
          <CardTitle className="text-base text-white">Keys</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingKeys ? (
            <div className="flex justify-center py-8 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : keys.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No keys yet. Create one to start sending requests.
            </p>
          ) : (
            <div className="divide-y divide-slate-800">
              {keys.map((k) => (
                <div key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-200">{k.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-slate-500">
                      {k.key_prefix}••••••••
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">
                      {k.last_used_at
                        ? `Last used ${new Date(k.last_used_at).toLocaleDateString()}`
                        : 'Never used'}
                    </span>
                    {k.revoked_at ? (
                      <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-300">
                        Revoked
                      </Badge>
                    ) : canEdit ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRevokeTarget(k)}
                        className="h-8 text-red-400 hover:bg-red-950/40 hover:text-red-300"
                      >
                        <Ban className="mr-1.5 h-3.5 w-3.5" />
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="border-slate-800 bg-[#0d1524] text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription className="text-slate-400">
              Give the key a name so you can recognize it later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {createError && (
              <p className="rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                {createError}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Key name</Label>
              <Input
                id="key-name"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="Production backend"
                className="border-slate-700 bg-[#0a0f1a]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !keyName.trim()}
              className="bg-emerald-500 text-[#06281f] hover:bg-emerald-400"
            >
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newSecret !== null} onOpenChange={(open) => !open && setNewSecret(null)}>
        <DialogContent className="border-slate-800 bg-[#0d1524] text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-emerald-400" />
              Save your key now
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              This is the only time the full key is shown. Copy it somewhere safe — it cannot be
              retrieved again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-slate-700 bg-[#0a0f1a] px-3 py-2.5 font-mono text-xs text-emerald-300">
              {newSecret}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (newSecret && navigator.clipboard) {
                  await navigator.clipboard.writeText(newSecret);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }
              }}
              className="shrink-0 border-slate-700"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <DialogFooter>
            <Button
              onClick={() => setNewSecret(null)}
              className="bg-emerald-500 text-[#06281f] hover:bg-emerald-400"
            >
              I&apos;ve saved it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revokeTarget !== null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent className="border-slate-800 bg-[#0d1524] text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{revokeTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Any service using this key will immediately start receiving 401 responses. This
              cannot be undone — create a new key to replace it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleRevoke();
              }}
              className="bg-red-600 hover:bg-red-500"
              disabled={revoking}
            >
              {revoking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
