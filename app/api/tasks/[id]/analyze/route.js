import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/* ---------------- CORS ---------------- */
function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*')
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return res
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }))
}

/* ---------------- ANALYZE ---------------- */
export async function POST(req, { params }) {
  try {
    const { id: taskId } = params

    if (!taskId) {
      return cors(
        NextResponse.json(
          { feasible: false, reason: 'Task ID missing' },
          { status: 400 }
        )
      )
    }

    /* -------- Fetch task -------- */
    const { data: task, error: taskErr } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single()

    if (taskErr || !task) {
      return cors(
        NextResponse.json(
          { feasible: false, reason: 'Task not found' },
          { status: 404 }
        )
      )
    }

    const taskStart = new Date(task.start_date)
    const taskDue = new Date(task.due_date)

    /* -------- Fetch ONLY committed assignments -------- */
    const { data: committedAssignments } = await supabase
      .from('assignments')
      .select('*')
      .eq('status', 'Committed')

    /* -------- Team work is source of truth -------- */
    const teamWork = task.team_work || {}

    const plan = {}
    let currentCursor = new Date(taskStart)

    for (const [teamName, work] of Object.entries(teamWork)) {
      const effortHours = work.effort_hours || 0
      const dependsOn = work.depends_on || []

      /* ----- Resolve dependency end ----- */
      let dependencyEnd = null
      for (const dep of dependsOn) {
        if (plan[dep]?.end_date) {
          const depEnd = new Date(plan[dep].end_date)
          if (!dependencyEnd || depEnd > dependencyEnd) {
            dependencyEnd = depEnd
          }
        }
      }

      let start = dependencyEnd
        ? new Date(dependencyEnd)
        : new Date(currentCursor)

      /* ----- Check committed conflicts ----- */
      const teamAssignments = committedAssignments.filter(
        a => a.team === teamName
      )

      let autoShifted = false
      for (const a of teamAssignments) {
        if (!a.start_date || !a.end_date) continue

        const aStart = new Date(a.start_date)
        const aEnd = new Date(a.end_date)

        if (start >= aStart && start <= aEnd) {
          start = new Date(aEnd)
          autoShifted = true
        }
      }

      const daysNeeded = Math.max(1, Math.ceil(effortHours / 8))
      const end = new Date(start)
      end.setDate(end.getDate() + daysNeeded)

      plan[teamName] = {
        assigned_to: work.assigned_to || null,
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        effort_hours: effortHours,
        depends_on: dependsOn,
        auto_shifted: autoShifted
      }

      if (end > currentCursor) currentCursor = new Date(end)
    }

    const estimatedDelivery = currentCursor.toISOString()
    const feasible = currentCursor <= taskDue

    return cors(
      NextResponse.json({
        feasible,
        estimated_delivery: estimatedDelivery,
        reason: feasible ? null : 'Capacity conflict',
        plan
      })
    )
  } catch (err) {
    console.error('Analyzer crash:', err)
    return cors(
      NextResponse.json(
        { feasible: false, reason: 'Analyzer crashed' },
        { status: 500 }
      )
    )
  }
}
