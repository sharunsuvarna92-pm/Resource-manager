import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * CORS headers
 */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

/**
 * Preflight handler
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

/**
 * Supabase client (server-side)
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * POST /api/team-members
 * Create a team member
 */
export async function POST(request) {
  try {
    const body = await request.json();

    const {
      name,
      email,
      team_id,
      skill_sets,
      experience_level,
      capacity_hours_per_week,
      timezone
    } = body;

    // Required validation
    if (!name || !team_id) {
      return NextResponse.json(
        { error: "name and team_id are required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const { data, error } = await supabase
      .from("team_members")
      .insert([
        {
          name,
          email,
          team_id,
          skill_sets,
          experience_level,
          capacity_hours_per_week: capacity_hours_per_week ?? 40,
          timezone: timezone ?? "Asia/Kolkata",
          is_active: true,
          calendar_busy_intervals: [],
          historical_performance: null
        }
      ])
      .select()
      .single();

    if (error) {
      console.error("SUPABASE INSERT ERROR:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    return NextResponse.json(
      {
        message: "Team member created successfully",
        member: data
      },
      { status: 201, headers: corsHeaders() }
    );
  } catch (err) {
    console.error("POST /api/team-members ERROR:", err);
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400, headers: corsHeaders() }
    );
  }
}

/**
 * GET /api/team-members
 * Optional filter: ?team_id=UUID
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get("team_id");

    let query = supabase
      .from("team_members")
      .select(`
        id,
        name,
        email,
        team_id,
        skill_sets,
        experience_level,
        capacity_hours_per_week,
        timezone,
        is_active
      `);

    if (teamId) {
      query = query.eq("team_id", teamId);
    }

    const { data, error } = await query.order("name", { ascending: true });

    if (error) {
      console.error("SUPABASE FETCH ERROR:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    return NextResponse.json(
      { members: data },
      { status: 200, headers: corsHeaders() }
    );
  } catch (err) {
    console.error("GET /api/team-members ERROR:", err);
    return NextResponse.json(
      { error: "Failed to fetch team members" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
