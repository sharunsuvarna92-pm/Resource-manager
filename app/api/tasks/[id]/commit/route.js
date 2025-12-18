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
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

export async function OPTIONS() {
  return withCors({});
}

export async function POST(request, { params }) {
  try {
    const { id: taskId } = await params;
    const { plan } = await request.json();

    if (!taskId || !plan) {
      return withCors({ error: "Invalid commit payload" }, 400);
    }

    const expectedDelivery = Object.values(plan)
      .map(p => new Date(p.end_date))
      .reduce((a, b) => (b > a ? b : a))
      .toISOString();

    const assignments = Object.entries(plan).map(([team, p]) => ({
      task_id: taskId,
      team,
      member_id: p.assigned_to,
      start_date: p.start_date,
      end_date: p.end_date,
      assigned_hours: p.effort_hours,
      status: "committed",
      counts_toward_capacity: true,
      source: "analysis",
      created_at: new Date().toISOString()
    }));

    await supabase
      .from("tasks")
      .update({
        status: "COMMITTED",
        expected_delivery_date: expectedDelivery
      })
      .eq("id", taskId);

    await supabase.from("assignments").insert(assignments);

    return withCors({
      success: true,
      expected_delivery_date: expectedDelivery,
      assignments_created: assignments.length
    });

  } catch (err) {
    console.error("Commit error:", err);
    return withCors({ error: "Commit failed" }, 500);
  }
}
