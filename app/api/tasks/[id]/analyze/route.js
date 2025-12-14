import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/* ---------------- CORS ---------------- */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders })
}

/* ---------------- HELPERS ---------------- */
function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/* ---------------- POST ---------------- */
export async function POST(req, { params }) {
  try {
    const { id: taskId } = await params

    if (!taskId) {
      return Response.json(
        { error: 'Task ID missing' },
        { status: 400, headers: corsHeaders }
      )
    }

    /* ---------- Fetch task ---------- */
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single()

    if (taskError || !task) {
      return Response.json(
        { feasible: false, reason: 'Task not found' },
        { status: 404, headers: corsHeaders }
      )
    }

    const teamWork = task.team_work || {}

    /* ---------- Fetch committed assignments ---------- */
    const { data: committedAssignments } = await supabase
      .from('assignments')
      .select('*')
      .eq('status', 'Committed')

    // Group committed assignments by member
    const busyMap = {}
    for (const a of committedAssignments || []) {
      if (!busyMap[a.member_id]) busyMap[a.member_id] = []
      busyMap[a.member_id].push(a)
    }

    const plan = {}
    let estimatedDelivery = new Date(task.start_date)

    /* ---------- Analyze each team ---------- */
    for (const [teamName, work] of Object.entries(teamWork)) {
      const {
        assigned_to,
        effort_hours,
        depends_on = []
      } = work

      let start = new Date(task.start_date)

      /* ----- Respect dependencies ----- */
      for (const dep of depends_on) {
        if (plan[dep]) {
          const depEnd = new Date(plan[dep].end_date)
          if (depEnd > start) start = depEnd
        }
      }

      /* ----- Respect member busy schedule ----- */
      const memberBusy = busyMap[assigned_to] || []
      for (const b of memberBusy) {
        const busyEnd = new Date(b.end_date)
        if (busyEnd > start) start = busyEnd
      }

      const durationDays = Math.ceil(effort_hours / 8)
      const end = addDays(start, durationDays)

      plan[teamName] = {
        assigned_to,
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        effort_hours,
        depends_on,
        auto_shifted: start > new Date(task.start_date)
      }

      if (end > estimatedDelivery) estimatedDelivery = end
    }

    /* ---------- Feasibility ---------- */
    const dueDate = new Date(task.due_date)
    const feasible = estimatedDelivery <= dueDate

    return Response.json(
      {
        feasible,
        estimated_delivery: estimatedDelivery.toISOString(),
        plan,
        ...(feasible
          ? {}
          : {
              reason: 'Estimated delivery exceeds due date',
              blocking_teams: Object.keys(plan).filter(
                t => new Date(plan[t].end_date) > dueDate
              )
            })
      },
      { status: 200, headers: corsHeaders }
    )
  } catch (err) {
    console.error('Analyze crash:', err)
    return Response.json(
      { feasible: false, reason: 'Internal analysis error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
