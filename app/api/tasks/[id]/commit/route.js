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
    // ✅ App Router params are async
    const { id: taskId } = await params;

    if (!taskId) {
      return withCors(
        { success: false, reason: "Task ID missing" },
        400
      );
    }

    const body = await request.json();
    const { plan, estimated_delivery } = body;

    if (!plan || Object.keys(plan).length === 0) {
      return withCors(
        { success: false, reason: "Analysis plan missing" },
        400
      );
    }

    // 1️⃣ Verify task exists
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

    // 2️⃣ Update task (authoritative commit)
    await supabase
      .from("tasks")
      .update({
        status: "committed",
        committed_at: new Date().toISOString(),
        estimated_delivery
      })
      .eq("id", taskId);

    // 3️⃣ Remove all non-committed assignments for this task
    await supabase
      .from("assignments")
      .delete()
      .eq("task_id", taskId)
      .neq("status", "committed");

    // 4️⃣ Insert committed assignments from analyzer plan
    const assignmentRows = Object.entries(plan).map(
      ([team, data]) => ({
        task_id: taskId,
        team,
        member_id: data.assigned_to,
        start_date: data.start_date,      // ✅ FROM ANALYSIS
        end_date: data.end_date,          // ✅ FROM ANALYSIS
        assigned_hours: data.effort_hours,
        status: "committed",
        source: "analysis",
        auto_shifted: data.auto_shifted || false,
        created_at: new Date().toISOString()
      })
    );

    await supabase
      .from("assignments")
      .insert(assignmentRows);

    return withCors({
      success: true,
      message: "Task and assignments committed successfully",
      assignments_created: assignmentRows.length
    });

  } catch (err) {
    console.error("Commit crash:", err);
    return withCors(
      { success: false, reason: "Internal commit error" },
      500
    );
  }
}
