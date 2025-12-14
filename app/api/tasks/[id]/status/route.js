import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function PATCH(request, { params }) {
  try {
    const { id: taskId } = await params;
    const { status } = await request.json();

    const allowed = ["IN_PROGRESS", "COMPLETED", "CANCELLED", "ON_HOLD"];
    if (!allowed.includes(status)) {
      return new Response(
        JSON.stringify({ error: "Invalid status" }),
        { status: 400 }
      );
    }

    const { data: task } = await supabase
      .from("tasks")
      .select("status")
      .eq("id", taskId)
      .single();

    if (!task) {
      return new Response(
        JSON.stringify({ error: "Task not found" }),
        { status: 404 }
      );
    }

    await supabase
      .from("tasks")
      .update({ status })
      .eq("id", taskId);

    if (["COMPLETED", "CANCELLED"].includes(status)) {
      await supabase
        .from("assignments")
        .delete()
        .eq("task_id", taskId);
    }

    if (status === "ON_HOLD") {
      await supabase
        .from("assignments")
        .update({ status: "draft" })
        .eq("task_id", taskId);
    }

    return new Response(
      JSON.stringify({ success: true, status }),
      { status: 200 }
    );

  } catch (err) {
    console.error("Status update crash:", err);
    return new Response(
      JSON.stringify({ error: "Internal status update error" }),
      { status: 500 }
    );
  }
}
