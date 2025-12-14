import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= CONFIG ================= */

const IST_OFFSET_MINUTES = 330; // UTC +5:30
const WORK_START_HOUR = 9;      // 9 AM IST
const WORK_END_HOUR = 17;       // 5 PM IST

/* ================= TIME HELPERS (IST) ================= */

function toIST(date) {
  const d = new Date(date);
  return new Date(d.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
}

function fromIST(date) {
  const d = new Date(date);
  return new Date(d.getTime() - IST_OFFSET_MINUTES * 60 * 1000);
}

function isWeekendIST(date) {
  const d = toIST(date);
  const day = d.getDay();
  return day === 0 || day === 6;
}

function nextWorkingDayIST(date) {
  let d = toIST(date);

  do {
    d.setDate(d.getDate() + 1);
  } while (isWeekendIST(fromIST(d)));

  d.setHours(WORK_START_HOUR, 0, 0, 0);
  return fromIST(d);
}

function normalizeToWorkingStartIST(date) {
  let d = toIST(date);

  if (isWeekendIST(date)) {
    return nextWorkingDayIST(date);
  }

  if (d.getHours() >= WORK_END_HOUR) {
    return nextWorkingDayIST(date);
  }

  if (d.getHours() < WORK_START_HOUR) {
    d.setHours(WORK_START_HOUR, 0, 0, 0);
  }

  return fromIST(d);
}

function addWorkingHoursIST(start, hours) {
  let remaining = hours;
  let current = normalizeToWorkingStartIST(start);

  while (remaining > 0) {
    if (isWeekendIST(current)) {
      current = nextWorkingDayIST(current);
      continue;
    }

    const istCurrent = toIST(current);
    const endOfDay = new Date(istCurrent);
    endOfDay.setHours(WORK_END_HOUR, 0, 0, 0);

    const availableToday =
      (endOfDay.getTime() - istCurrent.getTime()) / (1000 * 60 * 60);

    if (remaining <= availableToday) {
      istCurrent.setHours(istCurrent.getHours() + remaining);
      remaining = 0;
      current = fromIST(istCurrent);
    } else {
      remaining -= availableToday;
      current = nextWorkingDayIST(current);
    }
  }

  return current;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) &&
         new Date(bStart) < new Date(aEnd);
}

/* -------- Dependency-aware team ordering -------- */

function sortTeamsByDependencies(teamWork) {
  const visited = new Set();
  const result = [];

  function visit(team) {
    if (visited.has(team)) return;
    visited.add(team);

    const deps = teamWork[team]?.depends_on || [];
    for (const dep of deps) {
      visit(dep);
    }

    result.push(team);
  }

  for (const team of Object.keys(teamWork)) {
    visit(team);
  }

  return result;
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

  const teams = sortTeamsByDependencies(task.team_work);

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
        .map(dep => timeline[dep]?.end_date)
        .filter(Boolean)
        .reduce(
          (max, d) => max && max > d ? max : d,
          null
        );

      let start = new Date(task.start_date);

      if (dependencyEnd && new Date(dependencyEnd) > start) {
        start = new Date(dependencyEnd);
      }

      start = normalizeToWorkingStartIST(start);

      for (const a of memberAssignments) {
        if (
          overlaps(
            start,
            addWorkingHoursIST(start, effort),
            a.start_date,
            a.end_date
          )
        ) {
          start = normalizeToWorkingStartIST(a.end_date);
        }
      }

      const end = addWorkingHoursIST(start, effort);

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
