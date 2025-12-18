import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= CONFIG ================= */

const IST_OFFSET_MIN = 330;
const WORK_START = 9;
const WORK_END = 17;

/* ================= TIME HELPERS ================= */

const toIST = d => new Date(new Date(d).getTime() + IST_OFFSET_MIN * 60000);
const fromIST = d => new Date(new Date(d).getTime() - IST_OFFSET_MIN * 60000);
const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;

function normalizeStart(d) {
  const n = new Date(d);
  n.setHours(WORK_START, 0, 0, 0);
  return n;
}

function nextWorkingDay(d) {
  const n = new Date(d);
  do n.setDate(n.getDate() + 1);
  while (isWeekend(n));
  return normalizeStart(n);
}

function ensureWorkingTime(d) {
  const n = new Date(d);
  if (isWeekend(n)) return nextWorkingDay(n);
  if (n.getHours() < WORK_START) return normalizeStart(n);
  if (n.getHours() >= WORK_END) return nextWorkingDay(n);
  return n;
}

function addWorkingHours(start, hours) {
  let remaining = hours;
  let current = ensureWorkingTime(start);

  while (remaining > 0) {
    const endOfDay = new Date(current);
    endOfDay.setHours(WORK_END, 0, 0, 0);

    const available =
      (endOfDay.getTime() - current.getTime()) / 3600000;

    if (remaining <= available) {
      current.setHours(current.getHours() + remaining);
      break;
    }

    remaining -= available;
    current = nextWorkingDay(current);
  }

  return current;
}

const maxDate = dates =>
  new Date(Math.max(...dates.map(d => d.getTime())));

function endOfWorkDayIST(date) {
  const d = toIST(date);
  d.setHours(17, 0, 0, 0);
  return d;
}

/* ================= TOPO SORT ================= */

function topoSort(teamWork) {
  const visited = new Set();
  const order = [];

  function visit(team) {
    if (visited.has(team)) return;
    visited.add(team);
    for (const dep of teamWork[team].depends_on || []) visit(dep);
    order.push(team);
  }

  Object.keys(teamWork).forEach(visit);
  return order;
}

/* ================= ANALYZE ================= */

