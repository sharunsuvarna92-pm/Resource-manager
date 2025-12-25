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
  try {
    const moduleId = resolveModuleId(request, ctx);

    if (!moduleId) {
      return new Response(
        JSON.stringify({ error: "Missing module ID" }),
        { status: 400 }
      );
    }

    const body = await request.json();
    const { name, description, module_owners } = body;

    /* ---------- Validate owners BEFORE DB ---------- */
    if (!Array.isArray(module_owners) || module_owners.length === 0) {
      return new Response(
        JSON.stringify({
          error: "module_owners must be a non-empty array"
        }),
        { status: 400 }
      );
    }

    const primaryByTeam = new Set();
    const dedupe = new Set();

    for (const o of module_owners) {
      if (!o.team_id || !o.member_id || !o.role) {
        return new Response(
          JSON.stringify({ error: "Invalid module_owners entry" }),
          { status: 400 }
        );
      }

      if (!["PRIMARY", "SECONDARY"].includes(o.role)) {
        return new Response(
          JSON.stringify({ error: "Invalid owner role" }),
          { status: 400 }
        );
      }

      const key = `${o.team_id}:${o.member_id}:${o.role}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);

      if (o.role === "PRIMARY") {
        if (primaryByTeam.has(o.team_id)) {
          return new Response(
            JSON.stringify({
              error:
                "Exactly one PRIMARY owner allowed per (module, team)"
            }),
            { status: 400 }
          );
        }
        primaryByTeam.add(o.team_id);
      }
    }

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

      if (error) throw error;
    }

    /* ---------- Replace owners SAFELY ---------- */
    const rows = module_owners.map(o => ({
      module_id: moduleId,
      team_id: o.team_id,
      member_id: o.member_id,
      role: o.role,
      created_at: new Date().toISOString()
    }));

    // Delete
    const { error: delError } = await supabase
      .from("module_owners")
      .delete()
      .eq("module_id", moduleId);

    if (delError) throw delError;

    // Insert
    const { error: insError } = await supabase
      .from("module_owners")
      .insert(rows);

    if (insError) {
      // Rollback: restore old owners is future work
      throw insError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        module_id: moduleId,
        owners_updated: rows.length
      }),
      { status: 200 }
    );

  } catch (err) {
    console.error("MODULE UPDATE ERROR:", err);

    return new Response(
      JSON.stringify({
        error: "MODULE_UPDATE_FAILED",
        details: err.message
      }),
      { status: 500 }
    );
  }
}

/* PUT alias */
export async function PUT(request, ctx) {
  return PATCH(request, ctx);
}
