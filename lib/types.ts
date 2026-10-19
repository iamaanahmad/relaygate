export type Role = 'owner' | 'admin' | 'developer' | 'viewer';

export const PROVIDERS = ['openai', 'anthropic', 'gemini'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
};

export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: Role;
  created_at: string;
  email?: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  created_at: string;
}

export interface ProviderConnection {
  id: string;
  workspace_id: string;
  provider: Provider;
  key_hint: string;
  status: 'unvalidated' | 'valid' | 'invalid';
  last_validated_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RoutingRule {
  id: string;
  project_id: string;
  model_alias: string;
  provider: Provider;
  provider_model: string;
  priority: number;
  enabled: boolean;
  created_at: string;
}

export interface ApiKey {
  id: string;
  project_id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface FailoverAttempt {
  provider: string;
  model: string;
  outcome: string;
  http_status?: number;
}

export interface RequestLog {
  id: string;
  project_id: string | null;
  provider: string;
  model: string;
  status: 'success' | 'failed';
  http_status: number | null;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  failover_chain: FailoverAttempt[] | null;
  error_message: string | null;
  created_at: string;
}

export interface GatewayUsage {
  total_requests: number;
  success_rate: number | null;
  avg_latency_ms: number | null;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  by_provider: { provider: string; count: number }[];
  daily: { day: string; count: number; failures: number }[];
}
