import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const body = await request.json();
  const { name, team_id } = body;

  if (!name || !team_id) {
    return NextResponse.json(
      { error: "name and team_id required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("team_members")
    .insert({
      ...body,
      is_active: true,
      timezone: "Asia/Kolkata",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ member: data }, { status: 201 });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get("team_id");

  let query = supabase
    .from("team_members")
    .select("id, name, email, team_id, is_active")
    .order("name");

  if (teamId) query = query.eq("team_id", teamId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ members: data });
}
