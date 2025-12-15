import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= CONFIG ================= */

const IST_OFFSET_MIN = 330; // +05:30
const WORK_START = 9;       // 09:00 IST
const WORK_END = 17;        // 17:00 IST

/* ================= TIME HELPERS ================= */

function toIST(date) {
  const d = new Date(date);
  return new Date(d.getTime() + IST_OFFSET_MIN * 60 * 1000);
}

function fromIST(date) {
  const d = new Date(date);
  return new Date(d.getTime() - IST_OFFSET_MIN * 60 * 1000);
}

function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function normalizeToWorkStart(d) {
  const nd = new Date(d);
  nd.setHours(WORK_START, 0, 0, 0);
  return nd;
}

function nextWorkingDay(d) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + 1);
  while (isWeekend(nd)) {
    nd.setDate(nd.getDate() + 1);
  }
  return normalizeToWorkStart(nd);
}

function ensureWorkingTime(d) {
  const nd = new Date(d);

  if (isWeekend(nd)) return nextWorkingDay(nd);
  if (nd.getHours() < WORK_START) return normalizeToWorkStart(nd);
  if (nd.getHours() >= WORK_END) return nextWorkingDay(nd);

  return nd;
}

function addWorkingHours(start, hours) {
  let remaining = hours;
  let current = ensureWorkingTime(start);

  while (remaining > 0) {
    const endOfDay = new Date(current);
    endOfDay.setHours(WORK_END, 0, 0, 0);

    const available =
      (endOfDay.getTime() - current.getTime()) / (1000 * 60 * 60);

    if (remaining <= available) {
      current.setHours(current.getHours() + remaining);
      remaining = 0;
    } else {
      remaining -= available;
      current = nextWorkingDay(current);
    }
  }

  return current;
}

function maxDate(dates) {
  return new Date(Math.max(...dates.map(d => d.getTime())));
}

/* ================= ANALYZE ================= */

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

  const taskStartIST = ensureWorkingTime(toIST(task.start_date));
  const dueIST = ensureWorkingTime(toIST(task.due_date));

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

  /* ---------- Build candidate plan ---------- */
  function buildPlan(useSecondary) {
    const timeline = {};
    let feasible = true;
    let blockingTeam = null;

    for (const team of Object.keys(task.team_work)) {
      const effort = task.team_work[team].effort_hours;
      const dependsOn = task.team_work[team].depends_on || [];

      const owner = useSecondary
        ? module.secondary_roles_map?.[team]?.[0]
        : module.primary_roles_map?.[team];

      if (!owner) {
        feasible = false;
        blockingTeam = team;
        continue;
      }

      /* ---- Dependency-safe handling (NO CRASH) ---- */
      const dependencyEndDates = dependsOn
        .map(dep => timeline[dep]?.end_date)
        .filter(Boolean)
        .map(d => toIST(d));

      const dependencyReady =
        dependencyEndDates.length > 0
          ? maxDate(dependencyEndDates)
          : taskStartIST;

      /* ---- Member availability ---- */
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
        blockingTeam = team;
      }
    }

    const delivery = maxDate(
      Object.values(timeline).map(t => toIST(t.end_date))
    );

    return { feasible, blockingTeam, delivery, timeline };
  }

  /* ---------- Evaluate plans ---------- */
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

  const blockingTeam = feasible ? null : chosen.blockingTeam;

  const estimatedDelivery = feasible
    ? chosen.delivery
    : toIST(chosen.timeline[blockingTeam].end_date);

  /* ---------- Response ---------- */
  return NextResponse.json({
    feasible,
    blocking_team: blockingTeam,
    estimated_delivery: fromIST(estimatedDelivery).toISOString(),
    plan: chosen.timeline
  });
}
