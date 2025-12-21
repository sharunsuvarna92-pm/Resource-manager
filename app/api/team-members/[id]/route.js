import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function PUT(request, ctx) {
  let id = ctx?.params?.id;

  // Harden against App Router edge cases
  if (!id) {
    const url = new URL(request.url);
    id = url.pathname.split("/").pop();
  }

  if (!id) {
    return new Response(
      JSON.stringify({ error: "Missing team member ID" }),
      { status: 400 }
    );
  }

  const body = await request.json();

  const updates = { ...body };
  delete updates.id; // never trust body for identity

  Object.keys(updates).forEach(
    k => updates[k] === undefined && delete updates[k]
  );

  const { data, error } = await supabase
    .from("team_members")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500 }
    );
  }

  return new Response(
    JSON.stringify({ member: data }),
    { status: 200 }
  );
}
