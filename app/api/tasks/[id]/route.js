import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ------------------
// UPDATE TASK STATUS
// ------------------
export async function PATCH(request, { params }) {
  try {
    const { id: taskId } = await params;
    const { status: newStatus } = await request.json();

    if (!taskId || !newStatus) {
      return new Response(
        JSON.stringify({ error: "Task ID and status are required" }),
        { status: 400 }
      );
    }

    const allowedStatuses = [
      "PLANNING",
      "COMMITTED",
      "ON_HOLD",
      "COMPLETED",
      "CANCELLED"
    ];

    if (!allowedStatuses.includes(newStatus)) {
      return new Response(
        JSON.stringify({ error: "Invalid task status" }),
        { status: 400 }
      );
    }

    // ------------------
    // Fetch task
    // ------------------
    const { data: task, error } = await supabase
      .from("tasks")
      .select("status")
      .eq("id", taskId)
      .single();

    if (error || !task) {
      return new Response(
        JSON.stringify({ error: "Task not found" }),
        { status: 404 }
      );
    }

    const oldStatus = task.status;

    // ------------------
    // Update task status
    // ------------------
    await supabase
      .from("tasks")
      .update({ status: newStatus })
      .eq("id", taskId);

    // ------------------
    // Assignment side-effects
    // ------------------

    // 🔁 Back to planning OR on hold
    if (newStatus === "PLANNING" || newStatus === "ON_HOLD") {
      await supabase
        .from("assignments")
        .update({ status: "draft" })
        .eq("task_id", taskId)
        .neq("status", "completed");
    }

    // ▶ Commit
    if (newStatus === "COMMITTED") {
      await supabase
        .from("assignments")
        .update({ status: "committed" })
        .eq("task_id", taskId)
        .eq("status", "draft");
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
        .delete()
        .eq("task_id", taskId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        old_status: oldStatus,
        new_status: newStatus
      }),
      { status: 200 }
    );

  } catch (err) {
    console.error("Status update error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}
