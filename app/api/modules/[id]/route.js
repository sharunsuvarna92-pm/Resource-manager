import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/* ---------------- Supabase ---------------- */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ---------------- CORS (CREDENTIAL SAFE) ---------------- */
/**
 * IMPORTANT:
 * - Frontend sends cookies / credentials
 * - Therefore Access-Control-Allow-Origin CANNOT be "*"
 * - We MUST echo request origin
 */
function withCors(request, body, status = 200) {
  const origin = request.headers.get("origin");

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin ?? "",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, Accept",
    },
  });
}

export function OPTIONS(request) {
  // Preflight must return the same CORS headers
  return withCors(request, {}, 204);
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
        request,
        { error: "Module ID missing in route" },
        400
      );
    }

    const body = await request.json();
    const { name, description, owners } = body;

    if (!name) {
      return withCors(
        request,
        { error: "Module name is required" },
        400
      );
    }

    if (!Array.isArray(owners)) {
      return withCors(
        request,
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
        request,
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
          request,
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

    return withCors(request, {
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
      request,
      { error: "Internal server error" },
      500
    );
  }
}
