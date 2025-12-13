import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request) {
  try {
    console.log("➡️ /api/teams called");

    console.log("ENV URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
    console.log(
      "ENV KEY EXISTS:",
      !!process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const body = await request.json();
    console.log("REQUEST BODY:", body);

    const { name, description } = body;

    if (!name || name.trim() === "") {
      return NextResponse.json(
        { error: "Team name is required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("teams")
      .insert([{ name, description }])
      .select()
      .single();

    if (error) {
      console.error("SUPABASE ERROR:", error);
      return NextResponse.json(
        { error },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: "Team created successfully", team: data },
      { status: 201 }
    );
  } catch (err) {
    console.error("UNHANDLED ERROR:", err);
    return NextResponse.json(
      { error: err.message || err },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase
      .from("teams")
      .select("id, name, description")
      .order("name", { ascending: true });

    if (error) {
      console.error("SUPABASE GET ERROR:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { teams: data },
      { status: 200 }
    );
  } catch (err) {
    console.error("UNHANDLED GET ERROR:", err);
    return NextResponse.json(
      { error: err.message || err },
      { status: 500 }
    );
  }
}
