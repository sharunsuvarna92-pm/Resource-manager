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

const maxByDate = (arr, key) =>
  arr.reduce((a, b) =>
    new Date(b[key]) > new Date(a[key]) ? b : a
  );

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
  const { id: taskId } = params;

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
  const dueDate = toIST(task.due_date);
  dueDate.setHours(WORK_END, 0, 0, 0);

  /* ---------- Fetch module owners ---------- */
  const { data: owners = [] } = await supabase
    .from("module_owners")
    .select("team_id, member_id, role")
    .eq("module_id", task.module_id);

  const ownersByTeam = {};
  owners.forEach(o => {
    ownersByTeam[o.team_id] ||= { primary: null, secondary: [] };
    if (o.role === "PRIMARY") ownersByTeam[o.team_id].primary = o.member_id;
    if (o.role === "SECONDARY") ownersByTeam[o.team_id].secondary.push(o.member_id);
  });

  /* ---------- Validate ownership ---------- */
  const missingOwners = Object.keys(task.team_work)
    .filter(tid => !ownersByTeam[tid]?.primary);

  if (missingOwners.length) {
    return NextResponse.json({
      feasible: false,
      blocking_reason: {
        type: "OWNERSHIP_MISSING",
        teams: missingOwners
      },
      recommendation: {
        action: "ASSIGN_PRIMARY_OWNER"
      }
    });
  }

  /* ---------- Fetch committed assignments ---------- */
  const { data: committed = [] } = await supabase
    .from("assignments")
    .select(`
      member_id,
      start_date,
      end_date,
      tasks (
        id,
        title,
        priority
      )
    `)
    .eq("status", "committed");

  /* ---------- Fetch members (for names) ---------- */
  const { data: members = [] } = await supabase
    .from("team_members")
    .select("id, name");

  const memberNameById = Object.fromEntries(
    members.map(m => [m.id, m.name])
  );

  function earliestAvailability(memberId) {
    const busy = committed.filter(a => a.member_id === memberId);

    if (!busy.length) {
      return { available_at: taskStart, blocker: null };
    }

    const latest = maxByDate(busy, "end_date");

    return {
      available_at: toIST(latest.end_date),
      blocker: latest
    };
  }

  const order = topoSort(task.team_work);
  const paths = [];

  function buildPlan(ownerMap) {
    const timeline = {};
    const blockers = [];

    for (const teamId of order) {
      const effort = task.team_work[teamId].effort_hours;
      const deps = task.team_work[teamId].depends_on || [];
      const owner = ownerMap[teamId];

      const depEnd = deps.length
        ? new Date(Math.max(...deps.map(d => toIST(timeline[d].end_date))))
        : taskStart;

      const availability = earliestAvailability(owner);
      const start = ensureWorkingTime(
        new Date(Math.max(depEnd, availability.available_at))
      );

      const end = addWorkingHours(start, effort);

      if (availability.blocker) {
        blockers.push({
          team_id: teamId,
          member_id: owner,
          assignment: availability.blocker
        });
      }

      timeline[teamId] = {
        team_id: teamId,
        assigned_to: owner,
        assigned_to_name: memberNameById[owner] || null,
        start_date: fromIST(start).toISOString(),
        end_date: fromIST(end).toISOString(),
        effort_hours: effort
      };
    }

    const delivery = new Date(
      Math.max(...Object.values(timeline).map(t => toIST(t.end_date)))
    );

    return { timeline, delivery, blockers };
  }

  function generate(idx, map) {
    if (idx === order.length) {
      paths.push(buildPlan(map));
      return;
    }
    const teamId = order[idx];
    const { primary, secondary } = ownersByTeam[teamId];
    generate(idx + 1, { ...map, [teamId]: primary });
    secondary.forEach(s =>
      generate(idx + 1, { ...map, [teamId]: s })
    );
  }

  generate(0, {});

  const best = paths.sort((a, b) => a.delivery - b.delivery)[0];
  const feasible = best.delivery <= dueDate;

  if (!feasible) {
    const root = maxByDate(
      best.blockers.map(b => ({
        ...b,
        end_date: b.assignment.end_date
      })),
      "end_date"
    );

    return NextResponse.json({
      feasible: false,
      estimated_delivery: fromIST(best.delivery).toISOString(),
      blocking_reason: {
        type: "CAPACITY_CONFLICT",
        blocking_member: {
          id: root.member_id,
          name: memberNameById[root.member_id] || null
        },
        blocking_task: {
          id: root.assignment.tasks.id,
          title: root.assignment.tasks.title,
          priority: root.assignment.tasks.priority
        },
        conflict_window: {
          from: root.assignment.start_date,
          to: root.assignment.end_date
        },
        message: `${
          memberNameById[root.member_id] || "This member"
        } is fully allocated during the required execution window.`
      },
      recommendation: {
        action: "REPRIORITIZE_OR_EXTEND"
      },
      plan: best.timeline
    });
  }

  return NextResponse.json({
    feasible: true,
    estimated_delivery: fromIST(best.delivery).toISOString(),
    plan: best.timeline
  });
}
