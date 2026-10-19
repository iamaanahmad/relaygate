import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_BODY_BYTES = 1_000_000; // 1 MB
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_CHAIN_LENGTH = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const CONCURRENCY_LIMIT_PER_KEY = 5;
// Bounded in-memory maps (keys belong to the same project, so entries are few).
// Oldest entries are pruned to keep memory bounded.
const MAX_RATE_LIMIT_ENTRIES = 10_000;
const rateLimitWindows = new Map<string, { count: number; windowStart: number }>();
const activePerKey = new Map<string, number>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(message: string, status = 400) {
  return json({ error: message }, status);
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GatewayRequest {
  project_id: string;
  model_alias: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

interface FailoverAttempt {
  provider: string;
  model: string;
  outcome: string;
  http_status?: number;
}

interface NormalizedResult {
  content: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function callOpenAI(
  apiKey: string,
  model: string,
  req: GatewayRequest
): Promise<{ response?: NormalizedResult; status: number; error?: string }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: req.messages,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.max_tokens !== undefined ? { max_tokens: req.max_tokens } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.error?.message ?? `OpenAI error ${res.status}`;
    return { status: res.status, error: String(msg) };
  }
  const content = body?.choices?.[0]?.message?.content;
  return {
    response: {
      content: typeof content === "string" ? content : null,
      prompt_tokens: body?.usage?.prompt_tokens ?? null,
      completion_tokens: body?.usage?.completion_tokens ?? null,
    },
    status: res.status,
  };
}

async function callAnthropic(
  apiKey: string,
  model: string,
  req: GatewayRequest
): Promise<{ response?: NormalizedResult; status: number; error?: string }> {
  const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const rest = req.messages.filter((m) => m.role !== "system");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: req.max_tokens ?? 1024,
      ...(system ? { system } : {}),
      messages: rest,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.error?.message ?? `Anthropic error ${res.status}`;
    return { status: res.status, error: String(msg) };
  }
  const content = body?.content?.[0]?.text;
  return {
    response: {
      content: typeof content === "string" ? content : null,
      prompt_tokens: body?.usage?.input_tokens ?? null,
      completion_tokens: body?.usage?.output_tokens ?? null,
    },
    status: res.status,
  };
}

async function callGemini(
  apiKey: string,
  model: string,
  req: GatewayRequest
): Promise<{ response?: NormalizedResult; status: number; error?: string }> {
  const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const contents = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(contents.length ? { contents } : {}),
        ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
        generationConfig: {
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.max_tokens !== undefined ? { maxOutputTokens: req.max_tokens } : {}),
        },
      }),
    }
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.error?.message ?? `Gemini error ${res.status}`;
    return { status: res.status, error: String(msg) };
  }
  const parts = body?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("");
  const usage = body?.usageMetadata ?? {};
  return {
    response: {
      content: text || null,
      prompt_tokens: usage.promptTokenCount ?? null,
      completion_tokens: usage.candidatesTokenCount ?? null,
    },
    status: res.status,
  };
}

const CALLERS: Record<
  string,
  (apiKey: string, model: string, req: GatewayRequest) => Promise<{ response?: NormalizedResult; status: number; error?: string }>
> = {
  openai: callOpenAI,
  anthropic: callAnthropic,
  gemini: callGemini,
};

async function authenticateGatewayKey(
  admin: ReturnType<typeof createClient>,
  header: string | null
) {
  if (!header) return null;
  const raw = header.replace(/^Bearer\s+/i, "").trim();
  if (!raw.startsWith("gw_")) return null;
  const hash = await sha256Hex(raw);
  const { data } = await admin
    .from("api_keys")
    .select("id, project_id, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  return data;
}

function pruneRateLimitWindows(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitWindows) {
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) rateLimitWindows.delete(key);
  }
  while (rateLimitWindows.size > MAX_RATE_LIMIT_ENTRIES) {
    const oldest = rateLimitWindows.keys().next().value;
    if (oldest === undefined) break;
    rateLimitWindows.delete(oldest);
  }
}

function checkRateLimit(keyId: string): boolean {
  const now = Date.now();
  const entry = rateLimitWindows.get(keyId);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    pruneRateLimitWindows();
    rateLimitWindows.set(keyId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) return false;
  entry.count += 1;
  return true;
}

function tryAcquireConcurrency(keyId: string): boolean {
  const current = activePerKey.get(keyId) ?? 0;
  if (current >= CONCURRENCY_LIMIT_PER_KEY) return false;
  activePerKey.set(keyId, current + 1);
  return true;
}

