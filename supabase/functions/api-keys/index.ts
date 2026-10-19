import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(message: string, status = 400) {
  return json({ error: message }, status);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return fail("Authentication required", 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return fail("Invalid or expired session", 401);
    const userId = userData.user.id;

    let body: { action?: unknown; project_id?: unknown; name?: unknown; key_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail("Invalid JSON body");
    }

    const action = typeof body.action === "string" ? body.action : "";
    const projectId = typeof body.project_id === "string" ? body.project_id : "";
    if (!projectId) return fail("project_id is required");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: project } = await admin
      .from("projects")
      .select("workspace_id")
      .eq("id", projectId)
      .maybeSingle();
    if (!project) return fail("Project not found", 404);

    const { data: membership } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", project.workspace_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) return fail("You do not have access to this project", 403);

    const editor = ["owner", "admin", "developer"].includes(membership.role);
    if (!editor) return fail("Viewers cannot manage API keys", 403);

    if (action === "create") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 100) return fail("Name must be 1-100 characters");

      const raw = `gw_${randomToken()}`;
      const keyHash = await sha256Hex(raw);
      const keyPrefix = raw.slice(0, 10);

      const { data: created, error: insertErr } = await admin
        .from("api_keys")
        .insert({ project_id: projectId, name, key_hash: keyHash, key_prefix: keyPrefix, created_by: userId })
        .select("id, name, key_prefix, created_at")
        .single();
      if (insertErr || !created) return fail("Could not create API key", 500);

      // The plaintext key is returned exactly once and never stored.
      return json({ api_key: raw, key: created });
    }

    if (action === "revoke") {
      const keyId = typeof body.key_id === "string" ? body.key_id : "";
      if (!keyId) return fail("key_id is required");
      const { error: updateErr } = await admin
        .from("api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", keyId)
        .eq("project_id", projectId)
        .is("revoked_at", null);
      if (updateErr) return fail("Could not revoke the key", 500);
      return json({ ok: true });
    }

    if (action === "delete") {
      const keyId = typeof body.key_id === "string" ? body.key_id : "";
      if (!keyId) return fail("key_id is required");
      const { error: delErr } = await admin
        .from("api_keys")
        .delete()
        .eq("id", keyId)
        .eq("project_id", projectId);
      if (delErr) return fail("Could not delete the key", 500);
      return json({ ok: true });
    }

    return fail("Unknown action");
  } catch (err) {
    console.error("api-keys error:", err);
    return fail("Internal error", 500);
  }
});
