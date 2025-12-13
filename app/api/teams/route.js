import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * CORS headers helper
 */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

/**
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

/**
 * Create Supabase client (server-side)
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * POST /api/teams
 * Create a new team
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, description } = body;

    if (!name || name.trim() === "") {
      return NextResponse.json(
        { error: "Team name is required" },
        {
          status: 400,
          headers: corsHeaders()
        }
      );
    }

    const { data, error } = await supabase
      .from("teams")
      .insert([{ name, description }])
      .select()
      .single();

    if (error) {
      console.error("SUPABASE INSERT ERROR:", error);
      return NextResponse.json(
        { error: error.message },
        {
          status: 500,
          headers: corsHeaders()
        }
      );
    }

    return NextResponse.json(
      {
        message: "Team created successfully",
        team: data
      },
      {
        status: 201,
        headers: corsHeaders()
      }
    );
  } catch (err) {
    console.error("POST /api/teams ERROR:", err);
    return NextResponse.json(
      { error: "Invalid request body" },
      {
        status: 400,
        headers: corsHeaders()
      }
    );
  }
}

/**
 * GET /api/teams
 * List all teams
 */
export async function GET() {
  try {
    const { data, error } = await supabase
      .from("teams")
      .select("id, name, description")
      .order("name", { ascending: true });

    if (error) {
      console.error("SUPABASE FETCH ERROR:", error);
      return NextResponse.json(
        { error: error.message },
        {
          status: 500,
          headers: corsHeaders()
        }
      );
    }

    return NextResponse.json(
      { teams: data },
      {
        status: 200,
        headers: corsHeaders()
      }
    );
  } catch (err) {
    console.error("GET /api/teams ERROR:", err);
    return NextResponse.json(
      { error: "Failed to fetch teams" },
      {
        status: 500,
        headers: corsHeaders()
      }
    );
  }
}
