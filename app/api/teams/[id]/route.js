export async function PUT(request, { params }) {
  const { id } = await params;
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
    return withCors({ error: error.message }, 500);
  }

  return withCors(data);
}
