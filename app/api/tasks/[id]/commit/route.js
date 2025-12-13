import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(req, { params }) {
  const taskId = params.id;
  const { member_id } = await req.json();

  // 1️⃣ Find draft assignment
  const { data: assignment } = await supabase
    .from("assignments")
    .select("*")
    .eq("task_id", taskId)
    .eq("status", "draft")
    .single();

  if (!assignment) {
    return NextResponse.json(
      { error: "No draft assignment found" },
      { status: 404 }
    );
  }

  // 2️⃣ Commit assignment
  await supabase
    .from("assignments")
    .update({
      member_id,
      status: "committed"
    })
    .eq("id", assignment.id);

  // 3️⃣ Update task status
  await supabase
    .from("tasks")
    .update({ status: "Committed" })
    .eq("id", taskId);

  return NextResponse.json({
    message: "Task committed successfully",
    task_id: taskId,
    assigned_to: member_id
  });
}
