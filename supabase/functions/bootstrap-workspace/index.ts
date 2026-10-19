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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return fail("Authentication required", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return fail("Invalid or expired session", 401);
    const userId = userData.user.id;

    let body: { workspace_name?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail("Invalid JSON body");
    }
    const name = typeof body.workspace_name === "string" ? body.workspace_name.trim() : "";
    if (!name || name.length > 100) return fail("Workspace name must be 1-100 characters");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // One workspace per user for the first release; enforce server-side.
    const { data: existing } = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .limit(1);

    if (existing && existing.length > 0) {
      return json({ workspace_id: existing[0].workspace_id, created: false });
    }

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name, owner_id: userId })
      .select("id")
      .single();
    if (wsErr || !workspace) return fail("Could not create workspace", 500);

    const { error: memberErr } = await admin
      .from("workspace_members")
      .insert({ workspace_id: workspace.id, user_id: userId, role: "owner" });
    if (memberErr) return fail("Could not set up workspace membership", 500);

    return json({ workspace_id: workspace.id, created: true });
  } catch (err) {
    console.error("bootstrap-workspace error:", err);
    return fail("Internal error", 500);
  }
});
