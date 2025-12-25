import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const body = await request.json();

  const { title, module_id, start_date, due_date } = body;

  if (!title || !module_id || !start_date || !due_date) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({ ...body, status: "PLANNING" })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ task: data }, { status: 201 });
}

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("tasks")
      .select(`
        id,
        title,
        description,
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
        { status: 500 }
      );
    }

    return new Response(
      JSON.stringify({ tasks: data }),
      { status: 200 }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch tasks" }),
      { status: 500 }
    );
  }
}

