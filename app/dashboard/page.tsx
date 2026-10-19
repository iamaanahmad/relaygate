'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/lib/workspace-context';
import { useAuth } from '@/lib/auth-context';
import { getSupabase } from '@/lib/supabase';
import type { GatewayUsage, Project, RequestLog } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Activity, Clock, Zap, ShieldCheck, Plus, AlertTriangle } from 'lucide-react';

export default function OverviewPage() {
  const { workspace, projects, project, role, connections, loading: wsLoading, setProjectId, refresh } = useWorkspace();
  const { user } = useAuth();
  const [usage, setUsage] = useState<GatewayUsage | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const activeProjectId = project?.id ?? projects[0]?.id ?? null;

  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    setLoadingUsage(true);
    setUsageError(null);
    (async () => {
      try {
        const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
        const { data, error } = await getSupabase()
          .from('request_logs')
          .select('provider, status, latency_ms, prompt_tokens, completion_tokens, created_at')
          .eq('project_id', activeProjectId)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(5000);
        if (error) throw error;
        if (cancelled) return;
        const rows = (data ?? []) as Pick<
          RequestLog,
          'provider' | 'status' | 'latency_ms' | 'prompt_tokens' | 'completion_tokens' | 'created_at'
        >[];
        const successes = rows.filter((r) => r.status === 'success');
        const byProvider = new Map<string, number>();
        const byDay = new Map<string, { count: number; failures: number }>();
        for (let i = 13; i >= 0; i--) {
          const d = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
          byDay.set(d, { count: 0, failures: 0 });
        }
        for (const r of rows) {
          byProvider.set(r.provider, (byProvider.get(r.provider) ?? 0) + 1);
          const day = (r.created_at ?? '').slice(0, 10);
          const entry = byDay.get(day);
          if (entry) {
            entry.count += 1;
            if (r.status !== 'success') entry.failures += 1;
          }
        }
        setUsage({
          total_requests: rows.length,
          success_rate: rows.length ? successes.length / rows.length : null,
          avg_latency_ms: successes.length
            ? successes.reduce((sum, r) => sum + (r.latency_ms ?? 0), 0) / successes.length
            : null,
          total_prompt_tokens: rows.reduce((sum, r) => sum + (r.prompt_tokens ?? 0), 0),
          total_completion_tokens: rows.reduce((sum, r) => sum + (r.completion_tokens ?? 0), 0),
          by_provider: Array.from(byProvider.entries()).map(([provider, count]) => ({ provider, count })),
          daily: Array.from(byDay.entries()).map(([day, v]) => ({ day, ...v })),
        });
      } catch (err) {
        if (!cancelled) setUsageError(err instanceof Error ? err.message : 'Could not load usage');
      } finally {
        if (!cancelled) setLoadingUsage(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  async function createProject() {
    if (!workspace) return;
    setCreating(true);
    setCreateError(null);
    try {
      const supabase = getSupabase();
      const name = `Project ${projects.length + 1}`;
      const { data, error } = await supabase
        .from('projects')
        .insert({ workspace_id: workspace.id, name })
        .select('id')
        .single();
      if (error) throw error;
      await refresh();
      if (data) setProjectId(data.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create the project');
    } finally {
      setCreating(false);
    }
  }

  if (wsLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <Card className="border-slate-800 bg-[#0d1524]">
        <CardContent className="py-10 text-center text-slate-400">
          <p>No workspace yet.</p>
          <Link href="/signup" className="mt-3 inline-block text-emerald-400 hover:underline">
            Create one to get started
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (projects.length === 0) {
    return (
      <Card className="border-slate-800 bg-[#0d1524]">
        <CardContent className="py-12 text-center">
          <p className="text-slate-300">Create your first project to issue API keys and route requests.</p>
          {createError && <p className="mt-2 text-sm text-red-400">{createError}</p>}
          <Button onClick={createProject} disabled={creating} className="mt-4 bg-emerald-500 text-[#06281f] hover:bg-emerald-400">
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Create project
          </Button>
        </CardContent>
      </Card>
    );
  }

  const maxDaily = Math.max(1, ...(usage?.daily.map((d) => d.count) ?? [1]));

  return (
    <div className="space-y-6">
      {(connections.length === 0 || !usage?.total_requests) && (
        <Card className="border-emerald-900/50 bg-emerald-950/20">
          <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-emerald-200">
              {connections.length === 0
                ? 'Connect a provider key to start routing requests.'
                : 'Issue an API key and point your app at the gateway endpoint.'}
            </div>
            <Link
              href={connections.length === 0 ? '/dashboard/providers' : '/dashboard/api-keys'}
              className="shrink-0 rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-[#06281f] hover:bg-emerald-400"
            >
              {connections.length === 0 ? 'Connect provider' : 'Create API key'}
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Activity}
          label="Requests (14d)"
          value={usage ? usage.total_requests.toLocaleString() : undefined}
        />
        <StatCard
          icon={ShieldCheck}
          label="Success rate"
          value={usage?.success_rate != null ? `${(usage.success_rate * 100).toFixed(1)}%` : undefined}
        />
        <StatCard
          icon={Clock}
          label="Avg latency"
          value={usage?.avg_latency_ms != null ? `${Math.round(usage.avg_latency_ms)} ms` : undefined}
        />
        <StatCard
          icon={Zap}
          label="Tokens (14d)"
          value={
            usage
              ? (usage.total_prompt_tokens + usage.total_completion_tokens).toLocaleString()
              : undefined
          }
        />
      </div>

      <Card className="border-slate-800 bg-[#0d1524]">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-slate-300">Requests per day</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingUsage ? (
            <div className="flex justify-center py-8 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : usageError ? (
            <p className="flex items-center gap-2 text-sm text-red-400">
              <AlertTriangle className="h-4 w-4" /> {usageError}
            </p>
          ) : (
            <div className="flex h-36 items-end gap-1.5">
              {(usage?.daily ?? []).map((d) => (
                <div key={d.day} className="group relative flex-1">
                  <div
                    className="rounded-t bg-emerald-500/70 transition group-hover:bg-emerald-400"
                    style={{ height: `${Math.max(4, (d.count / maxDaily) * 128)}px` }}
                  />
                  <div className="pointer-events-none absolute -top-8 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 opacity-0 transition group-hover:opacity-100">
                    {d.day.slice(5)}: {d.count}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {usage && usage.by_provider.length > 0 && (
        <Card className="border-slate-800 bg-[#0d1524]">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-slate-300">By provider (14d)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {usage.by_provider.map((p) => {
              const pct = usage.total_requests ? (p.count / usage.total_requests) * 100 : 0;
              return (
                <div key={p.provider} className="flex items-center gap-3 text-sm">
                  <span className="w-20 capitalize text-slate-400">{p.provider}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-16 text-right text-slate-400">{p.count.toLocaleString()}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string;
}) {
  return (
    <Card className="border-slate-800 bg-[#0d1524]">
      <CardContent className="flex items-center gap-4 py-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800 text-emerald-400">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
          <p className="truncate text-lg font-semibold text-white">
            {value ?? <span className="text-slate-600">—</span>}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
