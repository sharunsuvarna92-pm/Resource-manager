import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= ID RESOLUTION ================= */
/**
 * Correct for:
 * /api/tasks/:id/analyze
 *
 * Example pathname:
 * ["", "api", "tasks", "<TASK_ID>", "analyze"]
 */
function resolveTaskId(request, ctx) {
  if (ctx?.params?.id) return ctx.params.id;

  const parts = new URL(request.url).pathname.split("/");
  return parts[parts.length - 2];
}

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

/* ================= BLOCKER DETECTION ================= */

function findBlockingAssignment(plan, committed, dueDateIST) {
  const latest = Object.values(plan).reduce((a, b) =>
    new Date(b.end_date) > new Date(a.end_date) ? b : a
  );

  const plannedEnd = toIST(latest.end_date);
  if (plannedEnd <= dueDateIST) return null;

  const memberId = latest.assigned_to;

  const blockers = committed
    .filter(a => a.member_id === memberId)
    .map(a => ({
      ...a,
      start: toIST(a.start_date),
      end: toIST(a.end_date)
    }))
    .filter(a => a.end > toIST(latest.start_date));

  if (blockers.length === 0) return null;

  return blockers.sort((a, b) => b.end - a.end)[0];
}

/* ================= ANALYZE ================= */

export async function POST(request, ctx) {
  const taskId = resolveTaskId(request, ctx);

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
  const dueDateIST = endOfWorkDayIST(task.due_date);

  /* ---------- Fetch module owners ---------- */
  const { data: owners = [] } = await supabase
    .from("module_owners")
    .select("team_id, member_id, role")
    .eq("module_id", task.module_id);

  const ownersByTeam = {};
  owners.forEach(o => {
    if (!ownersByTeam[o.team_id]) {
      ownersByTeam[o.team_id] = { primary: null, secondary: [] };
    }
    if (o.role === "PRIMARY") ownersByTeam[o.team_id].primary = o.member_id;
    if (o.role === "SECONDARY")
      ownersByTeam[o.team_id].secondary.push(o.member_id);
  });

  /* ---------- Lookups ---------- */
  const [{ data: teams = [] }, { data: members = [] }] = await Promise.all([
    supabase.from("teams").select("id, name"),
    supabase.from("team_members").select("id, name")
  ]);

  const teamNameById = Object.fromEntries(teams.map(t => [t.id, t.name]));
  const memberNameById = Object.fromEntries(members.map(m => [m.id, m.name]));

  /* ---------- Committed assignments ---------- */
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

  /* ---------- Ownership validation ---------- */
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
        }))
      },
      recommendation: { action: "ASSIGN_PRIMARY_OWNER" }
    });
  }

  /* ---------- Build plans ---------- */
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
      const deps = task.team_work[teamId].depends_on || [];
      const owner = ownerMap[teamId];

      const depEnd = deps.length
        ? maxDate(deps.map(d => toIST(timeline[d].end_date)))
        : taskStart;

      const ownerReady = earliestAvailability(owner);
      const start = ensureWorkingTime(maxDate([depEnd, ownerReady]));
      const end = addWorkingHours(start, effort);

      timeline[teamId] = {
        team_id: teamId,
        team_name: teamNameById[teamId] || null,
        assigned_to: owner,
        assigned_to_name: memberNameById[owner] || null,
        start_date: fromIST(start).toISOString(),
        end_date: fromIST(end).toISOString(),
        effort_hours: effort,
        owner_type:
          owner === ownersByTeam[teamId].primary ? "primary" : "secondary"
      };
    }

    const delivery = maxDate(
      Object.values(timeline).map(t => toIST(t.end_date))
    );

    return { timeline, delivery };
  }

  const paths = [];
  const teamsInOrder = order;

  function generate(idx, map) {
    if (idx === teamsInOrder.length) {
      paths.push(buildPlan(map));
      return;
    }

    const teamId = teamsInOrder[idx];
    const { primary, secondary } = ownersByTeam[teamId];

    generate(idx + 1, { ...map, [teamId]: primary });
    secondary.forEach(sec =>
      generate(idx + 1, { ...map, [teamId]: sec })
    );
  }

  generate(0, {});

  const allPrimary = paths.find(p =>
    Object.values(p.timeline).every(t => t.owner_type === "primary")
  );

  let chosen;
  let feasible = false;

  if (allPrimary && allPrimary.delivery <= dueDateIST) {
    chosen = allPrimary;
    feasible = true;
  } else {
    const fitting = paths.filter(p => p.delivery <= dueDateIST);
    if (fitting.length) {
      chosen = fitting.sort((a, b) => a.delivery - b.delivery)[0];
      feasible = true;
    } else {
      chosen = paths.sort((a, b) => a.delivery - b.delivery)[0];
    }
  }

  const blocker = !feasible
    ? findBlockingAssignment(chosen.timeline, committed, dueDateIST)
    : null;

  return NextResponse.json({
    feasible,
    estimated_delivery: fromIST(chosen.delivery).toISOString(),

    blocking_reason: feasible
      ? null
      : blocker
        ? {
            type: "CAPACITY_CONFLICT",
            blocking_team_id: Object.values(chosen.timeline)
              .find(t => t.assigned_to === blocker.member_id)?.team_id,
            blocking_team_name: teamNameById[
              Object.values(chosen.timeline)
                .find(t => t.assigned_to === blocker.member_id)?.team_id
            ],
            blocking_member_id: blocker.member_id,
            blocking_member_name: memberNameById[blocker.member_id],
            blocking_task_id: blocker.task_id,
            blocking_task_title: blocker.tasks?.title ?? null,
            blocking_task_priority: blocker.tasks?.priority ?? null,
            conflict_window: {
              from: fromIST(blocker.start).toISOString(),
              to: fromIST(blocker.end).toISOString()
            },
            explanation:
              `${memberNameById[blocker.member_id]} is committed to ` +
              `'${blocker.tasks?.title}' during the required execution window, ` +
              `pushing completion beyond the due date.`
          }
        : {
            type: "CAPACITY_CONFLICT",
            explanation:
              "Existing committed work blocks the required execution window."
          },

    recommendation: feasible
      ? null
      : { action: "REPRIORITIZE_OR_EXTEND_DUE_DATE" },

    plan: chosen.timeline
  });
}
