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

function toIST(date) {
  return new Date(new Date(date).getTime() + IST_OFFSET_MIN * 60000);
}

function fromIST(date) {
  return new Date(new Date(date).getTime() - IST_OFFSET_MIN * 60000);
}

function isWeekend(d) {
  return d.getDay() === 0 || d.getDay() === 6;
}

function normalizeStart(d) {
  const n = new Date(d);
  n.setHours(WORK_START, 0, 0, 0);
  return n;
}

function nextWorkingDay(d) {
  const n = new Date(d);
  do {
    n.setDate(n.getDate() + 1);
  } while (isWeekend(n));
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

function maxDate(dates) {
  return new Date(Math.max(...dates.map(d => d.getTime())));
}

/* ================= TOPOLOGICAL SORT ================= */

function topoSort(teamWork) {
  const visited = new Set();
  const visiting = new Set();
  const result = [];

  function visit(team) {
    if (visited.has(team)) return;
    if (visiting.has(team)) {
      throw new Error(`Circular dependency detected at ${team}`);
    }

    visiting.add(team);

    const deps = teamWork[team]?.depends_on || [];
    for (const dep of deps) {
      visit(dep);
    }

    visiting.delete(team);
    visited.add(team);
    result.push(team);
  }

  for (const team of Object.keys(teamWork)) {
    visit(team);
  }

  return result;
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

  const taskStartIST = ensureWorkingTime(toIST(task.start_date));
  const dueIST = ensureWorkingTime(toIST(task.due_date));

  const { data: module } = await supabase
    .from("modules")
    .select("primary_roles_map, secondary_roles_map")
    .eq("id", task.module_id)
    .single();

  const { data: committed = [] } = await supabase
    .from("assignments")
    .select("*")
    .eq("status", "committed");

  let executionOrder;
  try {
    executionOrder = topoSort(task.team_work);
  } catch (err) {
    return NextResponse.json(
      { feasible: false, reason: err.message },
      { status: 400 }
    );
  }

  function buildPlan(useSecondary) {
    const timeline = {};
    let feasible = true;
    let blockingTeam = null;

    for (const team of executionOrder) {
      const effort = task.team_work[team].effort_hours;
      const dependsOn = task.team_work[team].depends_on || [];

      const owner = useSecondary
        ? module.secondary_roles_map?.[team]?.[0]
        : module.primary_roles_map?.[team];

      const dependencyEndDates = dependsOn.map(
        dep => toIST(timeline[dep].end_date)
      );

      const dependencyReady =
        dependencyEndDates.length > 0
          ? maxDate(dependencyEndDates)
          : taskStartIST;

      if (!owner) {
        feasible = false;
        blockingTeam ??= team;

        timeline[team] = {
          assigned_to: null,
          start_date: fromIST(dependencyReady).toISOString(),
          end_date: fromIST(dependencyReady).toISOString(),
          effort_hours: effort,
          depends_on: dependsOn,
          blocked: true,
          blocked_reason: "No available owner"
        };
        continue;
      }

      const busyUntilDates = committed
        .filter(a => a.member_id === owner)
        .map(a => toIST(a.end_date));

      const availableFrom =
        busyUntilDates.length > 0
          ? maxDate(busyUntilDates)
          : taskStartIST;

      const start = ensureWorkingTime(
        maxDate([dependencyReady, availableFrom])
      );

      const end = addWorkingHours(start, effort);

      timeline[team] = {
        assigned_to: owner,
        start_date: fromIST(start).toISOString(),
        end_date: fromIST(end).toISOString(),
        effort_hours: effort,
        depends_on: dependsOn,
        auto_shifted:
          start.getTime() !== taskStartIST.getTime() ||
          dependencyEndDates.length > 0,
        owner_type: useSecondary ? "secondary" : "primary"
      };

      if (end > dueIST) {
        feasible = false;
        blockingTeam ??= team;
      }
    }

    const delivery = maxDate(
      Object.values(timeline).map(t => toIST(t.end_date))
    );

    return { feasible, blockingTeam, delivery, timeline };
  }

  const primaryPlan = buildPlan(false);
  const secondaryPlan = buildPlan(true);

  let chosen;
  let feasible;

  if (primaryPlan.feasible) {
    chosen = primaryPlan;
    feasible = true;
  } else if (secondaryPlan.feasible) {
    chosen = secondaryPlan;
    feasible = true;
  } else {
    feasible = false;
    chosen =
      primaryPlan.delivery <= secondaryPlan.delivery
        ? primaryPlan
        : secondaryPlan;
  }

  const blockingTeam = feasible ? null : chosen.blockingTeam;

  const estimatedDelivery = feasible
    ? chosen.delivery
    : toIST(chosen.timeline[blockingTeam].end_date);

  return NextResponse.json({
    feasible,
    blocking_team: blockingTeam,
    estimated_delivery: fromIST(estimatedDelivery).toISOString(),
    plan: chosen.timeline
  });
}
