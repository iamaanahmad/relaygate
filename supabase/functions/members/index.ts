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
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return fail("Authentication required", 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return fail("Invalid or expired session", 401);
    const userId = userData.user.id;

    let body: {
      action?: unknown;
      workspace_id?: unknown;
      email?: unknown;
      role?: unknown;
      member_id?: unknown;
    };
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

    const { data: myRole } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!myRole) return fail("You do not have access to this workspace", 403);

    if (action === "list") {
      // Any member can see the roster; emails resolved server-side only.
      const { data: members, error: membersErr } = await admin
        .from("workspace_members")
        .select("id, user_id, role, created_at")
        .eq("workspace_id", workspaceId);
      if (membersErr) return fail("Could not load members", 500);

      const roster = [];
      for (const m of members ?? []) {
        const { data: u } = await admin.auth.admin.getUserById(m.user_id);
        roster.push({
          id: m.id,
          user_id: m.user_id,
          role: m.role,
          created_at: m.created_at,
          email: u?.user?.email ?? "unknown",
        });
      }
      return json({ members: roster });
    }

    if (action === "invite") {
      if (!["owner", "admin"].includes(myRole.role)) {
        return fail("Only owners and admins can add members", 403);
      }
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const role = typeof body.role === "string" ? body.role : "";
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid email");
      if (!["admin", "developer", "viewer"].includes(role)) {
        return fail("Role must be admin, developer, or viewer");
      }

      // Find or create the user by email.
      const { data: existing } = await admin.auth.admin.listUsers();
      const match = existing?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
      let targetId = match?.id;

      if (!targetId) {
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          password: crypto.randomUUID(),
        });
        if (createErr || !created?.user) return fail("Could not create the user account", 500);
        targetId = created.user.id;
      }

      // Prevent duplicate membership.
      const { data: already } = await admin
        .from("workspace_members")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", targetId)
        .maybeSingle();
      if (already) return fail("That person is already a member");

      const { error: insertErr } = await admin
        .from("workspace_members")
        .insert({ workspace_id: workspaceId, user_id: targetId, role });
      if (insertErr) return fail("Could not add the member", 500);
      return json({ ok: true, member_id: already ?? null, added_existing_user: Boolean(match) });
    }

    if (action === "update_role") {
      if (!["owner", "admin"].includes(myRole.role)) {
        return fail("Only owners and admins can change roles", 403);
      }
      const memberId = typeof body.member_id === "string" ? body.member_id : "";
      const role = typeof body.role === "string" ? body.role : "";
      if (!memberId) return fail("member_id is required");
      if (!["owner", "admin", "developer", "viewer"].includes(role)) {
        return fail("Invalid role");
      }
      // Only an owner may create or change another owner.
      if (role === "owner" && myRole.role !== "owner") {
        return fail("Only owners can assign the owner role", 403);
      }
      const { data: member } = await admin
        .from("workspace_members")
        .select("id, user_id")
        .eq("id", memberId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (!member) return fail("Member not found", 404);
      const { error: updateErr } = await admin
        .from("workspace_members")
        .update({ role })
        .eq("id", memberId)
        .eq("workspace_id", workspaceId);
      if (updateErr) return fail("Could not update the role", 500);
      return json({ ok: true });
    }

    if (action === "remove") {
      const memberId = typeof body.member_id === "string" ? body.member_id : "";
      if (!memberId) return fail("member_id is required");
      if (!["owner", "admin"].includes(myRole.role)) {
        return fail("Only owners and admins can remove members", 403);
      }
      const { data: member } = await admin
        .from("workspace_members")
        .select("id, user_id, role")
        .eq("id", memberId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (!member) return fail("Member not found", 404);
      if (member.role === "owner") return fail("The workspace owner cannot be removed", 403);
      const { error: delErr } = await admin
        .from("workspace_members")
        .delete()
        .eq("id", memberId)
        .eq("workspace_id", workspaceId);
      if (delErr) return fail("Could not remove the member", 500);
      return json({ ok: true });
    }

    return fail("Unknown action");
  } catch (err) {
    console.error("members error:", err);
    return fail("Internal error", 500);
  }
});
