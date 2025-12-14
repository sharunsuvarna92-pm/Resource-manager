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
  const { id: taskId } = await params;
  const { plan, estimated_delivery } = await request.json();

  if (!taskId || !plan) {
    return withCors({ success: false, reason: "Invalid commit payload" }, 400);
  }

  // 1️⃣ Update task status
  await supabase
    .from("tasks")
    .update({
      status: "COMMITTED",
      committed_at: new Date().toISOString(),
      estimated_delivery,
    })
    .eq("id", taskId);

  // 2️⃣ Update existing DRAFT assignments → COMMITTED
  for (const [team, data] of Object.entries(plan)) {
    await supabase
      .from("assignments")
      .update({
        member_id: data.assigned_to,
        start_date: data.start_date,
        end_date: data.end_date,
        assigned_hours: data.effort_hours,
        status: "COMMITTED",
        auto_shifted: data.auto_shifted || false,
        source: "analysis",
      })
      .eq("task_id", taskId)
      .eq("team", team)
      .eq("status", "draft");
  }

  return withCors({
    success: true,
    message: "Task and assignments committed successfully",
  });
}
