import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* ---------------- CORS ---------------- */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/* ------------- Supabase Client -------- */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ------------- POST /api/modules ------ */
/**
 * Expected body:
 * {
 *   "name": "Authentication",
 *   "description": "Login & signup",
 *   "owners": [
 *     {
 *       "team_id": "TEAM_UUID",
 *       "member_id": "MEMBER_UUID",
 *       "role": "PRIMARY"
 *     },
 *     {
 *       "team_id": "TEAM_UUID",
 *       "member_id": "MEMBER_UUID",
 *       "role": "SECONDARY"
 *     }
 *   ]
 * }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, description, owners } = body;

    if (!name || !Array.isArray(owners) || owners.length === 0) {
      return NextResponse.json(
        { error: "Module name and owners are required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    // ------------------
    // Create module
    // ------------------
    const { data: module, error: moduleError } = await supabase
      .from("modules")
      .insert({ name, description })
      .select()
      .single();

    if (moduleError) {
      return NextResponse.json(
        { error: moduleError.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    // ------------------
    // Insert owners
    // ------------------
    const ownerRows = owners.map(o => ({
      module_id: module.id,
      team_id: o.team_id,
      member_id: o.member_id,
      role: o.role
    }));

    const { error: ownerError } = await supabase
      .from("module_owners")
      .insert(ownerRows);

    if (ownerError) {
      return NextResponse.json(
        { error: ownerError.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    return NextResponse.json(
      { success: true, module },
      { status: 201, headers: corsHeaders() }
    );

  } catch (err) {
    console.error("Module create error:", err);
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400, headers: corsHeaders() }
    );
  }
}

/* ------------- GET /api/modules ------- */
export async function GET() {
  const { data, error } = await supabase
    .from("modules")
    .select("id, name, description")
    .order("name");

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: corsHeaders() }
    );
  }

  return NextResponse.json(
    { modules: data },
    { status: 200, headers: corsHeaders() }
  );
}
