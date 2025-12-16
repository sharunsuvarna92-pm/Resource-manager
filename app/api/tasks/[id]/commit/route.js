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
    const { id: taskId } = await params;

    if (!taskId) {
      return withCors(
        { success: false, reason: "Task ID missing" },
        400
      );
    }

    // ------------------
    // Parse body
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

    const { plan } = body;

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
    // 🔑 DERIVE EXPECTED DELIVERY FROM PLAN (FINAL FIX)
    // ------------------
    const expectedDeliveryFromPlan = Object.values(plan)
      .map(t => new Date(t.end_date))
      .reduce((max, d) => (d > max ? d : max), new Date(0))
      .toISOString();

    // ------------------
    // Build assignments IN MEMORY
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

    // ------------------
    // Update task (GUARANTEED expected_delivery_date)
    // ------------------
    const { data: updatedTask, error: taskUpdateError } = await supabase
      .from("tasks")
      .update({
        status: "COMMITTED",
        committed_at: new Date().toISOString(),
        expected_delivery_date: expectedDeliveryFromPlan, // ✅ FINAL
      })
      .eq("id", taskId)
      .select()
      .single();

    if (taskUpdateError || !updatedTask) {
      console.error("Task update failed:", taskUpdateError);
      return withCors(
        { success: false, reason: "Task update failed during commit" },
        500
      );
    }

    // ------------------
    // Replace assignments
    // ------------------
    await supabase
      .from("assignments")
      .delete()
      .eq("task_id", taskId)
      .neq("status", "committed");

    await supabase
      .from("assignments")
      .insert(assignmentRows);

    return withCors({
      success: true,
      message: "Task and assignments committed successfully",
      task_id: taskId,
      expected_delivery_date: expectedDeliveryFromPlan,
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
