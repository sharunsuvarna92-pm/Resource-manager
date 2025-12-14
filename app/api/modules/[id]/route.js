import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// ------------------
// Supabase client
// ------------------
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ------------------
// UPDATE MODULE
// ------------------
export async function PUT(request, { params }) {
  try {
    // ✅ App Router params must be awaited
    const { id } = await params;

    console.log("MODULE UPDATE ID:", id);

    if (!id) {
      return new Response(
        JSON.stringify({ error: "Module ID missing in route" }),
        { status: 400 }
      );
    }

    // ------------------
    // Parse body
    // ------------------
    const body = await request.json();

    const {
      name,
      description,
      primary_roles_map,
      secondary_roles_map
    } = body;

    // ------------------
    // Validation
    // ------------------
    if (!name) {
      return new Response(
        JSON.stringify({ error: "Module name is required" }),
        { status: 400 }
      );
    }

    if (primary_roles_map && typeof primary_roles_map !== "object") {
      return new Response(
        JSON.stringify({ error: "primary_roles_map must be a JSON object" }),
        { status: 400 }
      );
    }

    if (secondary_roles_map && typeof secondary_roles_map !== "object") {
      return new Response(
        JSON.stringify({ error: "secondary_roles_map must be a JSON object" }),
        { status: 400 }
      );
    }

    // ------------------
    // Update module
    // ------------------
    const { data, error } = await supabase
      .from("modules")
      .update({
        name,
        description,
        primary_roles_map,
        secondary_roles_map
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Supabase module update error:", error);
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
    console.error("Module update crash:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}
