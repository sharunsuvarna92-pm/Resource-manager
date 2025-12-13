import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* ---------------- CORS ---------------- */
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

/* ------------- Supabase Client -------- */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =====================================================
   POST /api/tasks
   - Creates task
   - Auto-assigns PRIMARY owners from module
   - Creates DRAFT assignments
   - Dependencies live inside team_work
===================================================== */
export async function POST(request) {
  try {
    const body = await request.json();

    const {
      title,
      description,
      module_id,
      priority,
      requested_by,
      start_date,
      required_by,
      teams_involved,
      team_work
    } = body;

    if (!title || !module_id || !start_date || !required_by) {
      return NextResponse.json(
        { error: "title, module_id, start_date, required_by are required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    /* 1️⃣ Fetch module primary owners */
    const { data: moduleData, error: moduleError } = await supabase
      .from("modules")
      .select("primary_roles_map")
      .eq("id", module_id)
      .single();

    if (moduleError) {
      return NextResponse.json(
        { error: moduleError.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    /* 2️⃣ Build final team_work + draft assignments */
    const finalTeamWork = {};
    const assignments = [];

    for (const team of teams_involved ?? []) {
      const primaryOwnerId = moduleData.primary_roles_map?.[team];
      const teamConfig = team_work?.[team];

      if (!primaryOwnerId || !teamConfig) continue;

      const effortHours = teamConfig.effort_hours ?? 0;
      const dependsOn = teamConfig.depends_on ?? [];

      finalTeamWork[team] = {
        primary_owner: primaryOwnerId,
        effort_hours: effortHours,
        depends_on: dependsOn
      };

      if (effortHours > 0) {
        assignments.push({
          task_id: null, // set after task creation
          member_id: primaryOwnerId,
          assigned_hours: effortHours,
          start_date,
          end_date: required_by,
          source: "auto",
          status: "draft" // 👈 NOT committed
        });
      }
    }

    /* 3️⃣ Create task */
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .insert([
        {
          title,
          description,
          module_id,
          priority,
          requested_by,
          start_date,
          required_by,
          teams_involved,
          team_work: finalTeamWork,
          status: "Planned"
        }
      ])
      .select()
      .single();

    if (taskError) {
      return NextResponse.json(
        { error: taskError.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    /* 4️⃣ Insert draft assignments */
    assignments.forEach(a => (a.task_id = task.id));

    if (assignments.length > 0) {
      const { error: assignError } = await supabase
        .from("assignments")
        .insert(assignments);

      if (assignError) {
        return NextResponse.json(
          { error: assignError.message },
          { status: 500, headers: corsHeaders() }
        );
      }
    }

    return NextResponse.json(
      {
        message: "Task created with draft assignments",
        task_id: task.id,
        team_work: finalTeamWork,
        assignments_created: assignments.length
      },
      { status: 201, headers: corsHeaders() }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400, headers: corsHeaders() }
    );
  }
}

/* =====================================================
   GET /api/tasks
   - Returns tasks
   - Analyzer will use assignments separately
===================================================== */
export async function GET() {
  const { data, error } = await supabase
    .from("tasks")
    .select(
      `
      id,
      title,
      description,
      priority,
      module_id,
      requested_by,
      start_date,
      required_by,
      teams_involved,
      team_work,
      status,
      created_at
      `
    )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: corsHeaders() }
    );
  }

  return NextResponse.json(
    { tasks: data },
    { status: 200, headers: corsHeaders() }
  );
}
