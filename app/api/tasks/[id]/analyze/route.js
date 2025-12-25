import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/* ================= SUPABASE ================= */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= TIME CONFIG ================= */

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

/* ================= DEPENDENCY SORT ================= */

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

/* ================= TASK ID ================= */

function resolveTaskId(request, ctx) {
  if (ctx?.params?.id) return ctx.params.id;
  const parts = new URL(request.url).pathname.split("/");
  return parts[parts.length - 2];
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
  const dueDate = endOfWorkDayIST(task.due_date);

  /* ---------- Fetch owners ---------- */
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
    if (o.role === "SECONDARY") ownersByTeam[o.team_id].secondary.push(o.member_id);
  });

  /* ---------- Lookups ---------- */
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
      start_date,
      end_date,
      task_id,
      tasks ( title, priority )
    `)
    .eq("status", "committed");

  /* ---------- Dependency order ---------- */
  const order = topoSort(task.team_work);

  function earliestAvailability(memberId) {
    const memberAssignments = committed
      .filter(a => a.member_id === memberId)
      .sort((a, b) => new Date(b.end_date) - new Date(a.end_date));

    return memberAssignments.length
      ? {
          availableAt: toIST(memberAssignments[0].end_date),
          blocking: memberAssignments[0]
        }
      : {
          availableAt: taskStart,
          blocking: null
        };
  }

  function buildPlan(ownerMap) {
    const timeline = {};
    let criticalBlocker = null;

    for (const teamId of order) {
      const effort = task.team_work[teamId].effort_hours;
      const dependsOn = task.team_work[teamId].depends_on || [];
      const owner = ownerMap[teamId];

      const depEnd = dependsOn.length
        ? maxDate(dependsOn.map(d => toIST(timeline[d].end_date)))
        : taskStart;

      const availability = earliestAvailability(owner);
      const start = ensureWorkingTime(
        maxDate([depEnd, availability.availableAt])
      );

      const end = addWorkingHours(start, effort);

      if (
        end > dueDate &&
        availability.blocking &&
        !criticalBlocker
      ) {
        criticalBlocker = {
          team_id: teamId,
          team_name: teamNameById[teamId],
          member_id: owner,
          member_name: memberNameById[owner],
          task_id: availability.blocking.task_id,
          task_title: availability.blocking.tasks?.title,
          task_priority: availability.blocking.tasks?.priority,
          conflict_window: {
            from: availability.blocking.start_date,
            to: availability.blocking.end_date
          }
        };
      }

      timeline[teamId] = {
        team_id: teamId,
        team_name: teamNameById[teamId],
        assigned_to: owner,
        assigned_to_name: memberNameById[owner],
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

    return { timeline, delivery, blocker: criticalBlocker };
  }

  /* ---------- Generate paths ---------- */
  const paths = [];
  function generate(idx, map) {
    if (idx === order.length) {
      paths.push(buildPlan(map));
      return;
    }

    const teamId = order[idx];
    const { primary, secondary } = ownersByTeam[teamId];

    if (primary) generate(idx + 1, { ...map, [teamId]: primary });
    secondary.forEach(sec =>
      generate(idx + 1, { ...map, [teamId]: sec })
    );
  }

  generate(0, {});

  /* ---------- Choose path ---------- */
  const fitting = paths.filter(p => p.delivery <= dueDate);

  let chosen;
  let feasible = false;

  if (fitting.length) {
    chosen = fitting.sort((a, b) => a.delivery - b.delivery)[0];
    feasible = true;
  } else {
    chosen = paths.sort((a, b) => a.delivery - b.delivery)[0];
  }

  /* ---------- Response ---------- */
  return NextResponse.json({
    feasible,
    estimated_delivery: fromIST(chosen.delivery).toISOString(),
    blocking_reason: feasible
      ? null
      : {
          type: "CAPACITY_CONFLICT",
          ...chosen.blocker,
          explanation:
            "Existing committed work blocks the required execution window, pushing completion beyond the due date."
        },
    recommendation: feasible
      ? null
      : {
          action: "REPRIORITIZE_OR_EXTEND_DUE_DATE"
        },
    plan: chosen.timeline
  });
}
