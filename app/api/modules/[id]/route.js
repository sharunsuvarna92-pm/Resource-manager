import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/* ================= SUPABASE ================= */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= CORS ================= */
function corsHeaders(request) {
  const origin = request.headers.get("origin") || "*";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Accept",
  };
}

/* ================= OPTIONS ================= */
export async function OPTIONS(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

/* ================= CORE UPDATE ================= */
async function handleUpdate(request, params) {
  const moduleId = params?.id;

  if (!moduleId) {
    return new Response(
      JSON.stringify({ error: "Module ID missing" }),
      { status: 400, headers: corsHeaders(request) }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: corsHeaders(request) }
    );
  }

  const { name, description, owners } = body;

  // ---- Update module metadata (NO STRICT VALIDATION) ----
  const { error: moduleError } = await supabase
    .from("modules")
    .update({
      name,
      description,
      updated_at: new Date().toISOString(),
    })
    .eq("id", moduleId);

  if (moduleError) {
    return new Response(
      JSON.stringify({ error: moduleError.message }),
      { status: 500, headers: corsHeaders(request) }
    );
  }

  // ---- Replace owners (best-effort) ----
  await supabase
    .from("module_owners")
    .delete()
    .eq("module_id", moduleId);

  if (Array.isArray(owners) && owners.length > 0) {
    const rows = owners.map(o => ({
      module_id: moduleId,
      team_id: o.team_id,
      member_id: o.member_id,
      role: o.role,
      created_at: new Date().toISOString(),
    }));

    const { error: ownerError } = await supabase
      .from("module_owners")
      .insert(rows);

    if (ownerError) {
      return new Response(
        JSON.stringify({ error: ownerError.message }),
        { status: 500, headers: corsHeaders(request) }
      );
    }
  }

  return new Response(
    JSON.stringify({ success: true, module_id: moduleId }),
    { status: 200, headers: corsHeaders(request) }
  );
}

/* ================= PUT ================= */
export async function PUT(request, ctx) {
  return handleUpdate(request, ctx.params);
}

/* ================= PATCH ================= */
export async function PATCH(request, ctx) {
  return handleUpdate(request, ctx.params);
}
