import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* ---------- CORS ---------- */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function addDays(dateStr, hours) {
  const days = Math.ceil(hours / 8);
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

export async function POST(req, { params }) {
  const taskId = params.id;

  const { data: task } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  const { data: moduleData } = await supabase
    .from("modules")
    .select("primary_roles_map, secondary_roles_map")
    .eq("id", task.module_id)
    .single();

  const { data: busyAssignments } = await supabase
    .from("assignments")
    .select("*")
    .eq("status", "committed");

  const plan = {};
  let currentDate = task.start_date;

  for (const team of Object.keys(task.team_work)) {
    const work = task.team_work[team];
    const candidates = [
      moduleData.primary_roles_map?.[team],
      ...(moduleData.secondary_roles_map?.[team] || [])
    ].filter(Boolean);

    let assigned = null;

    for (const member of candidates) {
      const clash = busyAssignments.some(a =>
        a.member_id === member &&
        !(a.end_date < currentDate || a.start_date > task.required_by)
      );

      if (!clash) {
        assigned = member;
        break;
      }
    }

    if (!assigned) {
      return NextResponse.json(
        {
          feasible: false,
          reason: `${team} team has no available resources`,
          blocking_team: team
        },
        { headers: corsHeaders() }
      );
    }

    const endDate = addDays(currentDate, work.effort_hours);

    plan[team] = {
      assigned_to: assigned,
      start_date: currentDate,
      end_date: endDate
    };

    currentDate = endDate;
  }

  if (currentDate > task.required_by) {
    return NextResponse.json(
      {
        feasible: false,
        reason: `Cannot meet required date. Earliest: ${currentDate}`
      },
      { headers: corsHeaders() }
    );
  }

  return NextResponse.json(
    {
      feasible: true,
      estimated_delivery: currentDate,
      plan
    },
    { headers: corsHeaders() }
  );
}