export async function POST(req, { params }) {
  const { id: taskId } = await params;

  const { data: task } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (!task) {
    return NextResponse.json({ feasible: false }, { status: 404 });
  }

  const taskStart = ensureWorkingTime(toIST(task.start_date));
  const dueDate = endOfWorkDayIST(task.due_date);

  /* ---------- OWNERS ---------- */
  const { data: owners = [] } = await supabase
    .from("module_owners")
    .select("team_id, member_id, role")
    .eq("module_id", task.module_id);

  const ownersByTeam = {};
  for (const o of owners) {
    if (!ownersByTeam[o.team_id]) {
      ownersByTeam[o.team_id] = { primary: null, secondaries: [] };
    }
    if (o.role === "PRIMARY") {
      ownersByTeam[o.team_id].primary = o.member_id;
    } else {
      ownersByTeam[o.team_id].secondaries.push(o.member_id);
    }
  }

  /* ---------- COMMITTED CAPACITY ---------- */
  const { data: committed = [] } = await supabase
    .from("assignments")
    .select(`
      member_id,
      task_id,
      start_date,
      end_date,
      tasks (
        title,
        priority
      )
    `)
    .eq("status", "committed")
    .eq("counts_toward_capacity", true);

  const order = topoSort(task.team_work);

  function earliestAvailability(memberId) {
    const busy = committed
      .filter(a => a.member_id === memberId)
      .map(a => toIST(a.end_date));
    return busy.length ? maxDate(busy) : taskStart;
  }

  function buildPlan(ownerMap) {
    const timeline = {};
    let primaryCount = 0;

    for (const team of order) {
      const effort = task.team_work[team].effort_hours;
      const dependsOn = task.team_work[team].depends_on || [];
      const owner = ownerMap[team];

      const depEnd = dependsOn.length
        ? maxDate(dependsOn.map(d => toIST(timeline[d].end_date)))
        : taskStart;

      const ownerReady = owner
        ? earliestAvailability(owner)
        : depEnd;

      const start = ensureWorkingTime(maxDate([depEnd, ownerReady]));
      const end = owner ? addWorkingHours(start, effort) : start;

      const isPrimary = owner === ownersByTeam[team]?.primary;
      if (isPrimary) primaryCount++;

      timeline[team] = {
        assigned_to: owner,
        start_date: fromIST(start).toISOString(),
        end_date: fromIST(end).toISOString(),
        effort_hours: effort,
        depends_on: dependsOn,
        owner_type: isPrimary ? "primary" : "secondary"
      };
    }

    const delivery = maxDate(
      Object.values(timeline).map(t => toIST(t.end_date))
    );

    return { timeline, delivery, primaryCount };
  }

  /* ---------- GENERATE PATHS ---------- */
  const teams = order;
  const paths = [];

  function generate(idx, map) {
    if (idx === teams.length) {
      paths.push(buildPlan(map));
      return;
    }

    const team = teams[idx];
    const { primary, secondaries } = ownersByTeam[team] || {};

    if (primary) generate(idx + 1, { ...map, [team]: primary });
    for (const s of secondaries || []) {
      generate(idx + 1, { ...map, [team]: s });
    }
  }

  generate(0, {});

  /* ---------- PATH SELECTION ---------- */
  const allPrimary = paths.find(
    p => p.primaryCount === teams.length && p.delivery <= dueDate
  );

  let chosen;
  let feasible = false;

  if (allPrimary) {
    chosen = allPrimary;
    feasible = true;
  } else {
    const feasiblePaths = paths.filter(p => p.delivery <= dueDate);
    if (feasiblePaths.length) {
      feasible = true;
      chosen = feasiblePaths.sort((a, b) => {
        if (b.primaryCount !== a.primaryCount) {
          return b.primaryCount - a.primaryCount;
        }
        return a.delivery - b.delivery;
      })[0];
    } else {
      chosen = paths.sort((a, b) => a.delivery - b.delivery)[0];
    }
  }

  /* ================= BLOCKING EXPLANATION (STEP 4) ================= */

  let blocking_reason = null;
  let recommendation = null;

  if (!feasible && chosen) {
    // 1️⃣ Dependency-based blocking
    for (const [team, data] of Object.entries(chosen.timeline)) {
      for (const dep of data.depends_on || []) {
        const depEnd = new Date(chosen.timeline[dep].end_date);
        if (depEnd > dueDate) {
          blocking_reason = {
            type: "DEPENDENCY_BLOCK",
            team,
            depends_on: dep,
            message:
              `Work for team ${team} cannot start before ${depEnd.toISOString()} because it depends on ${dep}, which itself completes after the due date.`,
            why:
              "Dependent work starts only after prerequisite work completes, leaving no working window before the due date."
          };

          recommendation = {
            action: "ADJUST_DEPENDENCY_OR_DUE_DATE",
            message:
              "Consider reprioritizing or parallelizing dependent work, or extend the due date."
          };
          break;
        }
      }
      if (blocking_reason) break;
    }

    // 2️⃣ Resource-based blocking
    if (!blocking_reason) {
      const [blockingTeam, blockData] = Object.entries(chosen.timeline)
        .sort((a, b) => new Date(b[1].end_date) - new Date(a[1].end_date))[0];

      const conflict = committed.find(
        a => a.member_id === blockData.assigned_to
      );

      if (conflict) {
        blocking_reason = {
          type: "RESOURCE_CONFLICT",
          team: blockingTeam,
          member_id: blockData.assigned_to,
          conflicting_task: {
            id: conflict.task_id,
            title: conflict.tasks?.title,
            priority: conflict.tasks?.priority
          },
          conflict_window: {
            from: conflict.start_date,
            to: conflict.end_date
          },
          message:
            "The assigned owner is already committed during the only remaining working window before the due date.",
          why:
            "This overlap eliminates all remaining working hours required to complete the task before the due date."
        };

        recommendation = {
          action: "REPRIORITIZE_OR_DELAY",
          message:
            "If this task has higher priority, consider reprioritizing the conflicting task or extending the due date."
        };
      }
    }
  }

  return NextResponse.json({
    feasible,
    estimated_delivery: fromIST(chosen.delivery).toISOString(),
    blocking_reason,
    recommendation,
    plan: chosen.timeline
  });
}
