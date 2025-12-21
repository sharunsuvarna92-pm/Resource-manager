// app/api/tasks/[id]/route.js
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

/**
 * PATCH /api/tasks/[id]
 * ✳️ Metadata edits ONLY
 * ❌ Status changes NOT allowed
 * ❌ Assignment changes NOT allowed
 */
export async function PATCH(request, { params }) {
  try {
    const { id: taskId } = params;
    const body = await request.json();

    if (!taskId) {
      return withCors({ error: "Task ID required" }, 400);
    }

    // ❌ Explicitly reject status mutation
    if ("status" in body) {
      return withCors(
        { error: "Task status cannot be updated via this route" },
        400
      );
    }

    /* ---------- Fetch task ---------- */
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("status")
      .eq("id", taskId)
      .single();

    if (fetchError || !task) {
      return withCors({ error: "Task not found" }, 404);
    }

    // ❌ Metadata is editable ONLY in PLANNING
    if (task.status !== "PLANNING") {
      return withCors(
        { error: "Task can only be edited in PLANNING state" },
        409
      );
    }

    /* ---------- Build safe update ---------- */
    const allowedFields = [
      "title",
      "description",
      "start_date",
      "due_date",
      "teams_involved",
      "team_work",
      "priority",
    ];

    const updates = {};
    for (const key of allowedFields) {
      if (key in body) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return withCors(
        { error: "No editable fields provided" },
        400
      );
    }

    /* ---------- Update ---------- */
    const { error: updateError } = await supabase
      .from("tasks")
      .update(updates)
      .eq("id", taskId);

    if (updateError) {
      return withCors(
        { error: updateError.message },
        500
      );
    }

    return withCors({
      success: true,
      message: "Task updated (metadata only)",
    });

  } catch (err) {
    console.error("Task PATCH error:", err);
    return withCors(
      { error: "Internal server error" },
      500
    );
  }
}
