import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function PUT(request, ctx) {
  // ✅ Primary: params (ideal case)
  let id = ctx?.params?.id;

  // ✅ Fallback: parse from URL (App Router edge-case fix)
  if (!id) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/");
    id = parts[parts.length - 1];
  }

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

export async function PATCH(request, ctx) {
  return PUT(request, ctx);
}
