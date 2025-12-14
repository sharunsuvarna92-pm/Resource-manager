import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= CONSTANTS ================= */
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 17;
const HOURS_PER_DAY = 8;

/* ================= HELPERS ================= */

function isWeekend(date) {
  const d = date.getDay();
  return d === 0 || d === 6; // Sunday or Saturday
}

function nextWorkingDay(date) {
  const d = new Date(date);
  while (isWeekend(d)) {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(WORK_START_HOUR, 0, 0, 0);
  return d;
}

function addWorkingHours(start, hours) {
  let remaining = hours;
  let current = new Date(start);

  current = nextWorkingDay(current);

  while (remaining > 0) {
    if (isWeekend(current)) {
      current = nextWorkingDay(current);
      continue;
    }

    const endOfDay = new Date(current);
    endOfDay.setHours(WORK_END_HOUR, 0, 0, 0);

    const availableToday =
      (endOfDay - current) / (1000 * 60 * 60);

    if (remaining <= availableToday) {
      current.setHours(current.getHours() + remaining);
      remaining = 0;
    } else {
      remaining -= availableToday;
      current.setDate(current.getDate() + 1);
      current.setHours(WORK_START_HOUR, 0, 0, 0);
    }
  }

  return current;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) &&
         new Date(bStart) < new Date(aEnd);
}

/* ================= ROUTE ================= */

export async function POST(req, { params }) {
  const { id: taskId } = await params;

  if (!taskId) {
    return NextResponse.json(
      { feasible: false, reason: "Task ID missing" },
      { status: 400 }
    );
  }

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

  /* ---------- Fetch module ---------- */
  const { data: module } = await supabase
    .from("modules")
    .select("primary_roles_map, secondary_roles_map")
    .eq("id", task.module_id)
    .single();

  if (!module?.primary_roles_map) {
    return NextResponse.json(
      { feasible: false, reason: "Module ownership missing" },
      { status: 400 }
    );
  }

  /* ---------- Fetch committed assignments ---------- */
  const { data: assignments = [] } = await supabase
    .from("assignments")
    .select("*")
    .eq("status", "COMMITTED");

  const plan = {};
  const timeline = {};
  let feasible = true;
  let blocking_team = null;

  const teams = Object.keys(task.team_work);

  for (const team of teams) {
    const config = task.team_work[team];
    const effort = config.effort_hours;
    const dependsOn = config.depends_on || [];

    const candidates = [
      module.primary_roles_map[team],
      ...(module.secondary_roles_map?.[team] || [])
    ].filter(Boolean);

    let assigned = false;

    for (const memberId of candidates) {
      const memberAssignments = assignments.filter(
        a => a.member_id === memberId
      );

      const dependencyEnd = dependsOn
        .map(d => timeline[d]?.end_date)
        .filter(Boolean)
        .reduce(
          (max, d) => max && max > d ? max : d,
          null
        );

      let start = new Date(task.start_date);
      start.setHours(WORK_START_HOUR, 0, 0, 0);

      if (dependencyEnd && new Date(dependencyEnd) > start) {
        start = new Date(dependencyEnd);
      }

      // push start if overlapping other work
      for (const a of memberAssignments) {
        if (overlaps(start, addWorkingHours(start, effort), a.start_date, a.end_date)) {
          start = new Date(a.end_date);
        }
      }

      start = nextWorkingDay(start);
      const end = addWorkingHours(start, effort);

      if (end <= new Date(task.due_date)) {
        timeline[team] = {
          assigned_to: memberId,
          start_date: start.toISOString(),
          end_date: end.toISOString(),
          effort_hours: effort,
          depends_on: dependsOn,
          auto_shifted: true
        };
        plan[team] = timeline[team];
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      feasible = false;
      blocking_team = team;
      break;
    }
  }

  const estimated_delivery = Object.values(plan)
    .map(p => p.end_date)
    .reduce((max, d) => max && max > d ? max : d, null);

  return NextResponse.json({
    feasible,
    blocking_team,
    estimated_delivery,
    plan
  });
}
