import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/* ---------------- Supabase ---------------- */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ---------------- OPTIONS (CORRECT 204) ---------------- */
export async function OPTIONS(request) {
  const origin = request.headers.get("origin");

  return new Response(null, {
    status: 204, // ✅ NO BODY
    headers: {
      "Access-Control-Allow-Origin": origin ?? "*",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, Accept",
    },
  });
}

/* ---------------- Helper for normal responses ---------------- */
function jsonResponse(request, body, status = 200) {
  const origin = request.headers.get("origin");

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin ?? "*",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, Accept",
    },
  });
}

/* ---------------- PUT /api/modules/[id] ---------------- */
export async function PUT(request, { params }) {
  try {
    const { id: moduleId } = params;

    if (!moduleId) {
      return jsonResponse(
        request,
        { error: "Module ID missing" },
        400
      );
    }

    const { name, description, owners } = await request.json();

    if (!name || !Array.isArray(owners)) {
      return jsonResponse(
        request,
        { error: "Invalid payload" },
        400
      );
    }

    /* ---------- Update module ---------- */
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
      return jsonResponse(
        request,
        { error: moduleError.message },
        500
      );
    }

    /* ---------- Replace owners ---------- */
    await supabase
      .from("module_owners")
      .delete()
      .eq("module_id", moduleId);

    if (owners.length > 0) {
      const rows = owners.map(o => ({
        module_id: moduleId,
        team_id: o.team_id,
        member_id: o.member_id,
        role: o.role, // PRIMARY | SECONDARY
        created_at: new Date().toISOString(),
      }));

      const { error: ownerError } = await supabase
        .from("module_owners")
        .insert(rows);

      if (ownerError) {
        return jsonResponse(
          request,
          { error: ownerError.message },
          500
        );
      }
    }

    return jsonResponse(request, {
      success: true,
      module_id: module.id,
    });

  } catch (err) {
    console.error("Module update failed:", err);
    return jsonResponse(
      request,
      { error: "Internal server error" },
      500
    );
  }
}
