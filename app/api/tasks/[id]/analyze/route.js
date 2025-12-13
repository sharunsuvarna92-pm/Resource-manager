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
// ANALYZE TASK
// ------------------
export async function POST(request, context) {
  try {
    // ✅ SAFE param extraction (CRITICAL FIX)
    const taskId = context?.params?.id;

    if (!taskId) {
      return withCors(
        { feasible: false, reason: "Task ID missing in route params" },
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

    // 3️⃣ Fetch committed assignments ONLY
    const { data: assignments } = await supabase
      .from("assignments")
      .select("*")
      .eq("status", "committed");

    let currentDate = new Date(task.start_date);
    const plan = {};

    // 4️⃣ Analyze team_work sequentially (dependency-aware)
    for (const [teamName, work] of Object.entries(task.team_work || {})) {
      const effortHours = work.effort_hours || 0;
      const effortDays = Math.max(1, Math.ceil(effortHours / 8));

      const primaryOwner =
        moduleData.primary_roles_map?.[teamName];

      const secondaryOwners =
        moduleData.secondary_roles_map?.[teamName] || [];

      const candidates = [primaryOwner, ...secondaryOwners].filter(Boolean);

      let assignedMember = null;

      for (const memberId of candidates) {
        const hasConflict = assignments?.some(a =>
          a.member_id === memberId &&
          !(new Date(a.end_date) < currentDate ||
            new Date(a.start_date) > new Date(task.required_by))
        );

        if (!hasConflict) {
          assignedMember = memberId;
          break;
        }
      }

      if (!assignedMember) {
        return withCors({
          feasible: false,
          reason: `${teamName} team has no available resources`,
          blocking_team: teamName
        });
      }

      const endDate = new Date(currentDate);
      endDate.setDate(endDate.getDate() + effortDays);

      plan[teamName] = {
        assigned_to: assignedMember,
        start_date: currentDate.toISOString(),
        end_date: endDate.toISOString(),
        effort_hours: effortHours
      };

      // Dependency chain: next team starts after this one
      currentDate = endDate;
    }

    // 5️⃣ Final delivery check
    if (currentDate > new Date(task.required_by)) {
      return withCors({
        feasible: false,
        reason: "Cannot meet required by date"
      });
    }

    // ✅ SUCCESS
    return withCors({
      feasible: true,
      estimated_delivery: currentDate.toISOString(),
      plan
    });

  } catch (err) {
    console.error("Analyzer error:", err);
    return withCors(
      { feasible: false, reason: "Internal analyzer error" },
      500
    );
  }
}
