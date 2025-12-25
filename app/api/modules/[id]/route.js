import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= ID RESOLUTION ================= */

function resolveModuleId(request, ctx) {
  if (ctx?.params?.id) return ctx.params.id;

  const parts = new URL(request.url).pathname.split("/");
  return parts[parts.length - 1];
}

/* ================= UPDATE MODULE ================= */

export async function PATCH(request, ctx) {
  const moduleId = resolveModuleId(request, ctx);

  if (!moduleId) {
    return new Response(
      JSON.stringify({ error: "Missing module ID" }),
      { status: 400 }
    );
  }

  const body = await request.json();
  const { name, description, module_owners } = body;

  /* ---------- Update module metadata ---------- */
  if (name !== undefined || description !== undefined) {
    const { error } = await supabase
      .from("modules")
      .update({
        name,
        description,
        updated_at: new Date().toISOString()
      })
      .eq("id", moduleId);

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500 }
      );
    }
  }

  /* ---------- Replace module owners ---------- */
  if (Array.isArray(module_owners)) {
    // 🔒 Invariant validation
    const primaryByTeam = {};

    for (const o of module_owners) {
      if (!o.team_id || !o.member_id || !o.role) {
        return new Response(
          JSON.stringify({ error: "Invalid module_owners payload" }),
          { status: 400 }
        );
      }

      if (o.role === "PRIMARY") {
        if (primaryByTeam[o.team_id]) {
          return new Response(
            JSON.stringify({
              error:
                "Exactly one PRIMARY owner is allowed per (module, team)"
            }),
            { status: 400 }
          );
        }
        primaryByTeam[o.team_id] = true;
      }
    }

    // 1️⃣ Delete existing owners
    await supabase
      .from("module_owners")
      .delete()
      .eq("module_id", moduleId);

    // 2️⃣ Insert new owners exactly as sent
    const rows = module_owners.map(o => ({
      module_id: moduleId,
      team_id: o.team_id,
      member_id: o.member_id,
      role: o.role,
      created_at: new Date().toISOString()
    }));

    if (rows.length > 0) {
      const { error } = await supabase
        .from("module_owners")
        .insert(rows);

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500 }
        );
      }
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      module_id: moduleId
    }),
    { status: 200 }
  );
}

/* PUT alias (safe) */
export async function PUT(request, ctx) {
  return PATCH(request, ctx);
}
