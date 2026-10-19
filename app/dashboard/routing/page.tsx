'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, GripVertical } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { getSupabase } from '@/lib/supabase';
import { PROVIDERS, PROVIDER_LABELS, type Provider, type RoutingRule } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const PROVIDER_MODELS: Record<Provider, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'],
  anthropic: [
    'claude-sonnet-4-5',
    'claude-3-5-haiku-latest',
    'claude-3-7-sonnet-latest',
    'claude-3-5-sonnet-latest',
  ],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
};

interface DraftRule {
  provider: Provider;
  provider_model: string;
}

export default function RoutingPage() {
  const { project, canEdit, loading } = useWorkspace();
  const supabase = getSupabase();

  const [alias, setAlias] = useState('');
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<DraftRule[]>([{ provider: 'openai', provider_model: PROVIDER_MODELS.openai[0] }]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    if (!project) return;
    setLoadingRules(true);
    setRulesError(null);
    try {
      const { data, error } = await supabase
        .from('routing_rules')
        .select('id, project_id, model_alias, provider, provider_model, priority, enabled, created_at')
        .eq('project_id', project.id)
        .order('model_alias')
        .order('priority');
      if (error) throw error;
      setRules((data ?? []) as RoutingRule[]);
    } catch (err) {
      setRulesError(err instanceof Error ? err.message : 'Could not load routing rules');
    } finally {
      setLoadingRules(false);
    }
  }, [project, supabase]);

  useEffect(() => {
    (async () => {
      await loadRules();
    })();
  }, [loadRules]);

  const byAlias = new Map<string, RoutingRule[]>();
  for (const r of rules) {
    const list = byAlias.get(r.model_alias) ?? [];
    list.push(r);
    byAlias.set(r.model_alias, list);
  }

  async function saveChain() {
    if (!project || !alias.trim()) return;
    setSaving(true);
    setSaveError(null);
    setSaveOk(null);
    try {
      const basePriority = rules.length ? Math.min(...rules.map((r) => r.priority)) - 100 : 0;
      const rows = drafts.map((d, i) => ({
        project_id: project.id,
        model_alias: alias.trim(),
        provider: d.provider,
        provider_model: d.provider_model,
        priority: basePriority + i,
        enabled: true,
      }));
      const { error } = await supabase.from('routing_rules').insert(rows);
      if (error) throw error;
      setAlias('');
      setDrafts([{ provider: 'openai', provider_model: PROVIDER_MODELS.openai[0] }]);
      setSaveOk(`Failover chain for "${alias.trim()}" saved.`);
      await loadRules();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save the chain');
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule: RoutingRule, enabled: boolean) {
    await supabase.from('routing_rules').update({ enabled }).eq('id', rule.id);
    await loadRules();
  }

  async function deleteRule(rule: RoutingRule) {
    await supabase.from('routing_rules').delete().eq('id', rule.id);
    await loadRules();
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
          Create a project first, then configure routing.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400">
        A failover chain maps a model alias your app sends (e.g. <code className="text-slate-300">fast-chat</code>)
        to an ordered list of provider models. The gateway tries each in order until one succeeds.
      </p>

      {canEdit && (
        <Card className="border-slate-800 bg-[#0d1524]">
          <CardHeader>
            <CardTitle className="text-base text-white">New failover chain</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {saveError && <p className="text-sm text-red-400">{saveError}</p>}
            {saveOk && <p className="text-sm text-emerald-400">{saveOk}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="alias">Model alias</Label>
              <Input
                id="alias"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="fast-chat"
                className="max-w-xs border-slate-700 bg-[#0a0f1a]"
              />
            </div>

            <div className="space-y-2">
              {drafts.map((d, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <span className="w-6 text-xs text-slate-500">{i + 1}</span>
                  <Select
                    value={d.provider}
                    onValueChange={(v) => {
                      const provider = v as Provider;
                      setDrafts((prev) =>
                        prev.map((p, j) =>
                          j === i ? { provider, provider_model: PROVIDER_MODELS[provider][0] } : p
                        )
                      );
                    }}
                  >
                    <SelectTrigger className="w-40 border-slate-700 bg-[#0a0f1a]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-slate-800 bg-[#0d1524] text-slate-100">
                      {PROVIDERS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {PROVIDER_LABELS[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={d.provider_model}
                    onValueChange={(v) =>
                      setDrafts((prev) => prev.map((p, j) => (j === i ? { ...p, provider_model: v } : p)))
                    }
                  >
                    <SelectTrigger className="w-56 border-slate-700 bg-[#0a0f1a]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-slate-800 bg-[#0d1524] text-slate-100">
                      {PROVIDER_MODELS[d.provider].map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {drafts.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDrafts((prev) => prev.filter((_, j) => j !== i))}
                      className="h-9 px-2 text-slate-500 hover:text-red-300"
                      aria-label="Remove this step"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setDrafts((prev) => [...prev, { provider: 'openai', provider_model: PROVIDER_MODELS.openai[0] }])
                }
                className="border-slate-700"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add fallback step
              </Button>
              <Button
                onClick={saveChain}
                disabled={saving || !alias.trim()}
                className="bg-emerald-500 text-[#06281f] hover:bg-emerald-400"
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save chain
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-800 bg-[#0d1524]">
        <CardHeader>
          <CardTitle className="text-base text-white">Configured aliases</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingRules ? (
            <div className="flex justify-center py-8 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : rulesError ? (
            <p className="text-sm text-red-400">{rulesError}</p>
          ) : byAlias.size === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No routing configured yet for this project.
            </p>
          ) : (
            <div className="space-y-6">
              {Array.from(byAlias.entries()).map(([aliasName, chain]) => (
                <div key={aliasName}>
                  <p className="mb-2 font-mono text-sm text-emerald-300">{aliasName}</p>
                  <div className="space-y-1.5">
                    {chain.map((r: RoutingRule, i: number) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#0a0f1a] px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="text-xs text-slate-600">{i + 1}</span>
                          <span className="truncate text-sm text-slate-200">
                            <span className="capitalize text-slate-400">{r.provider}</span>
                            <span className="mx-2 text-slate-600">/</span>
                            <span className="font-mono text-xs">{r.provider_model}</span>
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Switch
                            checked={r.enabled}
                            onCheckedChange={(v) => toggleRule(r, v)}
                            disabled={!canEdit}
                            aria-label="Enable rule"
                          />
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteRule(r)}
                              className="h-8 px-2 text-slate-500 hover:text-red-300"
                              aria-label="Delete rule"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
