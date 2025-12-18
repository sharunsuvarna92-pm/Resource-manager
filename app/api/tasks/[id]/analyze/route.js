import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* ================= SUPABASE ================= */

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

  function visit(team) {
    if (visited.has(team)) return;
    visited.add(team);
    for (const dep of teamWork[team].depends_on || []) visit(dep);
    order.push(team);
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

  for (const o of owners) {
    ownersByTeam[o.team_id] ??= {
      primary: null,
      secondary: []
    };

    if (o.role === "PRIMARY") {
      ownersByTeam[o.team_id].primary = o.member_id;
    }

    if (o.role === "SECONDARY") {
      ownersByTeam[o.team_id].secondary.push(o.member_id);
    }
  }

  /* ---------- Ownership validation ---------- */

  const missingOwnershipTeams = Object.keys(task.team_work)
    .filter(
      team =>
        !ownersByTeam[team] ||
        !ownersByTeam[team].primary
    );

  if (missingOwnershipTeams.length > 0) {
    return NextResponse.json({
      feasible: false,
      blocking_reason: {
        type: "OWNERSHIP_MISSING",
        teams: missingOwnershipTeams,
        message:
          "Task cannot be analyzed because one or more teams do not have a primary owner assigned."
      },
      recommendation: {
        action: "FIX_MODULE_OWNERSHIP",
        message:
          "Assign a primary owner for each team in the module before analyzing the task."
      }
    });
  }

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

  function earliestAvailability(memberId) {
    const busy = committed
      .filter(a => a.member_id === memberId)
      .map(a => toIST(a.end_date));
    return busy.length ? maxDate(busy) : taskStart;
  }

  /* ---------- Build execution plan ---------- */

  const order = topoSort(task.team_work);

  function buildPlan(ownerMap) {
    const timeline = {};

    for (const team of order) {
      const effort = task.team_work[team].effort_hours;
      const dependsOn = task.team_work[team].depends_on || [];
      const owner = ownerMap[team];

      const depEnd = dependsOn.length
        ? maxDate(dependsOn.map(d => toIST(timeline[d].end_date)))
        : taskStart;

      const ownerReady = earliestAvailability(owner);

      const start = ensureWorkingTime(maxDate([depEnd, ownerReady]));
      const end = addWorkingHours(start, effort);

      timeline[team] = {
        assigned_to: owner,
        start_date: fromIST(start).toISOString(),
        end_date: fromIST(end).toISOString(),
        effort_hours: effort,
        depends_on: dependsOn,
        owner_type:
          owner === ownersByTeam[team].primary
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
    const { primary, secondary } = ownersByTeam[team];

    generate(idx + 1, { ...map, [team]: primary });

    for (const s of secondary) {
      generate(idx + 1, { ...map, [team]: s });
    }
  }

  generate(0, {});

  /* ---------- HARD GUARD: zero paths ---------- */

  if (paths.length === 0) {
    return NextResponse.json({
      feasible: false,
      blocking_reason: {
        type: "NO_EXECUTION_PATH",
        message:
          "No valid execution path could be generated due to ownership configuration."
      },
      recommendation: {
        action: "REVIEW_MODULE_OWNERS",
        message:
          "Ensure each team has a primary owner and optional secondary owners."
      }
    });
  }

  /* ---------- Choose best path ---------- */

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

  /* ---------- Blocking explanation ---------- */

  let blocking_reason = null;
  let recommendation = null;

  if (!feasible) {
    const [blockingTeam, blockData] = Object.entries(chosen.timeline)
      .sort((a, b) => new Date(b[1].end_date) - new Date(a[1].end_date))[0];

    const memberId = blockData.assigned_to;

    const conflict = committed
      .filter(a => a.member_id === memberId)
      .find(a => toIST(a.end_date) > taskStart);

    if (conflict) {
      blocking_reason = {
        type: "RESOURCE_CONFLICT",
        team: blockingTeam,
        member_id: memberId,
        conflicting_task: {
          id: conflict.task_id,
          title: conflict.tasks?.title,
          priority: conflict.tasks?.priority
        },
        conflict_window: {
          from: conflict.start_date,
          to: conflict.end_date
        },
        message:
          "The task cannot be completed before the due date because the assigned owner is already committed to another task during the required time window."
      };

      recommendation = {
        action: "REPRIORITIZE_OR_EXTEND",
        message:
          "Consider reprioritizing the conflicting task or extending this task’s due date."
      };
    }
  }

  return NextResponse.json({
    feasible,
    estimated_delivery: fromIST(chosen.delivery).toISOString(),
    blocking_reason,
    recommendation,
    plan: chosen.timeline
  });
}
