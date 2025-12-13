import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

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

export async function POST(request, context) {
  try {
    // ✅ BULLETPROOF TASK ID RESOLUTION
    let taskId = context?.params?.id;

    if (!taskId) {
      const urlParts = new URL(request.url).pathname.split("/");
      taskId = urlParts[urlParts.indexOf("tasks") + 1];
    }

    if (!taskId) {
      return withCors(
        { feasible: false, reason: "Task ID missing" },
        400
      );
    }

    // 1️⃣ Fetch task
    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .single();

    if (taskErr || !task) {
      return withCors(
        { feasible: false, reason: "Task not found" },
        404
      );
    }

    // 2️⃣ Fetch module ownership
    const { data: moduleData, error: moduleErr } = await supabase
      .from("modules")
      .select("primary_roles_map, secondary_roles_map")
      .eq("id", task.module_id)
      .single();

    if (moduleErr || !moduleData) {
      return withCors(
        { feasible: false, reason: "Module not found" },
        404
      );
    }

    // 3️⃣ Fetch committed assignments
    const { data: assignments } = await supabase
      .from("assignments")
      .select("*")
      .eq("status", "committed");

    let currentDate = new Date(task.start_date);
    const plan = {};

    // 4️⃣ Analyze team_work sequentially
    for (const [team, work] of Object.entries(task.team_work || {})) {
      const effortDays = Math.max(
        1,
        Math.ceil((work.effort_hours || 0) / 8)
      );

      const primary =
        moduleData.primary_roles_map?.[team];
      const secondary =
        moduleData.secondary_roles_map?.[team] || [];

      const candidates = [primary, ...secondary].filter(Boolean);

      let assigned = null;

      for (const memberId of candidates) {
        const conflict = assignments?.some(a =>
          a.member_id === memberId &&
          !(new Date(a.end_date) < currentDate ||
            new Date(a.start_date) > new Date(task.required_by))
        );

        if (!conflict) {
          assigned = memberId;
          break;
        }
      }

      if (!assigned) {
        return withCors({
          feasible: false,
          reason: `${team} team has no available resources`,
          blocking_team: team
        });
      }

      const endDate = new Date(currentDate);
      endDate.setDate(endDate.getDate() + effortDays);

      plan[team] = {
        assigned_to: assigned,
        start_date: currentDate.toISOString(),
        end_date: endDate.toISOString(),
        effort_hours: work.effort_hours || 0
      };

      currentDate = endDate;
    }

    if (currentDate > new Date(task.required_by)) {
      return withCors({
        feasible: false,
        reason: "Cannot meet required by date"
      });
    }

    return withCors({
      feasible: true,
      estimated_delivery: currentDate.toISOString(),
      plan
    });

  } catch (err) {
    console.error("Analyzer crash:", err);
    return withCors(
      { feasible: false, reason: "Internal analyzer error" },
      500
    );
  }
}
