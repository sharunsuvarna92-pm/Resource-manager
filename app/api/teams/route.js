import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const { name, description } = await request.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: "Team name required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("teams")
    .insert({ name, description })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ team: data }, { status: 201 });
}

export async function GET() {
  const { data, error } = await supabase
    .from("teams")
    .select("id, name, description")
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ teams: data });
}
