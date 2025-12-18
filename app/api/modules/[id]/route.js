import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ---------------- CORS ---------------- */

function withCors(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

export async function OPTIONS() {
  return withCors({}, 204);
}

/* ---------------- UPDATE MODULE + OWNERS ---------------- */

export async function PUT(request, { params }) {
  try {
    const { id: moduleId } = await params;

    if (!moduleId) {
      return withCors({ error: "Module ID missing" }, 400);
    }

    const body = await request.json();
    const { name, description, owners } = body;

    if (!name) {
      return withCors({ error: "Module name is required" }, 400);
    }

    if (!Array.isArray(owners) || owners.length === 0) {
      return withCors(
        { error: "Module owners are required" },
        400
      );
    }

    /* ---------- VALIDATE OWNERSHIP ---------- */

    const ownershipByTeam = {};

    for (const o of owners) {
      if (!o.team_id || !o.member_id || !o.role) {
        return withCors(
          { error: "Each owner must have team_id, member_id, role" },
          400
        );
      }

      if (!["PRIMARY", "SECONDARY"].includes(o.role)) {
        return withCors(
          { error: "Invalid owner role" },
          400
        );
      }

      ownershipByTeam[o.team_id] ??= { primary: 0 };

      if (o.role === "PRIMARY") {
        ownershipByTeam[o.team_id].primary++;
      }
    }

    const invalidTeams = Object.entries(ownershipByTeam)
      .filter(([_, v]) => v.primary !== 1)
      .map(([teamId]) => teamId);

    if (invalidTeams.length > 0) {
      return withCors(
        {
          error: "Each team must have exactly one PRIMARY owner",
          teams: invalidTeams
        },
        400
      );
    }

    /* ---------- UPDATE MODULE ---------- */

    const { error: moduleError } = await supabase
      .from("modules")
      .update({ name, description })
      .eq("id", moduleId);

    if (moduleError) {
      return withCors({ error: moduleError.message }, 500);
    }

    /* ---------- REPLACE OWNERS (ATOMIC INTENT) ---------- */

    const { error: deleteError } = await supabase
      .from("module_owners")
      .delete()
      .eq("module_id", moduleId);

    if (deleteError) {
      return withCors({ error: deleteError.message }, 500);
    }

    const ownerRows = owners.map(o => ({
      module_id: moduleId,
      team_id: o.team_id,
      member_id: o.member_id,
      role: o.role
    }));

    const { error: insertError } = await supabase
      .from("module_owners")
      .insert(ownerRows);

    if (insertError) {
      return withCors({ error: insertError.message }, 500);
    }

    /* ---------- RETURN UPDATED MODULE ---------- */

    const { data: updated } = await supabase
      .from("modules")
      .select(`
        id,
        name,
        description,
        module_owners (
          team_id,
          member_id,
          role
        )
      `)
      .eq("id", moduleId)
      .single();

    return withCors(
      {
        success: true,
        module: updated
      },
      200
    );

  } catch (err) {
    console.error("Module update crash:", err);
    return withCors(
      { error: "Internal server error" },
      500
    );
  }
}
