import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// UPDATE TEAM (AUTHORITATIVE)
export async function PUT(request, { params }) {
  const { id } = params ?? {};

  if (!id) {
    return new Response(
      JSON.stringify({ error: "Missing team ID" }),
      { status: 400 }
    );
  }

  const { name, description } = await request.json();

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;

  const { data, error } = await supabase
    .from("teams")
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
    JSON.stringify({ team: data }),
    { status: 200 }
  );
}

// PATCH ALIAS (OPTIONAL BUT SAFE)
export async function PATCH(request, ctx) {
  return PUT(request, ctx);
}
