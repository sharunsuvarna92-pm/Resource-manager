import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

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
  d.setHours(WORK_END, 0, 0, 0);
  return d;
}

/* ================= TOPO SORT ================= */

function topoSort(teamWork) {
  const visited = new Set();
  const order = [];

  function visit(teamId) {
    if (visited.has(teamId)) return;
    visited.add(teamId);
    for (const dep of teamWork[teamId].depends_on || []) {
      visit(dep);
    }
    order.push(teamId);
  }

  Object.keys(teamWork).forEach(visit);
  return order;
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
      { feasible: false, error: "Task not found" },
      { status: 404 }
    );
  }

  const taskStart = ensureWorkingTime(toIST(task.start_date));
  const dueDate = endOfWorkDayIST(task.due_date);

  /* ---------- Fetch module owners ---------- */
  const { data: owners = [] } = await supabase
    .from("module_owners")
    .select("team_id, member_id, role")
    .eq("module_id", task.module_id);

  /* ---------- Build ownersByTeam ---------- */
  const ownersByTeam = {};
  owners.forEach(o => {
    if (!ownersByTeam[o.team_id]) {
      ownersByTeam[o.team_id] = { primary: null, secondary: [] };
    }
    if (o.role === "PRIMARY") ownersByTeam[o.team_id].primary = o.member_id;
    if (o.role === "SECONDARY") ownersByTeam[o.team_id].secondary.push(o.member_id);
  });

  /* ---------- Fetch lookup tables ---------- */
  const [{ data: teams = [] }, { data: members = [] }] = await Promise.all([
    supabase.from("teams").select("id, name"),
    supabase.from("team_members").select("id, name")
  ]);

  const teamNameById = Object.fromEntries(teams.map(t => [t.id, t.name]));
  const memberNameById = Object.fromEntries(members.map(m => [m.id, m.name]));

  /* ---------- Fetch committed assignments ---------- */
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
    .eq("status", "committed");

  /* ---------- Validate ownership ---------- */
  const missingOwners = Object.keys(task.team_work)
    .filter(teamId => !ownersByTeam[teamId]?.primary);

  if (missingOwners.length > 0) {
    return NextResponse.json({
      feasible: false,
      blocking_reason: {
        type: "OWNERSHIP_MISSING",
        teams: missingOwners.map(tid => ({
          team_id: tid,
          team_name: teamNameById[tid] || null
        })),
        message:
          "One or more teams do not have a primary owner assigned for this module."
      },
      recommendation: {
        action: "ASSIGN_PRIMARY_OWNER",
        message:
          "Please assign a primary owner for each team in the module before analyzing."
      }
    });
  }

  /* ---------- Dependency order ---------- */
  const order = topoSort(task.team_work);

  function earliestAvailability(memberId) {
    const busy = committed
      .filter(a => a.member_id === memberId)
      .map(a => toIST(a.end_date));
    return busy.length ? maxDate(busy) : taskStart;
  }

  function buildPlan(ownerMap) {
    const timeline = {};

    for (const teamId of order) {
      const effort = task.team_work[teamId].effort_hours;
      const dependsOn = task.team_work[teamId].depends_on || [];
      const owner = ownerMap[teamId];

      const depEnd = dependsOn.length
        ? maxDate(dependsOn.map(d => toIST(timeline[d].end_date)))
        : taskStart;

      const ownerReady = owner
        ? earliestAvailability(owner)
        : depEnd;

      const start = ensureWorkingTime(maxDate([depEnd, ownerReady]));
      const end = owner ? addWorkingHours(start, effort) : start;

      timeline[teamId] = {
        team_id: teamId,
        team_name: teamNameById[teamId] || null,

        assigned_to: owner,
        assigned_to_name: memberNameById[owner] || null,

        start_date: fromIST(start).toISOString(),
        end_date: fromIST(end).toISOString(),
        effort_hours: effort,

        depends_on: dependsOn,
        depends_on_names: dependsOn.map(d => teamNameById[d] || null),

        owner_type:
          owner === ownersByTeam[teamId].primary ? "primary" : "secondary"
      };
    }

    const delivery = maxDate(
      Object.values(timeline).map(t => toIST(t.end_date))
    );

    return { timeline, delivery };
  }

  /* ---------- Generate paths ---------- */
  const teamsInOrder = order;
  const paths = [];

  function generate(idx, map) {
    if (idx === teamsInOrder.length) {
      paths.push(buildPlan(map));
      return;
    }

    const teamId = teamsInOrder[idx];
    const { primary, secondary } = ownersByTeam[teamId];

    if (primary) generate(idx + 1, { ...map, [teamId]: primary });
    secondary.forEach(sec =>
      generate(idx + 1, { ...map, [teamId]: sec })
    );
  }

  generate(0, {});

  if (paths.length === 0) {
    return NextResponse.json({
      feasible: false,
      blocking_reason: {
        type: "NO_EXECUTION_PATH",
        message:
          "No valid execution path could be generated with current ownership and dependencies."
      },
      recommendation: {
        action: "REVIEW_MODULE_OWNERSHIP",
        message:
          "Ensure all teams have valid owners and dependency cycles are resolved."
      }
    });
  }

  /* ---------- Path selection ---------- */
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
    if (fitting.length) {
      chosen = fitting.sort((a, b) => a.delivery - b.delivery)[0];
      feasible = true;
    } else {
      chosen = paths.sort((a, b) => a.delivery - b.delivery)[0];
    }
  }

  /* ---------- Response ---------- */
  return NextResponse.json({
    feasible,
    estimated_delivery: fromIST(chosen.delivery).toISOString(),
    blocking_reason: feasible ? null : {
      type: "DEADLINE_EXCEEDED",
      message:
        "The task cannot be completed before the due date with current commitments."
    },
    recommendation: feasible
      ? null
      : {
          action: "ADJUST_DUE_DATE_OR_REPRIORITIZE",
          message:
            "Consider reprioritizing conflicting work or extending the due date."
        },
    plan: chosen.timeline
  });
}
