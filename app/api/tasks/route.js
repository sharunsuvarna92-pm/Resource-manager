import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// ------------------
// Supabase client
// ------------------
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ------------------
// CORS helper
// ------------------
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

// ------------------
// CREATE TASK (PLANNING ONLY)
// ------------------
export async function POST(request) {
  try {
    const body = await request.json();

    const {
      title,
      description,
      module_id,
      start_date,
      due_date,
      teams_involved,
      team_work,
      priority
    } = body;

    // ------------------
    // Validation
    // ------------------
    if (
      !title ||
      !module_id ||
      !start_date ||
      !due_date ||
      !Array.isArray(teams_involved) ||
      teams_involved.length === 0 ||
      !team_work
    ) {
      return new Response(
        JSON.stringify({ error: "Missing required task fields" }),
        { status: 400, headers: corsHeaders() }
      );
    }

    // Validate module exists
    const { data: module, error: moduleError } = await supabase
      .from("modules")
      .select("id")
      .eq("id", module_id)
      .single();

    if (moduleError || !module) {
      return new Response(
        JSON.stringify({ error: "Invalid module_id" }),
        { status: 400, headers: corsHeaders() }
      );
    }

    // ------------------
    // Insert task ONLY
    // ------------------
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .insert({
        title,
        description,
        module_id,
        start_date,
        due_date,
        teams_involved,
        team_work,
        priority: priority ?? 3,
        status: "PLANNING"
      })
      .select()
      .single();

    if (taskError) {
      console.error("Task insert error:", taskError);
      return new Response(
        JSON.stringify({ error: taskError.message }),
        { status: 500, headers: corsHeaders() }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        task_id: task.id,
        status: task.status
      }),
      { status: 201, headers: corsHeaders() }
    );

  } catch (err) {
    console.error("Create task crash:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: corsHeaders() }
    );
  }
}

// ------------------
// LIST TASKS
// ------------------
export async function GET() {
  try {
    const { data, error } = await supabase
      .from("tasks")
      .select(`
        id,
        title,
        status,
        start_date,
        due_date,
        expected_delivery_date,
        module_id,
        teams_involved,
        team_work,
        priority,
        created_at
      `)
      .order("created_at", { ascending: false });

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: corsHeaders() }
      );
    }

    return new Response(
      JSON.stringify(data),
      { status: 200, headers: corsHeaders() }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch tasks" }),
      { status: 500, headers: corsHeaders() }
    );
  }
}