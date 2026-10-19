import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PROVIDERS = ["openai", "anthropic", "gemini"] as const;
type Provider = (typeof PROVIDERS)[number];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(message: string, status = 400) {
  return json({ error: message }, status);
}

async function validateProviderKey(
  provider: Provider,
  apiKey: string
): Promise<{ ok: boolean; detail: string }> {
  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401) return { ok: false, detail: "Key rejected by OpenAI (unauthorized)" };
      if (res.status === 429) return { ok: false, detail: "OpenAI rate-limited the validation request" };
      return res.ok
        ? { ok: true, detail: "Validated against OpenAI models endpoint" }
        : { ok: false, detail: `OpenAI returned status ${res.status}` };
    }

    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401) return { ok: false, detail: "Key rejected by Anthropic (unauthorized)" };
      return res.ok
        ? { ok: true, detail: "Validated against Anthropic models endpoint" }
        : { ok: false, detail: `Anthropic returned status ${res.status}` };
    }

    // gemini
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (res.status === 400 || res.status === 403) {
      return { ok: false, detail: "Key rejected by Google (invalid or restricted)" };
    }
    return res.ok
      ? { ok: true, detail: "Validated against Google Generative Language API" }
      : { ok: false, detail: `Google returned status ${res.status}` };
  } catch {
    return { ok: false, detail: "Could not reach the provider. Check network access and try again." };
  }
}

async function authenticatedUser(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data } = await supabase.auth.getUser(token);
  return data?.user ?? null;
}

async function requireRole(admin: ReturnType<typeof createClient>, workspaceId: string, userId: string) {
  const { data } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.role ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  try {
    const user = await authenticatedUser(req);
    if (!user) return fail("Authentication required", 401);

    let body: { action?: unknown; workspace_id?: unknown; provider?: unknown; api_key?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail("Invalid JSON body");
    }

    const action = typeof body.action === "string" ? body.action : "";
    const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
    if (!workspaceId) return fail("workspace_id is required");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const role = await requireRole(admin, workspaceId, user.id);
    if (!role) return fail("You do not have access to this workspace", 403);
    if (role === "viewer") return fail("Viewers cannot manage provider keys", 403);

    if (action === "add") {
      const provider = typeof body.provider === "string" ? (body.provider as Provider) : null;
      const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";
      if (!provider || !PROVIDERS.includes(provider)) return fail("Unsupported provider");
      if (!apiKey || apiKey.length < 10 || apiKey.length > 512) {
        return fail("API key looks invalid");
      }

      const validation = await validateProviderKey(provider, apiKey);
      if (!validation.ok) {
        return fail(validation.detail, 400);
      }

      // Encrypt: AES-256-GCM with the master key from gateway_secrets.
      const { data: secretRow, error: secretErr } = await admin
        .from("gateway_secrets")
        .select("master_key_hex")
        .eq("id", 1)
        .maybeSingle();
      if (secretErr || !secretRow) return fail("Encryption key not configured", 500);

      const masterKey = hexToBytes(secretRow.master_key_hex);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await crypto.subtle.importKey("raw", masterKey, "AES-GCM", false, ["encrypt"]);
      const plaintext = new TextEncoder().encode(apiKey);
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext)
      );
      // Store as: base64(iv) + "." + base64(ciphertext+tag)
      const b64 = (arr: Uint8Array) => btoa(String.fromCharCode(...arr));
      const encrypted = `${b64(iv)}.${b64(ciphertext)}`;

      const { error: upsertErr } = await admin.from("provider_connections").upsert(
        {
          workspace_id: workspaceId,
          provider,
          encrypted_api_key: encrypted,
          key_hint: apiKey.slice(-4),
          status: "valid",
          last_validated_at: new Date().toISOString(),
          created_by: user.id,
        },
        { onConflict: "workspace_id,provider" }
      );
      if (upsertErr) return fail("Could not save the provider connection", 500);

      return json({ ok: true, provider, key_hint: apiKey.slice(-4) });
    }

    if (action === "delete") {
      const connectionId = typeof body.connection_id === "string" ? body.connection_id : "";
      if (!connectionId) return fail("connection_id is required");
      const { error: delErr } = await admin
        .from("provider_connections")
        .delete()
        .eq("id", connectionId)
        .eq("workspace_id", workspaceId);
      if (delErr) return fail("Could not remove the connection", 500);
      return json({ ok: true });
    }

    return fail("Unknown action");
  } catch (err) {
    console.error("provider-keys error:", err);
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
