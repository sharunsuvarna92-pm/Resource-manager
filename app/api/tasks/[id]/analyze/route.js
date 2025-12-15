import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= CONFIG ================= */

const IST_OFFSET_MIN = 330;
const WORK_START = 9;   // 9 AM IST
const WORK_END = 17;    // 5 PM IST

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

const maxDate = dates => new Date(Math.max(...dates.map(d => d.getTime())));

/* ================= DUE DATE HELPER (FINAL CHANGE) ================= */

function endOfWorkDayIST(date) {
  const d = toIST(date);
  d.setHours(17, 0, 0, 0); // 5:00 PM IST
  return d;
}

/* ================= TOPOLOGICAL SORT ================= */

function topoSort(teamWork) {
  const visited = new Set();
  const visiting = new Set();
  const order = [];

  function visit(team) {
    if (visited.has(team)) return;
    if (visiting.has(team)) throw new Error("Circular dependency detected");

    visiting.add(team);
    for (const dep of teamWork[team].depends_on || []) visit(dep);
    visiting.delete(team);

    visited.add(team);
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

  // ✅ FINAL: Due date = 5 PM IST on due date
  const dueDate = endOfWorkDayIST(task.due_date);

  const { data: module } = await supabase
    .from("modules")
    .select("primary_roles_map, secondary_roles_map")
    .eq("id", task.module_id)
    .single();

  const { data: committed = [] } = await supabase
    .from("assignments")
    .select("*")
    .eq("status", "committed");

  const order = topoSort(task.team_work);

  /* ---------- Owner availability ---------- */

  function earliestAvailability(memberId) {
    const busy = committed
      .filter(a => a.member_id === memberId)
      .map(a => toIST(a.end_date));

    return busy.length ? maxDate(busy) : taskStart;
  }

  /* ---------- Build plan for a given owner map ---------- */

  function buildPlan(ownerMap) {
    const timeline = {};

    for (const team of order) {
      const effort = task.team_work[team].effort_hours;
      const dependsOn = task.team_work[team].depends_on || [];
      const owner = ownerMap[team];

      const depEnd =
        dependsOn.length > 0
          ? maxDate(dependsOn.map(d => toIST(timeline[d].end_date)))
          : taskStart;

      const ownerReady = owner
        ? earliestAvailability(owner)
        : depEnd;

      const start = ensureWorkingTime(maxDate([depEnd, ownerReady]));
      const end = owner ? addWorkingHours(start, effort) : start;

      timeline[team] = {
        assigned_to: owner,
        start_date: fromIST(start).toISOString(),
        end_date: fromIST(end).toISOString(),
        effort_hours: effort,
        depends_on: dependsOn,
        owner_type:
          owner === module.primary_roles_map[team]
            ? "primary"
            : "secondary"
      };
    }

    const delivery = maxDate(
      Object.values(timeline).map(t => toIST(t.end_date))
    );

    return { timeline, delivery };
  }

  /* ---------- Generate all paths ---------- */

  const teams = order;
  const paths = [];

  function generate(idx, map) {
    if (idx === teams.length) {
      paths.push(buildPlan(map));
      return;
    }

    const team = teams[idx];
    const primary = module.primary_roles_map?.[team];
    const secondary = module.secondary_roles_map?.[team]?.[0];

    if (primary) generate(idx + 1, { ...map, [team]: primary });
    if (secondary) generate(idx + 1, { ...map, [team]: secondary });
  }

  generate(0, {});

  /* ---------- Select chosen path ---------- */

  const allPrimary = paths.find(p =>
    Object.values(p.timeline).every(t => t.owner_type === "primary")
  );

  let chosen;
  let feasible = false;

  if (allPrimary && allPrimary.delivery <= dueDate) {
    chosen = allPrimary;
    feasible = true;
  } else {
    const fitting = paths.filter(p => p.delivery <= dueDate);
    if (fitting.length > 0) {
      chosen = fitting.sort((a, b) => a.delivery - b.delivery)[0];
      feasible = true;
    } else {
      chosen = paths.sort((a, b) => a.delivery - b.delivery)[0];
    }
  }

  const blockingTeam = feasible
    ? null
    : Object.entries(allPrimary.timeline)
        .sort(
          (a, b) =>
            new Date(b[1].end_date) - new Date(a[1].end_date)
        )[0][0];

  return NextResponse.json({
    feasible,
    blocking_team: blockingTeam,
    estimated_delivery: fromIST(chosen.delivery).toISOString(),
    plan: chosen.timeline
  });
}
