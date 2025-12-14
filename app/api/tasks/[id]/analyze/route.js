import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ---------- CORS ---------- */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

/* ---------- POST /analyze ---------- */
export async function POST(req, { params }) {
  try {
    const taskId = params?.id;
    if (!taskId) {
      return NextResponse.json(
        { feasible: false, reason: "Task ID missing" },
        { status: 400, headers: corsHeaders }
      );
    }

    /* ---------- Fetch Task ---------- */
    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .single();

    if (taskErr || !task) {
      return NextResponse.json(
        { feasible: false, reason: "Task not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    const {
      start_date,
      due_date,
      team_work = {},
    } = task;

    if (!start_date || !due_date) {
      return NextResponse.json(
        { feasible: false, reason: "Task dates missing" },
        { status: 400, headers: corsHeaders }
      );
    }

    const taskStart = new Date(start_date);
    const taskDue = new Date(due_date);

    /* ---------- Fetch committed assignments ONLY ---------- */
    const { data: committedAssignments } = await supabase
      .from("assignments")
      .select("*")
      .eq("task_id", taskId)
      .eq("status", "Committed");

    /* ---------- Build busy map ---------- */
    const busyMap = {};

    (committedAssignments || []).forEach(a => {
      if (!a.member_id || !a.start_date || !a.end_date) return;

      if (!busyMap[a.member_id]) busyMap[a.member_id] = [];
      busyMap[a.member_id].push({
        start: new Date(a.start_date),
        end: new Date(a.end_date),
      });
    });

    /* ---------- Helpers ---------- */
    const addDays = (d, days) => {
      const x = new Date(d);
      x.setDate(x.getDate() + days);
      return x;
    };

    const overlaps = (s1, e1, s2, e2) =>
      s1 < e2 && s2 < e1;

    const nextFreeDate = (memberId, desiredStart) => {
      const blocks = busyMap[memberId] || [];
      let cursor = new Date(desiredStart);

      while (true) {
        const clash = blocks.find(b =>
          overlaps(cursor, addDays(cursor, 1), b.start, b.end)
        );
        if (!clash) return cursor;
        cursor = addDays(clash.end, 1);
      }
    };

    /* ---------- Analysis Engine ---------- */
    const plan = {};
    let currentCursor = new Date(taskStart);
    let autoShifted = false;

    for (const [team, info] of Object.entries(team_work)) {
      const effortDays = Math.ceil((info.effort_hours || 1) / 8);
      const dependsOn = info.depends_on || [];

      /* dependency handling */
      if (dependsOn.length > 0) {
        const depEndDates = dependsOn
          .map(d => plan[d]?.end_date)
          .filter(Boolean)
          .map(d => new Date(d));

        if (depEndDates.length > 0) {
          const maxDepEnd = new Date(Math.max(...depEndDates));
          if (maxDepEnd > currentCursor) {
            currentCursor = addDays(maxDepEnd, 1);
          }
        }
      }

      const memberId = info.assigned_to;
      let start = currentCursor;

      if (memberId && busyMap[memberId]) {
        const free = nextFreeDate(memberId, start);
        if (free > start) {
          start = free;
          autoShifted = true;
        }
      }

      const end = addDays(start, effortDays);

      plan[team] = {
        assigned_to: memberId,
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        effort_hours: info.effort_hours,
        depends_on: dependsOn,
        auto_shifted: autoShifted,
      };

      currentCursor = end;
    }

    const estimatedDelivery = currentCursor;

    /* ---------- Feasibility ---------- */
    if (estimatedDelivery > taskDue) {
      return NextResponse.json(
        {
          feasible: false,
          reason: "Exceeds due date",
          estimated_delivery: estimatedDelivery.toISOString(),
          plan,
        },
        { headers: corsHeaders }
      );
    }

    /* ---------- SUCCESS ---------- */
    return NextResponse.json(
      {
        feasible: true,
        estimated_delivery: estimatedDelivery.toISOString(),
        plan,
      },
      { headers: corsHeaders }
    );

  } catch (err) {
    console.error("Analyzer crash:", err);
    return NextResponse.json(
      { feasible: false, reason: "Analyzer internal error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
