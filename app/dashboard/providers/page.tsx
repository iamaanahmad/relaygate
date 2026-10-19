'use client';

import { useState } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { useEdgeFunction } from '@/lib/edge-client';
import { PROVIDER_LABELS, PROVIDERS, type Provider } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
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
import { Loader2, Plus, Trash2, ShieldCheck, ShieldX, ShieldQuestion } from 'lucide-react';

export default function ProvidersPage() {
  const { workspace, connections, canEdit, refresh, loading } = useWorkspace();
  const callEdge = useEdgeFunction();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newProvider, setNewProvider] = useState<Provider>('openai');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; provider: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleAdd() {
    if (!workspace) return;
    setError(null);
    setBusy(true);
    try {
      await callEdge('provider-keys', {
        body: {
          action: 'add',
          workspace_id: workspace.id,
          provider: newProvider,
          api_key: apiKey.trim(),
        },
      });
      await refresh();
      setDialogOpen(false);
      setApiKey('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the key');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!workspace || !deleteTarget) return;
    setDeleting(true);
    try {
      await callEdge('provider-keys', {
        body: {
          action: 'delete',
          workspace_id: workspace.id,
          connection_id: deleteTarget.id,
        },
      });
      await refresh();
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the connection');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Keys are validated against the provider, then encrypted before storage. Only the last 4
          characters are ever shown again.
        </p>
        {canEdit && (
          <Button
            onClick={() => {
              setError(null);
              setApiKey('');
              setDialogOpen(true);
            }}
            className="shrink-0 bg-emerald-500 text-[#06281f] hover:bg-emerald-400"
          >
            <Plus className="mr-2 h-4 w-4" />
            Connect key
          </Button>
        )}
      </div>

      {error && !dialogOpen && (
        <p className="rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {PROVIDERS.map((provider) => {
          const conn = connections.find((c) => c.provider === provider);
          return (
            <Card key={provider} className="border-slate-800 bg-[#0d1524]">
              <CardContent className="py-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-white">{PROVIDER_LABELS[provider]}</p>
                    {conn ? (
                      <p className="mt-1 text-xs text-slate-500">
                        •••• {conn.key_hint} · added {new Date(conn.created_at).toLocaleDateString()}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-slate-600">Not connected</p>
                    )}
                  </div>
                  {conn && (
                    <StatusBadge
                      status={conn.status}
                      validatedAt={conn.last_validated_at}
                    />
                  )}
                </div>
                {conn && canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteTarget({ id: conn.id, provider })}
                    className="mt-4 h-8 text-red-400 hover:bg-red-950/40 hover:text-red-300"
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Remove
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-slate-800 bg-[#0d1524] text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect a provider key</DialogTitle>
            <DialogDescription className="text-slate-400">
              The key is validated with the provider first. If validation fails, nothing is stored.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {error && (
              <p className="rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="provider">Provider</Label>
              <select
                id="provider"
                value={newProvider}
                onChange={(e) => setNewProvider(e.target.value as Provider)}
                className="w-full rounded-md border border-slate-700 bg-[#0a0f1a] px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="apikey">API key</Label>
              <Input
                id="apikey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={busy || !apiKey.trim()}
              className="bg-emerald-500 text-[#06281f] hover:bg-emerald-400"
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Validate and save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="border-slate-800 bg-[#0d1524] text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget ? PROVIDER_LABELS[deleteTarget.provider as Provider] : ''} connection?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Routing rules using this provider will fail over to the next rule in the chain. The
              encrypted key is deleted permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              className="bg-red-600 hover:bg-red-500"
              disabled={deleting}
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove connection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatusBadge({
  status,
  validatedAt,
}: {
  status: 'unvalidated' | 'valid' | 'invalid';
  validatedAt: string | null;
}) {
  if (status === 'valid') {
    return (
      <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300" variant="outline">
        <ShieldCheck className="mr-1 h-3 w-3" />
        Valid
      </Badge>
    );
  }
  if (status === 'invalid') {
    return (
      <Badge className="border-red-500/40 bg-red-500/10 text-red-300" variant="outline">
        <ShieldX className="mr-1 h-3 w-3" />
        Invalid
      </Badge>
    );
  }
  return (
    <Badge className="border-slate-600 bg-slate-800 text-slate-300" variant="outline">
      <ShieldQuestion className="mr-1 h-3 w-3" />
      Unvalidated
    </Badge>
  );
}
