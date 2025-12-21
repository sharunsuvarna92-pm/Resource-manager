import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * CREATE MODULE
 * POST /api/modules
 */
export async function POST(request) {
  const body = await request.json();
  const { name, description, module_owners } = body;

  if (!name) {
    return NextResponse.json(
      { error: "Module name is required" },
      { status: 400 }
    );
  }

  // 1️⃣ Create module
  const { data: module, error: moduleError } = await supabase
    .from("modules")
    .insert({
      name,
      description,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (moduleError) {
    return NextResponse.json(
      { error: moduleError.message },
      { status: 500 }
    );
  }

  // 2️⃣ Insert owners (optional)
  if (Array.isArray(module_owners) && module_owners.length > 0) {
    const rows = module_owners.map(o => ({
      module_id: module.id,
      team_id: o.team_id,
      member_id: o.member_id,
      role: o.role,
      created_at: new Date().toISOString()
    }));

    const { error: ownerError } = await supabase
      .from("module_owners")
      .insert(rows);

    if (ownerError) {
      return NextResponse.json(
        {
          error: "Module created but owner assignment failed",
          details: ownerError.message
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { module },
    { status: 201 }
  );
}

/**
 * LIST MODULES
 * GET /api/modules
 */
export async function GET() {
  const { data, error } = await supabase
    .from("modules")
    .select("id, name, description, created_at")
    .order("name");

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ modules: data });
}
