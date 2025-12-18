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
 * Creates module + owners atomically
 * Owners are REQUIRED
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, description, owners } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Module name is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!Array.isArray(owners) || owners.length === 0) {
      return NextResponse.json(
        { error: "Module owners are required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    /* ---------- VALIDATE OWNERSHIP ---------- */

    const ownershipByTeam = {};

    for (const o of owners) {
      if (!o.team_id || !o.member_id || !o.role) {
        return NextResponse.json(
          { error: "Each owner must have team_id, member_id, role" },
          { status: 400, headers: corsHeaders() }
        );
      }

      if (!["PRIMARY", "SECONDARY"].includes(o.role)) {
        return NextResponse.json(
          { error: "Invalid owner role" },
          { status: 400, headers: corsHeaders() }
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
      return NextResponse.json(
        {
          error: "Each team must have exactly one PRIMARY owner",
          teams: invalidTeams
        },
        { status: 400, headers: corsHeaders() }
      );
    }

    /* ---------- CREATE MODULE ---------- */

    const { data: module, error: moduleError } = await supabase
      .from("modules")
      .insert([{ name, description }])
      .select()
      .single();

    if (moduleError) {
      return NextResponse.json(
        { error: moduleError.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    /* ---------- INSERT OWNERS ---------- */

    const ownerRows = owners.map(o => ({
      module_id: module.id,
      team_id: o.team_id,
      member_id: o.member_id,
      role: o.role
    }));

    const { error: ownersError } = await supabase
      .from("module_owners")
      .insert(ownerRows);

    if (ownersError) {
      // Rollback module creation
      await supabase.from("modules").delete().eq("id", module.id);

      return NextResponse.json(
        { error: ownersError.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    /* ---------- RETURN MODULE + OWNERS ---------- */

    const { data: created } = await supabase
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
      .eq("id", module.id)
      .single();

    return NextResponse.json(
      {
        success: true,
        module: created
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
export async function GET() {
  try {
    const { data, error } = await supabase
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
      .order("name", { ascending: true });

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
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch modules" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
