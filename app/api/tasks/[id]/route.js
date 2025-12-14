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
// EDIT TASK (PLANNING ONLY)
// ------------------
export async function PUT(request, { params }) {
  try {
    // ✅ App Router params are async
    const { id: taskId } = await params;

    if (!taskId) {
      return new Response(
        JSON.stringify({ error: "Task ID missing in route" }),
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      title,
      description,
      start_date,
      due_date,
      teams_involved,
      team_work
    } = body;

    // ------------------
    // Fetch task
    // ------------------
    const { data: task, error: taskFetchError } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .single();

    if (taskFetchError || !task) {
      return new Response(
        JSON.stringify({ error: "Task not found" }),
        { status: 404 }
      );
    }

    // ------------------
    // Enforce PLANNING only
    // ------------------
    if (task.status !== "PLANNING") {
      return new Response(
        JSON.stringify({
          error: "Only tasks in PLANNING status can be edited"
        }),
        { status: 400 }
      );
    }

    // ------------------
    // Fetch module owners
    // ------------------
    const { data: module, error: moduleError } = await supabase
      .from("modules")
      .select("primary_roles_map")
      .eq("id", task.module_id)
      .single();

    if (moduleError || !module) {
      return new Response(
        JSON.stringify({ error: "Invalid module configuration" }),
        { status: 400 }
      );
    }

    // ------------------
    // Update task
    // ------------------
    const { error: taskUpdateError } = await supabase
      .from("tasks")
      .update({
        title,
        description,
        start_date,
        due_date,
        teams_involved,
        team_work
      })
      .eq("id", taskId);

    if (taskUpdateError) {
      console.error("Task update error:", taskUpdateError);
      return new Response(
        JSON.stringify({ error: taskUpdateError.message }),
        { status: 500 }
      );
    }

    // ------------------
    // Delete existing DRAFT assignments
    // ------------------
    await supabase
      .from("assignments")
      .delete()
      .eq("task_id", taskId)
      .eq("status", "draft");

    // ------------------
    // Recreate draft assignments
    // ------------------
    const assignments = [];

    for (const team of teams_involved) {
      const primaryOwner = module.primary_roles_map?.[team];

      if (!primaryOwner) {
        return new Response(
          JSON.stringify({
            error: `Primary owner not defined for team ${team}`
          }),
          { status: 400 }
        );
      }

      assignments.push({
        task_id: taskId,
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
      console.error("Draft assignment recreate error:", assignmentError);
      return new Response(
        JSON.stringify({ error: assignmentError.message }),
        { status: 500 }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200 }
    );

  } catch (err) {
    console.error("Edit task crash:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}
