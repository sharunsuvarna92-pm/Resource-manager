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
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

// ------------------
// CHANGE TASK STATUS (LIFECYCLE + CAPACITY)
// ------------------
export async function PATCH(request, { params }) {
  try {
    const { id: taskId } = await params;
    const { status: newStatus } = await request.json();

    const allowedStatuses = [
      "PLANNING",
      "COMMITTED",
      "ON_HOLD",
      "COMPLETED",
      "CANCELLED"
    ];

    if (!taskId || !allowedStatuses.includes(newStatus)) {
      return new Response(
        JSON.stringify({ error: "Invalid task status or ID" }),
        { status: 400, headers: corsHeaders() }
      );
    }

    // ------------------
    // Fetch current task
    // ------------------
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("status")
      .eq("id", taskId)
      .single();

    if (fetchError || !task) {
      return new Response(
        JSON.stringify({ error: "Task not found" }),
        { status: 404, headers: corsHeaders() }
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
    // Assignment side-effects (Option B)
    // ------------------

    // ▶ COMMITTED → include in capacity
    if (newStatus === "COMMITTED") {
      await supabase
        .from("assignments")
        .update({ counts_toward_capacity: true })
        .eq("task_id", taskId)
        .eq("status", "committed");
    }

    // ⏸ ON_HOLD or ↩ PLANNING → exclude from capacity
    if (newStatus === "ON_HOLD" || newStatus === "PLANNING") {
      await supabase
        .from("assignments")
        .update({ counts_toward_capacity: false })
        .eq("task_id", taskId)
        .eq("status", "committed");
    }

    // ✅ COMPLETED → close lifecycle
    if (newStatus === "COMPLETED") {
      await supabase
        .from("assignments")
        .update({
          status: "completed",
          counts_toward_capacity: false
        })
        .eq("task_id", taskId);
    }

    // ❌ CANCELLED → inactive forever
    if (newStatus === "CANCELLED") {
      await supabase
        .from("assignments")
        .update({
          status: "inactive",
          counts_toward_capacity: false
        })
        .eq("task_id", taskId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        old_status: oldStatus,
        new_status: newStatus
      }),
      { status: 200, headers: corsHeaders() }
    );

  } catch (err) {
    console.error("Status change error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: corsHeaders() }
    );
  }
}
