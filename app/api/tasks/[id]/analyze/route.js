import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* -------------------- CORS -------------------- */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function withCors(data, status = 200) {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/* -------------------- SUPABASE -------------------- */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* -------------------- HELPERS -------------------- */
function addDays(startDate, hours) {
  const days = Math.ceil(hours / 8);
  const d = new Date(startDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

/* -------------------- ANALYZER -------------------- */
export async function POST(req, { params }) {
  const taskId = params.id;

  /* Fetch task */
  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (taskErr || !task) {
    return withCors({ feasible: false, reason: "Task not found" }, 404);
  }

  /* Fetch module */
  const { data: moduleData } = await supabase
    .from("modules")
    .select("primary_roles_map, secondary_roles_map")
    .eq("id", task.module_id)
    .single();

  /* Fetch committed assignments */
  const { data: committedAssignments } = await supabase
    .from("assignments")
    .select("*")
    .eq("status", "committed");

  let currentDate = task.start_date;
  const plan = {};

  /* Team dependency order comes from team_work object */
  for (const teamName of Object.keys(task.team_work)) {
    const effort = task.team_work[teamName]?.effort_hours || 0;

    const primary = moduleData?.primary_roles_map?.[teamName];
    const secondary = moduleData?.secondary_roles_map?.[teamName] || [];
    const candidates = [primary, ...secondary].filter(Boolean);

    let selectedMember = null;

    for (const memberId of candidates) {
      const conflict = committedAssignments.some(a =>
        a.member_id === memberId &&
        !(a.end_date < currentDate || a.start_date > task.required_by)
      );

      if (!conflict) {
        selectedMember = memberId;
        break;
      }
    }

    if (!selectedMember) {
      return withCors({
        feasible: false,
        reason: `${teamName} team has no available resources`,
        blocking_team: teamName
      });
    }

    const endDate = addDays(currentDate, effort);

    plan[teamName] = {
      assigned_to: selectedMember,
      start_date: currentDate,
      end_date: endDate
    };

    currentDate = endDate;
  }

  if (currentDate > task.required_by) {
    return withCors({
      feasible: false,
      reason: `Cannot meet required date. Earliest possible: ${currentDate}`
    });
  }

  return withCors({
    feasible: true,
    estimated_delivery: currentDate,
    plan
  });
}
