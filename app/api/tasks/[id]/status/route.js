import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= ID RESOLUTION ================= */
function resolveTaskId(request, ctx) {
  if (ctx?.params?.id) return ctx.params.id;

  // Fallback for App Router + external clients
  const parts = new URL(request.url).pathname.split("/");
  return parts[parts.length - 2]; // /tasks/:id/status
}

/* ================= PATCH ================= */
/**
 * PATCH /api/tasks/[id]/status
 *
 * ✔ Status updates ONLY
 * ✔ Applies assignment capacity side-effects
 * ❌ Metadata edits NOT allowed
 */
export async function PATCH(request, ctx) {
  try {
    const taskId = resolveTaskId(request, ctx);
    const { status: newStatus } = await request.json();

    if (!taskId) {
      return new Response(
        JSON.stringify({ error: "Task ID required" }),
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

    /* ---------- Fetch current task ---------- */
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("status")
      .eq("id", taskId)
      .single();

    if (fetchError || !task) {
      return new Response(
        JSON.stringify({ error: "Task not found" }),
        { status: 404 }
      );
    }

    const oldStatus = task.status;

    /* ---------- Update task status ---------- */
    const { error: updateError } = await supabase
      .from("tasks")
      .update({ status: newStatus })
      .eq("id", taskId);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: updateError.message }),
        { status: 500 }
      );
    }

    /* =====================================================
       Assignment Side-Effects (Lifecycle Rules)
       ===================================================== */

    // ▶ COMMITTED → counts toward capacity
    if (newStatus === "COMMITTED") {
      await supabase
        .from("assignments")
        .update({
          status: "committed",
          counts_toward_capacity: true
        })
        .eq("task_id", taskId);
    }

    // ⏸ PLANNING or ON_HOLD → release capacity
    if (newStatus === "PLANNING" || newStatus === "ON_HOLD") {
      await supabase
        .from("assignments")
        .update({
          counts_toward_capacity: false
        })
        .eq("task_id", taskId)
        .eq("status", "committed");
    }

    // ✅ COMPLETED → close assignments
    if (newStatus === "COMPLETED") {
      await supabase
        .from("assignments")
        .update({
          status: "completed",
          counts_toward_capacity: false
        })
        .eq("task_id", taskId);
    }

    // ❌ CANCELLED → archive assignments forever
    if (newStatus === "CANCELLED") {
      await supabase
        .from("assignments")
        .update({
          status: "inactive",
          counts_toward_capacity: false
        })
        .eq("task_id", taskId);
    }

    /* ---------- Response ---------- */
    return new Response(
      JSON.stringify({
        success: true,
        task_id: taskId,
        old_status: oldStatus,
        new_status: newStatus
      }),
      { status: 200 }
    );

  } catch (err) {
    console.error("Task status update error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}
