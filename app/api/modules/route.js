import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET() {
  const { data, error } = await supabase
    .from("modules")
    .select(`
      id,
      name,
      description,
      module_owners (
        role,
        team_id,
        member_id,
        teams ( id, name ),
        team_members ( id, name )
      )
    `)
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ modules: data });
}