function releaseConcurrency(keyId: string): void {
  const current = activePerKey.get(keyId) ?? 0;
  if (current <= 1) activePerKey.delete(keyId);
  else activePerKey.set(keyId, current - 1);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function processGatewayRequest(
  admin: ReturnType<typeof createClient>,
  gatewayKey: { id: string; project_id: string },
  body: GatewayRequest,
  started: number
): Promise<Response> {
  // Load the failover chain for this project + alias.
  const { data: rules, error: rulesErr } = await admin
    .from("routing_rules")
    .select("provider, provider_model, priority, enabled")
    .eq("project_id", body.project_id)
    .eq("model_alias", body.model_alias)
    .order("priority", { ascending: true });
  if (rulesErr) return fail("Could not load routing rules", 500);

  const chain = (rules ?? []).filter((r) => r.enabled).slice(0, MAX_CHAIN_LENGTH);
  if (!chain.length) {
    return fail(
      `No routing rules configured for model alias "${body.model_alias}" in this project`,
      404
    );
  }

  // Group rules by provider; load one decrypted key per provider used.
  const providersNeeded = [...new Set(chain.map((r) => r.provider))];
  const { data: connections, error: connErr } = await admin
    .from("provider_connections")
    .select("provider, encrypted_api_key")
    .eq("workspace_id", (
      await admin.from("projects").select("workspace_id").eq("id", body.project_id).maybeSingle()
    )?.data?.workspace_id ?? "")
    .in("provider", providersNeeded);
  if (connErr) return fail("Could not load provider connections", 500);

  const { data: secretRow } = await admin
    .from("gateway_secrets")
    .select("master_key_hex")
    .eq("id", 1)
    .maybeSingle();
  if (!secretRow) return fail("Server encryption key not configured", 500);
  const masterKey = hexToBytes(secretRow.master_key_hex);
  const aesKey = await crypto.subtle.importKey("raw", masterKey, "AES-GCM", false, ["decrypt"]);

  const providerKeys: Record<string, string> = {};
  for (const conn of connections ?? []) {
    try {
      const [ivB64, ctB64] = conn.encrypted_api_key.split(".");
      const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
      const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ct);
      providerKeys[conn.provider] = new TextDecoder().decode(plain);
    } catch {
      continue; // skip undecryptable; chain continues to next provider
    }
  }

  const failoverChain: FailoverAttempt[] = [];
  let lastError = "All providers in the failover chain failed";

  for (const rule of chain) {
    const apiKey = providerKeys[rule.provider];
    if (!apiKey) {
      failoverChain.push({
        provider: rule.provider,
        model: rule.provider_model,
        outcome: "no_credentials",
      });
      continue;
    }

    const caller = CALLERS[rule.provider];
    if (!caller) {
      failoverChain.push({ provider: rule.provider, model: rule.provider_model, outcome: "unsupported_provider" });
      continue;
    }

    try {
      const result = await caller(apiKey, rule.provider_model, body);
      failoverChain.push({
        provider: rule.provider,
        model: rule.provider_model,
        outcome: result.response ? "success" : `http_${result.status}`,
        http_status: result.status,
      });

      if (result.response) {
        const latency = Date.now() - started;
        await admin.from("request_logs").insert({
          project_id: gatewayKey.project_id,
          provider: rule.provider,
          model: rule.provider_model,
          status: "success",
          http_status: result.status,
          latency_ms: latency,
          prompt_tokens: result.response.prompt_tokens,
          completion_tokens: result.response.completion_tokens,
          failover_chain: failoverChain,
        });
        await admin
          .from("api_keys")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", gatewayKey.id);

        return json({
          content: result.response.content,
          provider: rule.provider,
          model: rule.provider_model,
          model_alias: body.model_alias,
          usage: {
            prompt_tokens: result.response.prompt_tokens,
            completion_tokens: result.response.completion_tokens,
          },
          failover_chain: failoverChain,
          latency_ms: latency,
        });
      }

      lastError = result.error ?? lastError;
      if (!isRetryableStatus(result.status)) break; // non-retryable: stop the chain
    } catch (err) {
      failoverChain.push({
        provider: rule.provider,
        model: rule.provider_model,
        outcome: "timeout_or_network",
      });
      lastError = err instanceof Error ? err.message : "network error";
    }
  }

  // Chain exhausted without success — log the failure.
  await admin.from("request_logs").insert({
    project_id: gatewayKey.project_id,
    provider: failoverChain[failoverChain.length - 1]?.provider ?? "none",
    model: failoverChain[failoverChain.length - 1]?.model ?? "none",
    status: "failed",
    latency_ms: Date.now() - started,
    failover_chain: failoverChain,
    error_message: lastError,
  });

  return fail(`All failover attempts failed. Last error: ${lastError}`, 502);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  const started = Date.now();
  try {
    const contentLength = req.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
      return fail("Request body too large", 413);
    }

    let raw: string;
    try {
      raw = await req.text();
    } catch {
      return fail("Could not read request body", 400);
    }
    if (raw.length > MAX_BODY_BYTES) return fail("Request body too large", 413);

    let body: GatewayRequest;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail("Invalid JSON body");
    }

    if (
      !body ||
      typeof body.project_id !== "string" ||
      typeof body.model_alias !== "string" ||
      !Array.isArray(body.messages)
    ) {
      return fail("project_id, model_alias, and messages are required");
    }
    if (!body.messages.length || body.messages.length > 100) {
      return fail("messages must contain 1-100 items");
    }
    for (const m of body.messages) {
      if (
        !m ||
        typeof m.content !== "string" ||
        !["system", "user", "assistant"].includes(m.role)
      ) {
        return fail("Each message needs role (system/user/assistant) and string content");
      }
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const gatewayKey = await authenticateGatewayKey(admin, req.headers.get("Authorization"));
    if (!gatewayKey) return fail("Invalid or revoked gateway API key", 401);
    if (gatewayKey.project_id !== body.project_id) {
      return fail("This API key is not valid for the given project", 403);
    }

    if (!checkRateLimit(gatewayKey.id)) {
      return fail("Rate limit exceeded. Try again shortly.", 429);
    }
    if (!tryAcquireConcurrency(gatewayKey.id)) {
      return fail("Too many concurrent requests for this API key", 429);
    }
    try {
      const result = await processGatewayRequest(admin, gatewayKey, body, started);
      releaseConcurrency(gatewayKey.id);
      return result;
    } catch (e) {
      releaseConcurrency(gatewayKey.id);
      throw e;
    }
  } catch (err) {
    console.error("gateway error:", err);
    return fail("Internal error", 500);
  }
});

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error("invalid master key");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
