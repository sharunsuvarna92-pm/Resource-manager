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
 * NOTE:
 * This endpoint ONLY creates module metadata.
 * Owners are handled separately (or by update endpoint).
 */
export async function POST(request) {
  try {
    const body = await request.json();

    const { name, description } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Module name is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const { data, error } = await supabase
      .from("modules")
      .insert([{ name, description }])
      .select()
      .single();

    if (error) {
      console.error("SUPABASE MODULE INSERT ERROR:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    return NextResponse.json(
      {
        message: "Module created successfully",
        module: data
      },
      { status: 201, headers: corsHeaders() }
    );
  } catch (err) {
    console.error("POST /api/modules ERROR:", err);
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400, headers: corsHeaders() }
    );
  }
}

/* ------------- GET /api/modules ------- */
/**
 * Returns modules WITH embedded owners
 * Owners are read-only here (source of truth = module_owners table)
 */
export async function GET() {
  try {
    const { data, error } = await supabase
      .from("modules")
      .select(`
        id,
        name,
        description,
        module_owners (
          id,
          team_id,
          member_id,
          role
        )
      `)
      .order("name", { ascending: true });

    if (error) {
      console.error("SUPABASE MODULE FETCH ERROR:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    return NextResponse.json(
      { modules: data },
      { status: 200, headers: corsHeaders() }
    );
  } catch (err) {
    console.error("GET /api/modules ERROR:", err);
    return NextResponse.json(
      { error: "Failed to fetch modules" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
