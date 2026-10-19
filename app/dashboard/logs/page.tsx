'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { getSupabase } from '@/lib/supabase';
import type { RequestLog } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 25;

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function LogsPage() {
  const { project } = useWorkspace();
  const supabase = getSupabase();
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!project) {
      setLogs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('request_logs')
        .select('id, project_id, provider, model, status, http_status, latency_ms, prompt_tokens, completion_tokens, failover_chain, error_message, created_at')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      if (error) throw error;
      const rows = (data ?? []) as RequestLog[];
      setLogs(rows);
      setHasMore(rows.length === PAGE_SIZE + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load logs');
    } finally {
      setLoading(false);
    }
  }, [project, page]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  if (!project) {
    return (
      <Card className="border-slate-800 bg-[#0d1524]">
        <CardContent className="py-10 text-center text-slate-400">
          Select a project to see its request logs.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-400">{error}</p>}

      <Card className="border-slate-800 bg-[#0d1524]">
        <CardContent className="py-2">
          {loading ? (
            <div className="flex justify-center py-10 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : logs.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              No requests logged yet for this project.
            </p>
          ) : (
            <div className="divide-y divide-slate-800">
              {logs.map((log) => (
                <div key={log.id}>
                  <button
                    onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                    className="flex w-full items-center justify-between gap-3 py-3 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {log.status === 'success' ? (
                        <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300" variant="outline">
                          OK
                        </Badge>
                      ) : (
                        <Badge className="border-red-500/40 bg-red-500/10 text-red-300" variant="outline">
                          FAIL
                        </Badge>
                      )}
                      <span className="min-w-0 truncate text-sm text-slate-200">
                        <span className="capitalize text-slate-400">{log.provider}</span>
                        <span className="mx-1.5 text-slate-600">/</span>
                        <span className="font-mono text-xs">{log.model}</span>
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-4 text-xs text-slate-500">
                      <span>{log.latency_ms != null ? `${log.latency_ms} ms` : '—'}</span>
                      <span>
                        {log.prompt_tokens != null || log.completion_tokens != null
                          ? `${log.prompt_tokens ?? 0}↑ ${log.completion_tokens ?? 0}↓`
                          : ''}
                      </span>
                      <span>{timeAgo(log.created_at)}</span>
                    </div>
                  </button>
                  {expanded === log.id && (
                    <div className="pb-4 pl-2">
                      {log.failover_chain && log.failover_chain.length > 0 && (
                        <div className="mb-2">
                          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                            Failover trail
                          </p>
                          <ol className="space-y-1">
                            {log.failover_chain.map((a, i) => (
                              <li key={i} className="text-xs text-slate-400">
                                {i + 1}. <span className="capitalize">{a.provider}</span>
                                <span className="mx-1 font-mono text-slate-500">{a.model}</span>
                                <span
                                  className={
                                    a.outcome === 'success' ? 'text-emerald-400' : 'text-amber-400'
                                  }
                                >
                                  {a.outcome}
                                  {a.http_status ? ` (${a.http_status})` : ''}
                                </span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                      {log.error_message && (
                        <p className="rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                          {log.error_message}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {(page > 0 || hasMore) && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="border-slate-700"
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <span className="text-xs text-slate-500">Page {page + 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasMore || loading}
            onClick={() => setPage((p) => p + 1)}
            className="border-slate-700"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
