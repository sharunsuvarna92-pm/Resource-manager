import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// ------------------
// Supabase client
// ------------------
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ------------------
// UPDATE TEAM MEMBER
// ------------------
export async function PUT(request, { params }) {
  try {
    // ✅ App Router params are async
    const { id } = await params;

    console.log("TEAM MEMBER UPDATE ID:", id);

    if (!id) {
      return new Response(
        JSON.stringify({ error: "Team member ID missing in route" }),
        { status: 400 }
      );
    }

    // ------------------
    // Parse body
    // ------------------
    const body = await request.json();

    const {
      name,
      email,
      team_id,
      skill_sets,
      experience_level,
      capacity_hours_per_day,
      timezone,
      calendar_busy_intervals,
      historical_performance,
      is_active
    } = body;

    // ------------------
    // Basic validation
    // ------------------
    if (!name || !email || !team_id) {
      return new Response(
        JSON.stringify({
          error: "name, email, and team_id are required"
        }),
        { status: 400 }
      );
    }

    if (skill_sets && !Array.isArray(skill_sets)) {
      return new Response(
        JSON.stringify({
          error: "skill_sets must be an array of strings"
        }),
        { status: 400 }
      );
    }

    // ------------------
    // Update member
    // ------------------
    const { data, error } = await supabase
      .from("team_members")
      .update({
        name,
        email,
        team_id,
        skill_sets,
        experience_level,
        capacity_hours_per_day,
        timezone,
        calendar_busy_intervals,
        historical_performance,
        is_active
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Supabase update error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500 }
      );
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Team member update crash:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}
