import { NextResponse } from "next/server";
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

/* ================= POST /api/modules ================= */
export async function POST(request) {
  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: corsHeaders(request) }
    );
  }

  const { name, description, module_owners } = body;

  if (!name) {
    return NextResponse.json(
      { error: "Module name is required" },
      { status: 400, headers: corsHeaders(request) }
    );
  }

  /* ---------- 1. CREATE MODULE ---------- */
  const { data: module, error: moduleError } = await supabase
    .from("modules")
    .insert({
      name,
      description,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (moduleError || !module) {
    return NextResponse.json(
      {
        error: "Module creation failed",
        details: moduleError,
      },
      { status: 500, headers: corsHeaders(request) }
    );
  }

  /* ---------- 2. CREATE MODULE OWNERS ---------- */
  let ownersInserted = [];

  if (Array.isArray(module_owners) && module_owners.length > 0) {
    const rows = module_owners.map(o => ({
      module_id: module.id,
      team_id: o.team_id,
      member_id: o.member_id,
      role: o.role,
      created_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from("module_owners")
      .insert(rows)
      .select(); // 🔥 IMPORTANT

    if (error) {
      return NextResponse.json(
        {
          error: "Module created but owners insert failed",
          supabase_error: error,
          attempted_rows: rows,
        },
        { status: 500, headers: corsHeaders(request) }
      );
    }

    ownersInserted = data;
  }

  /* ---------- 3. RESPONSE ---------- */
  return NextResponse.json(
    {
      success: true,
      module_id: module.id,
      owners_created: ownersInserted.length,
      owners: ownersInserted,
    },
    { status: 201, headers: corsHeaders(request) }
  );
}

/* ================= GET /api/modules ================= */
export async function GET(request) {
  const { data, error } = await supabase
    .from("modules")
    .select("id, name, description, created_at")
    .order("name");

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: corsHeaders(request) }
    );
  }

  return NextResponse.json(
    { modules: data },
    { status: 200, headers: corsHeaders(request) }
  );
}
