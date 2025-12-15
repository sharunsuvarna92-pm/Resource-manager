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
// CORS helper
// ------------------
function withCors(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function OPTIONS() {
  return withCors({});
}

// ------------------
// COMMIT TASK
// ------------------
export async function POST(request, { params }) {
  try {
    // App Router params are async
    const { id: taskId } = await params;

    if (!taskId) {
      return withCors(
        { success: false, reason: "Task ID missing" },
        400
      );
    }

    // ------------------
    // Parse & validate body FIRST
    // ------------------
    let body;
    try {
      body = await request.json();
    } catch {
      return withCors(
        {
          success: false,
          reason:
            "Commit payload missing. Expected { estimated_delivery, plan }",
        },
        400
      );
    }

    const { plan, estimated_delivery } = body;

    if (!plan || typeof plan !== "object" || Object.keys(plan).length === 0) {
      return withCors(
        {
          success: false,
          reason: "Invalid or empty plan. Commit requires a valid analysis plan.",
        },
        400
      );
    }

    // ------------------
    // Build assignments IN MEMORY (NO DB WRITE YET)
    // ------------------
    const assignmentRows = [];

    for (const [team, data] of Object.entries(plan)) {
      if (
        !data?.assigned_to ||
        !data?.start_date ||
        !data?.end_date ||
        !data?.effort_hours
      ) {
        return withCors(
          {
            success: false,
            reason: `Invalid plan entry for team ${team}`,
            received: data,
          },
          400
        );
      }

      assignmentRows.push({
        task_id: taskId,
        team,
        member_id: data.assigned_to,
        start_date: data.start_date,
        end_date: data.end_date,
        assigned_hours: data.effort_hours,
        status: "committed",
        source: "analysis",
        auto_shifted: data.auto_shifted || false,
        created_at: new Date().toISOString(),
      });
    }

    if (assignmentRows.length === 0) {
      return withCors(
        {
          success: false,
          reason: "No valid assignments generated from plan. Commit aborted.",
        },
        400
      );
    }

    // ------------------
    // Verify task exists
    // ------------------
    const { data: task } = await supabase
      .from("tasks")
      .select("id")
      .eq("id", taskId)
      .single();

    if (!task) {
      return withCors(
        { success: false, reason: "Task not found" },
        404
      );
    }

    // ------------------
    // NOW it is SAFE to modify DB
    // ------------------

    // 1️⃣ Update task
    await supabase
      .from("tasks")
      .update({
        status: "IN_PROGRESS",
        committed_at: new Date().toISOString(),
        expected_delivery_date: estimated_delivery, // ✅ ONLY FIX
      })
      .eq("id", taskId);

    // 2️⃣ Remove old draft / non-committed assignments
    await supabase
      .from("assignments")
      .delete()
      .eq("task_id", taskId)
      .neq("status", "committed");

    // 3️⃣ Insert committed assignments
    await supabase
      .from("assignments")
      .insert(assignmentRows);

    return withCors({
      success: true,
      message: "Task and assignments committed successfully",
      assignments_created: assignmentRows.length,
    });

  } catch (err) {
    console.error("Commit crash:", err);
    return withCors(
      { success: false, reason: "Internal commit error" },
      500
    );
  }
}
