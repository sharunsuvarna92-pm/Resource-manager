import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ---------------- Time Helpers (IST) ---------------- */

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 17;
const HOURS_PER_DAY = 8;

function toIST(date) {
  return new Date(
    new Date(date).toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );
}

function isWeekend(date) {
  const d = date.getDay();
  return d === 0 || d === 6;
}

function nextWorkingDay(date) {
  const d = new Date(date);
  while (isWeekend(d)) d.setDate(d.getDate() + 1);
  d.setHours(WORK_START_HOUR, 0, 0, 0);
  return d;
}

function addWorkingHours(start, hours) {
  let remaining = hours;
  let current = new Date(start);

  while (remaining > 0) {
    if (isWeekend(current)) {
      current = nextWorkingDay(current);
      continue;
    }

    const endOfDay = new Date(current);
    endOfDay.setHours(WORK_END_HOUR, 0, 0, 0);

    const available =
      (endOfDay - current) / (1000 * 60 * 60);

    if (remaining <= available) {
      current.setHours(current.getHours() + remaining);
      remaining = 0;
    } else {
      remaining -= available;
      current = nextWorkingDay(
        new Date(current.setDate(current.getDate() + 1))
      );
    }
  }

  return current;
}

function maxDate(dates) {
  return new Date(Math.max(...dates.map(d => d.getTime())));
}

/* ---------------- Core Analyze ---------------- */

export async function POST(req, { params }) {
  const { id: taskId } = await params;

  /* ---------- Fetch task ---------- */
  const { data: task } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (!task) {
    return NextResponse.json(
      { feasible: false, reason: "Task not found" },
      { status: 404 }
    );
  }

  const dueDate = toIST(task.due_date);
  const taskStart = nextWorkingDay(toIST(task.start_date));

  /* ---------- Fetch module owners ---------- */
  const { data: module } = await supabase
    .from("modules")
    .select("primary_roles_map, secondary_roles_map")
    .eq("id", task.module_id)
    .single();

  /* ---------- Fetch committed assignments ---------- */
  const { data: committed = [] } = await supabase
    .from("assignments")
    .select("*")
    .eq("status", "committed");

  /* ---------- Build candidate plans ---------- */
  const candidates = [];

  function buildPlan(useSecondary = false) {
    const timeline = {};
    let feasible = true;
    let blockingTeam = null;

    for (const team of Object.keys(task.team_work)) {
      const effort = task.team_work[team].effort_hours;
      const dependsOn = task.team_work[team].depends_on || [];

      const owner =
        !useSecondary
          ? module.primary_roles_map?.[team]
          : module.secondary_roles_map?.[team]?.[0];

      if (!owner) {
        feasible = false;
        blockingTeam = team;
        continue;
      }

      const dependencyEndDates = dependsOn
        .map(d => timeline[d]?.end_date)
        .filter(Boolean)
        .map(d => toIST(d));

      const dependencyReady =
        dependencyEndDates.length > 0
          ? maxDate(dependencyEndDates)
          : taskStart;

      const memberBusyUntil = committed
        .filter(a => a.member_id === owner)
        .map(a => toIST(a.end_date));

      const availableFrom =
        memberBusyUntil.length > 0
          ? maxDate(memberBusyUntil)
          : taskStart;

      let start = nextWorkingDay(
        maxDate([dependencyReady, availableFrom])
      );

      const end = addWorkingHours(start, effort);

      timeline[team] = {
        assigned_to: owner,
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        effort_hours: effort,
        depends_on: dependsOn,
        auto_shifted:
          start > taskStart || dependencyEndDates.length > 0
      };

      if (end > dueDate) {
        feasible = false;
        blockingTeam = team;
      }
    }

    const delivery = maxDate(
      Object.values(timeline).map(t => toIST(t.end_date))
    );

    return {
      feasible,
      blockingTeam,
      delivery,
      timeline,
      usesSecondary: useSecondary
    };
  }

  const primaryPlan = buildPlan(false);
  const secondaryPlan = buildPlan(true);

  /* ---------- Select final plan ---------- */

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

  /* ---------- Final response ---------- */

  const blockingTeam = feasible ? null : chosen.blockingTeam;

  const estimatedDelivery = feasible
    ? chosen.delivery
    : toIST(chosen.timeline[blockingTeam].end_date);

  return NextResponse.json({
    feasible,
    blocking_team: blockingTeam,
    estimated_delivery: estimatedDelivery.toISOString(),
    plan: chosen.timeline
  });
}
