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
// CREATE TASK (PLANNING)
// ------------------
export async function POST(request) {
  try {
    const body = await request.json();

    const {
      title,
      description,
      module_id,
      start_date,
      due_date,
      teams_involved,
      team_work
    } = body;

    // ------------------
    // Validation
    // ------------------
    if (
      !title ||
      !module_id ||
      !start_date ||
      !due_date ||
      !Array.isArray(teams_involved) ||
      teams_involved.length === 0 ||
      !team_work
    ) {
      return new Response(
        JSON.stringify({ error: "Missing required task fields" }),
        { status: 400 }
      );
    }

    // ------------------
    // Fetch module owners
    // ------------------
    const { data: module, error: moduleError } = await supabase
      .from("modules")
      .select("primary_roles_map")
      .eq("id", module_id)
      .single();

    if (moduleError || !module) {
      return new Response(
        JSON.stringify({ error: "Invalid module_id" }),
        { status: 400 }
      );
    }

    // ------------------
    // Create task
    // ------------------
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .insert({
        title,
        description,
        module_id,
        start_date,
        due_date,
        teams_involved,
        team_work,
        status: "PLANNING"
      })
      .select()
      .single();

    if (taskError) {
      console.error("Task create error:", taskError);
      return new Response(
        JSON.stringify({ error: taskError.message }),
        { status: 500 }
      );
    }

    // ------------------
    // Create draft assignments
    // ------------------
    const assignments = [];

    for (const team of teams_involved) {
      const primaryOwner = module.primary_roles_map?.[team];

      if (!primaryOwner) {
        return new Response(
          JSON.stringify({
            error: `Primary owner not defined for team ${team} in module`
          }),
          { status: 400 }
        );
      }

      assignments.push({
        task_id: task.id,
        team,
        member_id: primaryOwner,
        start_date,
        end_date: due_date,
        assigned_hours: team_work[team]?.effort_hours || 0,
        status: "draft",
        source: "auto",
        created_at: new Date().toISOString()
      });
    }

    const { error: assignmentError } = await supabase
      .from("assignments")
      .insert(assignments);

    if (assignmentError) {
      console.error("Assignment create error:", assignmentError);
      return new Response(
        JSON.stringify({ error: assignmentError.message }),
        { status: 500 }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        task_id: task.id,
        status: task.status
      }),
      {
        status: 201,
        headers: { "Content-Type": "application/json" }
      }
    );

  } catch (err) {
    console.error("Create task crash:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("tasks")
      .select(`
        id,
        title,
        status,
        start_date,
        due_date,
        expected_delivery_date,
        module_id,
        teams_involved,
        team_work,
        created_at
      `)
      .order("created_at", { ascending: false });

    if (error) {
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
    return new Response(
      JSON.stringify({ error: "Failed to fetch tasks" }),
      { status: 500 }
    );
  }
}
