import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/* ---------------- Supabase ---------------- */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ---------------- CORS (APP ROUTER SAFE) ---------------- */
function corsResponse(request, body, status = 200) {
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

/* ✅ MUST be async + accept context */
export async function OPTIONS(request, context) {
  return corsResponse(request, {}, 204);
}

/* ---------------- PUT /api/modules/[id] ---------------- */
export async function PUT(request, { params }) {
  try {
    const { id: moduleId } = params;

    if (!moduleId) {
      return corsResponse(
        request,
        { error: "Module ID missing" },
        400
      );
    }

    const { name, description, owners } = await request.json();

    if (!name || !Array.isArray(owners)) {
      return corsResponse(
        request,
        { error: "Invalid payload" },
        400
      );
    }

    /* Update module */
    const { data: module, error } = await supabase
      .from("modules")
      .update({ name, description })
      .eq("id", moduleId)
      .select()
      .single();

    if (error) {
      return corsResponse(request, { error: error.message }, 500);
    }

    /* Replace owners */
    await supabase.from("module_owners").delete().eq("module_id", moduleId);

    if (owners.length) {
      await supabase.from("module_owners").insert(
        owners.map(o => ({
          module_id: moduleId,
          team_id: o.team_id,
          member_id: o.member_id,
          role: o.role,
        }))
      );
    }

    return corsResponse(request, {
      success: true,
      module_id: module.id,
    });

  } catch (err) {
    console.error(err);
    return corsResponse(
      request,
      { error: "Internal server error" },
      500
    );
  }
}
