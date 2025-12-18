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
    "Access-Control-Allow-Methods": "PATCH, OPTIONS",
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
// EDIT TASK METADATA (PLANNING ONLY)
// ------------------
export async function PATCH(request, { params }) {
  try {
    const { id: taskId } = await params;
    const payload = await request.json();

    if (!taskId) {
      return new Response(
        JSON.stringify({ error: "Task ID missing" }),
        { status: 400, headers: corsHeaders() }
      );
    }

    // ------------------
    // Fetch task
    // ------------------
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("status")
      .eq("id", taskId)
      .single();

    if (fetchError || !task) {
      return new Response(
        JSON.stringify({ error: "Task not found" }),
        { status: 404, headers: corsHeaders() }
      );
    }

    // ------------------
    // Enforce PLANNING-only edit
    // ------------------
    if (task.status !== "PLANNING") {
      return new Response(
        JSON.stringify({
          error: "Task must be in PLANNING status to edit"
        }),
        { status: 409, headers: corsHeaders() }
      );
    }

    // ------------------
    // Ignore status if provided
    // ------------------
    delete payload.status;

    // ------------------
    // Allowed editable fields only
    // ------------------
    const allowedFields = [
      "title",
      "description",
      "start_date",
      "due_date",
      "teams_involved",
      "team_work",
      "priority"
    ];

    const updateData = {};
    for (const key of allowedFields) {
      if (key in payload) {
        updateData[key] = payload[key];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return new Response(
        JSON.stringify({ error: "No editable fields provided" }),
        { status: 400, headers: corsHeaders() }
      );
    }

    // ------------------
    // Update task
    // ------------------
    const { data: updated, error: updateError } = await supabase
      .from("tasks")
      .update(updateData)
      .eq("id", taskId)
      .select()
      .single();

    if (updateError) {
      console.error("Task update error:", updateError);
      return new Response(
        JSON.stringify({ error: updateError.message }),
        { status: 500, headers: corsHeaders() }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        task: updated
      }),
      { status: 200, headers: corsHeaders() }
    );

  } catch (err) {
    console.error("Task edit crash:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: corsHeaders() }
    );
  }
}
