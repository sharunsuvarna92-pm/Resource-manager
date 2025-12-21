import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * GET /api/modules
 * Returns modules with ownership details (primary + secondary)
 */
export async function GET() {
  // 1️⃣ Fetch modules
  const { data: modules, error: moduleError } = await supabase
    .from("modules")
    .select("id, name, description, created_at")
    .order("name");

  if (moduleError) {
    return NextResponse.json(
      { error: moduleError.message },
      { status: 500 }
    );
  }

  if (!modules || modules.length === 0) {
    return NextResponse.json({ modules: [] });
  }

  const moduleIds = modules.map(m => m.id);

  // 2️⃣ Fetch ownerships with joins
  const { data: owners, error: ownerError } = await supabase
    .from("module_owners")
    .select(`
      module_id,
      role,
      teams (
        id,
        name
      ),
      team_members (
        id,
        name
      )
    `)
    .in("module_id", moduleIds);

  if (ownerError) {
    return NextResponse.json(
      { error: ownerError.message },
      { status: 500 }
    );
  }

  // 3️⃣ Group owners by module
  const ownersByModule = {};

  owners.forEach(o => {
    if (!ownersByModule[o.module_id]) {
      ownersByModule[o.module_id] = [];
    }

    ownersByModule[o.module_id].push({
      team_id: o.teams?.id ?? null,
      team_name: o.teams?.name ?? null,
      member_id: o.team_members?.id ?? null,
      member_name: o.team_members?.name ?? null,
      role: o.role
    });
  });

  // 4️⃣ Attach owners to modules
  const enriched = modules.map(m => ({
    ...m,
    owners: ownersByModule[m.id] ?? []
  }));

  return NextResponse.json({ modules: enriched });
}
