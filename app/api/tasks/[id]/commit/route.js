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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function OPTIONS() {
  return withCors({});
}

export async function POST(request, { params }) {
  try {
    const { id: taskId } = await params;
    const { plan, estimated_delivery } = await request.json();

    if (!taskId || !plan) {
      return withCors(
        { success: false, reason: "Invalid commit payload" },
        400
      );
    }

    /* -------------------------------------------------
       1️⃣ Update TASK (ONLY VALID COLUMNS)
       ------------------------------------------------- */
    const { error: taskError } = await supabase
      .from("tasks")
      .update({
        status: "committed",
        expected_delivery_date: estimated_delivery,
      })
      .eq("id", taskId);

    if (taskError) {
      console.error("Task update error:", taskError);
      return withCors(
        { success: false, reason: taskError.message },
        500
      );
    }

    /* -------------------------------------------------
       2️⃣ Fetch DRAFT assignments for this task
       ------------------------------------------------- */
    const { data: draftAssignments, error: fetchError } = await supabase
      .from("assignments")
      .select("id, team")
      .eq("task_id", taskId)
      .eq("status", "draft");

    if (fetchError) {
      console.error("Draft fetch error:", fetchError);
      return withCors(
        { success: false, reason: fetchError.message },
        500
      );
    }

    /* -------------------------------------------------
       3️⃣ Update each assignment by PRIMARY KEY
       ------------------------------------------------- */
    for (const assignment of draftAssignments) {
      const planData = plan[assignment.team];
      if (!planData) continue;

      const { error } = await supabase
        .from("assignments")
        .update({
          member_id: planData.assigned_to,
          start_date: planData.start_date,
          end_date: planData.end_date,
          assigned_hours: planData.effort_hours,
          status: "committed",
          auto_shifted: planData.auto_shifted || false,
          source: "analysis",
        })
        .eq("id", assignment.id);

      if (error) {
        console.error("Assignment update error:", error);
        return withCors(
          { success: false, reason: error.message },
          500
        );
      }
    }

    return withCors({
      success: true,
      message: "Task and assignments committed successfully",
    });

  } catch (err) {
    console.error("Commit crash:", err);
    return withCors(
      { success: false, reason: "Internal commit error" },
      500
    );
  }
}
