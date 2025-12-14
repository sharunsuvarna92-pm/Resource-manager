import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= CONFIG ================= */

const WORK_START_HOUR = 9;   // 9 AM
const WORK_END_HOUR = 17;    // 5 PM
const HOURS_PER_DAY = 8;

/* ================= HELPERS ================= */

function isWeekend(date) {
  const d = date.getDay();
  return d === 0 || d === 6; // Sunday or Saturday
}

function nextWorkingDay(date) {
  const d = new Date(date);
  do {
    d.setDate(d.getDate() + 1);
  } while (isWeekend(d));
  d.setHours(WORK_START_HOUR, 0, 0, 0);
  return d;
}

function normalizeToWorkingStart(date) {
  const d = new Date(date);

  // Weekend → next working day
  if (isWeekend(d)) {
    return nextWorkingDay(d);
  }

  // After work hours → next working day
  if (d.getHours() >= WORK_END_HOUR) {
    return nextWorkingDay(d);
  }

  // Before work hours → same day 9 AM
  if (d.getHours() < WORK_START_HOUR) {
    d.setHours(WORK_START_HOUR, 0, 0, 0);
  }

  return d;
}

function addWorkingHours(start, hours) {
  let remaining = hours;
  let current = normalizeToWorkingStart(start);

  while (remaining > 0) {
    if (isWeekend(current)) {
      current = nextWorkingDay(current);
      continue;
    }

    const endOfDay = new Date(current);
    endOfDay.setHours(WORK_END_HOUR, 0, 0, 0);

    const availableToday =
      (endOfDay.getTime() - current.getTime()) / (1000 * 60 * 60);

    if (remaining <= availableToday) {
      current.setHours(current.getHours() + remaining);
      remaining = 0;
    } else {
      remaining -= availableToday;
      current = nextWorkingDay(current);
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
      { feasible: false, reason: "Module ownership not defined" },
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

      /* ---- Dependency constraint ---- */
      const dependencyEnd = dependsOn
        .map(d => timeline[d]?.end_date)
        .filter(Boolean)
        .reduce(
          (max, d) => max && max > d ? max : d,
          null
        );

      let start = new Date(task.start_date);

      if (dependencyEnd && new Date(dependencyEnd) > start) {
        start = new Date(dependencyEnd);
      }

      start = normalizeToWorkingStart(start);

      /* ---- Availability constraint ---- */
      for (const a of memberAssignments) {
        if (
          overlaps(
            start,
            addWorkingHours(start, effort),
            a.start_date,
            a.end_date
          )
        ) {
          start = normalizeToWorkingStart(a.end_date);
        }
      }

      const end = addWorkingHours(start, effort);

      /* ---- Due date check ---- */
      if (end <= new Date(task.due_date)) {
        timeline[team] = {
          assigned_to: memberId,
          start_date: start.toISOString(),
          end_date: end.toISOString(),
          effort_hours: effort,
          depends_on: dependsOn,
          auto_shifted:
            start.getTime() !==
            new Date(task.start_date).getTime()
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
