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
// Helper functions
// ------------------
function getEarliestStart(team, teamWork, plan, taskStart) {
  const deps = teamWork[team]?.depends_on || [];
  if (deps.length === 0) return new Date(taskStart);

  return new Date(
    Math.max(...deps.map(d => new Date(plan[d].end_date).getTime()))
  );
}

function calculateEndDate(startDate, effortHours) {
  const days = Math.max(1, Math.ceil(effortHours / 8));
  const end = new Date(startDate);
  end.setDate(end.getDate() + days);
  return end;
}

function hasConflict(assignments, memberId, start, end) {
  return assignments.some(a =>
    a.member_id === memberId &&
    a.status === "committed" &&
    new Date(a.start_date) <= end &&
    new Date(a.end_date) >= start
  );
}

// ------------------
// ANALYZE TASK
// ------------------
export async function POST(request, context) {
  try {
    // ✅ Bullet-proof task ID resolution
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

    // 3️⃣ Fetch committed assignments only
    const { data: assignments } = await supabase
      .from("assignments")
      .select("*")
      .eq("status", "committed");

    const plan = {};
    const teamWork = task.team_work || {};

    // 4️⃣ DAG-based scheduling (parallel allowed)
    for (const team of Object.keys(teamWork)) {
      const work = teamWork[team];

      // Determine earliest start
      const startDate = getEarliestStart(
        team,
        teamWork,
        plan,
        task.start_date
      );

      // Resolve owners
      const primary =
        moduleData.primary_roles_map?.[team];
      const secondary =
        moduleData.secondary_roles_map?.[team] || [];

      const candidates = [primary, ...secondary].filter(Boolean);

      let assigned = null;

      for (const memberId of candidates) {
        const endDate = calculateEndDate(startDate, work.effort_hours);

        if (!hasConflict(assignments || [], memberId, startDate, endDate)) {
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

      const endDate = calculateEndDate(startDate, work.effort_hours);

      plan[team] = {
        assigned_to: assigned,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        effort_hours: work.effort_hours,
        depends_on: work.depends_on || []
      };
    }

    // 5️⃣ Final delivery date (max end date across teams)
    const estimatedDelivery = new Date(
      Math.max(...Object.values(plan).map(p => new Date(p.end_date).getTime()))
    );

    if (estimatedDelivery > new Date(task.required_by)) {
      return withCors({
        feasible: false,
        reason: "Cannot meet required by date"
      });
    }

    // ✅ SUCCESS
    return withCors({
      feasible: true,
      estimated_delivery: estimatedDelivery.toISOString(),
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
