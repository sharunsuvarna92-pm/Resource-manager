import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function PUT(request, { params }) {
  try {
    const { id: moduleId } = await params;
    const body = await request.json();
    const { name, description, owners } = body;

    if (!moduleId || !name || !Array.isArray(owners)) {
      return new Response(
        JSON.stringify({ error: "Invalid module update payload" }),
        { status: 400 }
      );
    }

    // ------------------
    // Update module
    // ------------------
    await supabase
      .from("modules")
      .update({ name, description })
      .eq("id", moduleId);

    // ------------------
    // Replace ownership
    // ------------------
    await supabase
      .from("module_owners")
      .delete()
      .eq("module_id", moduleId);

    const ownerRows = owners.map(o => ({
      module_id: moduleId,
      team_id: o.team_id,
      member_id: o.member_id,
      role: o.role
    }));

    await supabase.from("module_owners").insert(ownerRows);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200 }
    );

  } catch (err) {
    console.error("Module update error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}
