import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function PUT(request, context) {
  try {
    const id = context.params?.id;

    console.log("TEAM UPDATE ID:", id);

    if (!id) {
      return new Response(
        JSON.stringify({ error: "Team ID missing in route" }),
        { status: 400 }
      );
    }

    const body = await request.json();
    const { name, description, team_leads } = body;

    const { data, error } = await supabase
      .from("teams")
      .update({
        name,
        description,
        team_leads,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Supabase update error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500 }
      );
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Update team crash:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}
