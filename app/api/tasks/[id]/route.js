import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/* ---------------- Supabase ---------------- */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ---------------- CORS ---------------- */
function withCors(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export function OPTIONS() {
  return withCors({}, 204);
}

/* ---------------- PATCH /api/tasks/[id] ---------------- */
/**
 * STATUS UPDATE ONLY
 * Metadata edits are NOT allowed here
 */
export async function PATCH(request, { params }) {
  try {
    const { id: taskId } = await params;
    const { status: newStatus } = await request.json();

    if (!taskId || !newStatus) {
      return withCors(
        { error: "Task ID and status are required" },
        400
      );
    }

    const allowedStatuses = [
      "PLANNING",
      "COMMITTED",
      "ON_HOLD",
      "COMPLETED",
      "CANCELLED",
    ];

    if (!allowedStatuses.includes(newStatus)) {
      return withCors(
        { error: "Invalid task status" },
        400
      );
    }

    /* ---------- Fetch current task ---------- */
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("status, title")
      .eq("id", taskId)
      .single();

    if (fetchError || !task) {
      return withCors(
        { error: "Task not found" },
        404
      );
    }

    const oldStatus = task.status;

    /* ---------- Update task status ---------- */
    const { error: updateError } = await supabase
      .from("tasks")
      .update({ status: newStatus })
      .eq("id", taskId);

    if (updateError) {
      return withCors(
        { error: updateError.message },
        500
      );
    }

    /* ---------- Assignment side-effects ---------- */

    // 🔁 Move back to planning or on-hold
    if (newStatus === "PLANNING" || newStatus === "ON_HOLD") {
      await supabase
        .from("assignments")
        .update({ status: "on_hold" })
        .eq("task_id", taskId)
        .neq("status", "completed");
    }

    // ▶ Commit
    if (newStatus === "COMMITTED") {
      await supabase
        .from("assignments")
        .update({ status: "committed" })
        .eq("task_id", taskId)
        .in("status", ["on_hold"]);
    }

    // ✅ Complete
    if (newStatus === "COMPLETED") {
      await supabase
        .from("assignments")
        .update({ status: "completed" })
        .eq("task_id", taskId);
    }

    // ❌ Cancel
    if (newStatus === "CANCELLED") {
      await supabase
        .from("assignments")
        .update({ status: "inactive" })
        .eq("task_id", taskId);
    }

    return withCors({
      success: true,
      task: {
        task_id: taskId,
        title: task.title,
        old_status: oldStatus,
        new_status: newStatus,
      },
    });

  } catch (err) {
    console.error("Task status update error:", err);
    return withCors(
      { error: "Internal server error" },
      500
    );
  }
}
