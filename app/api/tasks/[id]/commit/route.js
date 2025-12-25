import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= ID RESOLUTION ================= */
function resolveTaskId(request, ctx) {
  if (ctx?.params?.id) return ctx.params.id;
  const parts = new URL(request.url).pathname.split("/");
  return parts[parts.length - 2]; // /tasks/:id/commit
}

/* ================= POST ================= */
/**
 * POST /api/tasks/[id]/commit
 *
 * ✔ Creates assignments
 * ✔ Locks task into COMMITTED
 * ✔ Supports force override
 */
export async function POST(request, ctx) {
  try {
    const taskId = resolveTaskId(request, ctx);
    const { plan, force = false } = await request.json();

    if (!taskId || !plan) {
      return new Response(
        JSON.stringify({ error: "Invalid commit payload" }),
        { status: 400 }
      );
    }

    /* ---------- Fetch task ---------- */
    const { data: task } = await supabase
      .from("tasks")
      .select("status")
      .eq("id", taskId)
      .single();

    if (!task) {
      return new Response(
        JSON.stringify({ error: "Task not found" }),
        { status: 404 }
      );
    }

    if (task.status !== "PLANNING") {
      return new Response(
        JSON.stringify({
          error: "Only PLANNING tasks can be committed"
        }),
        { status: 409 }
      );
    }

    /* ---------- Calculate expected delivery ---------- */
    const expectedDelivery = Object.values(plan)
      .map(p => new Date(p.end_date))
      .reduce((a, b) => (b > a ? b : a))
      .toISOString();

    /* ---------- Create assignments ---------- */
    const assignments = Object.values(plan).map(p => ({
      task_id: taskId,
      team_id: p.team_id,
      member_id: p.assigned_to,
      start_date: p.start_date,
      end_date: p.end_date,
      assigned_hours: p.effort_hours,
      status: "committed",
      counts_toward_capacity: true,
      source: force ? "force_commit" : "analysis",
      created_at: new Date().toISOString()
    }));

    await supabase.from("assignments").insert(assignments);

    /* ---------- Update task ---------- */
    await supabase
      .from("tasks")
      .update({
        status: "COMMITTED",
        expected_delivery_date: expectedDelivery
      })
      .eq("id", taskId);

    return new Response(
      JSON.stringify({
        success: true,
        forced: force,
        expected_delivery_date: expectedDelivery,
        assignments_created: assignments.length
      }),
      { status: 200 }
    );

  } catch (err) {
    console.error("Commit error:", err);
    return new Response(
      JSON.stringify({ error: "Commit failed" }),
      { status: 500 }
    );
  }
}
