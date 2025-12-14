import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ------------------
// Helpers
// ------------------
function addHours(date, hours) {
  const d = new Date(date);
  d.setHours(d.getHours() + hours);
  return d;
}

function maxDate(dates) {
  return new Date(Math.max(...dates.map(d => new Date(d).getTime())));
}

// ------------------
// ANALYZE TASK
// ------------------
export async function POST(request, { params }) {
  try {
    const { id: taskId } = await params;

    const { data: task } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .single();

    if (!task) {
      return new Response(
        JSON.stringify({ error: "Task not found" }),
        { status: 404 }
      );
    }

    const { data: module } = await supabase
      .from("modules")
      .select("primary_roles_map, secondary_roles_map")
      .eq("id", task.module_id)
      .single();

    const { data: committedAssignments } = await supabase
      .from("assignments")
      .select("*")
      .eq("status", "committed")
      .neq("task_id", taskId);

    const plan = {};
    const conflicts = [];
    const timelineEnd = {};

    for (const [team, work] of Object.entries(task.team_work)) {
      const { effort_hours, depends_on = [] } = work;

      let start = depends_on.length
        ? maxDate(depends_on.map(d => timelineEnd[d]).filter(Boolean))
        : new Date(task.start_date);

      let assignedTo = module.primary_roles_map?.[team];
      let autoShifted = false;

      const isAvailable = (memberId) => {
        return committedAssignments
          .filter(a => a.member_id === memberId)
          .every(a =>
            new Date(a.end_date) <= start ||
            new Date(a.start_date) >= addHours(start, effort_hours)
          );
      };

      if (!isAvailable(assignedTo)) {
        const secondaries = module.secondary_roles_map?.[team] || [];
        const availableSecondary = secondaries.find(isAvailable);

        if (availableSecondary) {
          assignedTo = availableSecondary;
          autoShifted = true;
        } else {
          const busyAssignments = committedAssignments.filter(
            a => a.member_id === assignedTo
          );

          const latestEnd = maxDate(busyAssignments.map(a => a.end_date));
          conflicts.push({
            team,
            member_id: assignedTo,
            overlap_start: task.start_date,
            overlap_end: latestEnd.toISOString()
          });

          start = latestEnd;
          autoShifted = true;
        }
      }

      const end = addHours(start, effort_hours);

      plan[team] = {
        assigned_to: assignedTo,
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        effort_hours,
        depends_on,
        auto_shifted: autoShifted
      };

      timelineEnd[team] = end;
    }

    const estimatedDelivery = maxDate(Object.values(timelineEnd));
    const feasible = estimatedDelivery <= new Date(task.due_date);

    return new Response(
      JSON.stringify({
        feasible,
        estimated_delivery: estimatedDelivery.toISOString(),
        plan,
        conflicts,
        reason: feasible ? null : "One or more teams are overloaded"
      }),
      { status: 200 }
    );

  } catch (err) {
    console.error("Analyze crash:", err);
    return new Response(
      JSON.stringify({ error: "Internal analysis error" }),
      { status: 500 }
    );
  }
}
