import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/* ---------------- Supabase ---------------- */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ---------------- CORS (FINAL) ---------------- */
function withCors(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, Accept",
    },
  });
}

export function OPTIONS() {
  // Preflight must succeed with correct headers
  return withCors({}, 204);
}

/* ---------------- PUT /api/modules/[id] ---------------- */
/**
 * Updates:
 * - Module metadata
 * - Module owners (PRIMARY / SECONDARY)
 *
 * This endpoint is the SINGLE authority for module ownership.
 */
export async function PUT(request, { params }) {
  try {
    const { id: moduleId } = await params;

    if (!moduleId) {
      return withCors(
        { error: "Module ID missing in route" },
        400
      );
    }

    const body = await request.json();
    const { name, description, owners } = body;

    if (!name) {
      return withCors(
        { error: "Module name is required" },
        400
      );
    }

    if (!Array.isArray(owners)) {
      return withCors(
        { error: "owners must be an array" },
        400
      );
    }

    /* ---------- Update module metadata ---------- */
    const { data: module, error: moduleError } = await supabase
      .from("modules")
      .update({
        name,
        description,
        updated_at: new Date().toISOString(),
      })
      .eq("id", moduleId)
      .select()
      .single();

    if (moduleError) {
      return withCors(
        { error: moduleError.message },
        500
      );
    }

    /* ---------- Replace owners atomically ---------- */

    // Remove existing owners
    await supabase
      .from("module_owners")
      .delete()
      .eq("module_id", moduleId);

    // Insert new owners
    if (owners.length > 0) {
      const ownerRows = owners.map(o => ({
        module_id: moduleId,
        team_id: o.team_id,
        member_id: o.member_id,
        role: o.role, // PRIMARY | SECONDARY
        created_at: new Date().toISOString(),
      }));

      const { error: ownerError } = await supabase
        .from("module_owners")
        .insert(ownerRows);

      if (ownerError) {
        return withCors(
          { error: ownerError.message },
          500
        );
      }
    }

    /* ---------- Fetch owners with names (DISPLAY READY) ---------- */
    const { data: ownerView = [] } = await supabase
      .from("module_owners")
      .select(`
        role,
        team:teams(id, name),
        member:team_members(id, name)
      `)
      .eq("module_id", moduleId);

    return withCors({
      success: true,
      module: {
        module_id: module.id,
        name: module.name,
        description: module.description,
      },
      owners: ownerView.map(o => ({
        role: o.role,
        team: {
          team_id: o.team.id,
          team_name: o.team.name,
        },
        member: {
          member_id: o.member.id,
          member_name: o.member.name,
        },
      })),
    });

  } catch (err) {
    console.error("Module update error:", err);
    return withCors(
      { error: "Internal server error" },
      500
    );
  }
}
