import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function PATCH(request, { params }) {
  const { id: taskId } = await params;
  const { status } = await request.json();

  const allowed = ["IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"];
  if (!allowed.includes(status)) {
    return new Response(JSON.stringify({ error: "Invalid status" }), {
      status: 400,
    });
  }

  await supabase
    .from("tasks")
    .update({ status })
    .eq("id", taskId);

  // ---------------- Assignment transitions ----------------

  if (status === "ON_HOLD") {
    await supabase
      .from("assignments")
      .update({ status: "ON_HOLD" })
      .eq("task_id", taskId)
      .eq("status", "COMMITTED");
  }

  if (["COMPLETED", "CANCELLED"].includes(status)) {
    await supabase
      .from("assignments")
      .update({ status: "INACTIVE" })
      .eq("task_id", taskId);
  }

  return new Response(
    JSON.stringify({ success: true, status }),
    { status: 200 }
  );
}
