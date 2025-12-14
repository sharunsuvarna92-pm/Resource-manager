import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/* ------------------ CORS ------------------ */
export async function OPTIONS() {
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  })
}

/* ------------------ HELPERS ------------------ */
const addDays = (date, days) => {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

const safeDate = (value, fallback) => {
  const d = new Date(value)
  return isNaN(d.getTime()) ? new Date(fallback) : d
}

/* ------------------ ANALYZE ------------------ */
export async function POST(req, { params }) {
  try {
    const taskId = params.id

    /* ---------- 1. Load task ---------- */
    const { data: task, error: taskErr } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single()

    if (taskErr || !task) {
      return NextResponse.json(
        { feasible: false, reason: 'Task not found' },
        { status: 404 }
      )
    }

    /* ---------- 2. Load committed assignments ---------- */
    const { data: committed } = await supabase
      .from('assignments')
      .select('*')
      .eq('task_id', taskId)
      .eq('status', 'Committed')

    /* ---------- 3. Determine baseline start ---------- */
    let baselineStart = safeDate(task.start_date, new Date())

    if (committed && committed.length > 0) {
      const latest = committed
        .map(a => new Date(a.end_date))
        .filter(d => !isNaN(d.getTime()))
        .sort((a, b) => b - a)[0]

      baselineStart = latest || baselineStart
    }

    /* ---------- 4. Build execution plan ---------- */
    const plan = {}
    let currentPointer = new Date(baselineStart)

    const teamWork = task.team_work || {}

    for (const team of Object.keys(teamWork)) {
      const effort = teamWork[team].effort_hours || 0
      const dependsOn = teamWork[team].depends_on || []

      // dependency resolution
      if (dependsOn.length > 0) {
        const depEndDates = dependsOn
          .map(t => plan[t]?.end_date)
          .filter(Boolean)
          .map(d => new Date(d))

        if (depEndDates.length > 0) {
          currentPointer = new Date(
            Math.max(...depEndDates.map(d => d.getTime()))
          )
        }
      }

      const start = new Date(currentPointer)
      const end = addDays(start, Math.ceil(effort / 8))

      plan[team] = {
        assigned_to: teamWork[team].assigned_to || null,
        effort_hours: effort,
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        depends_on: dependsOn,
        auto_shifted: true
      }

      currentPointer = new Date(end)
    }

    /* ---------- 5. Delivery decision ---------- */
    const estimatedDelivery = currentPointer
    const dueDate = safeDate(task.due_date, estimatedDelivery)

    const feasible = estimatedDelivery <= dueDate

    return NextResponse.json({
      feasible,
      estimated_delivery: estimatedDelivery.toISOString(),
      reason: feasible ? null : 'Capacity overlap or dependency delay',
      plan
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    })

  } catch (err) {
    console.error('Analyzer crash:', err)
    return NextResponse.json(
      { feasible: false, reason: 'Analyzer internal error' },
      { status: 500 }
    )
  }
}
