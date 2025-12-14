import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const taskId = params.id

    /* -------------------------
       1. Fetch task
    -------------------------- */
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single()

    if (taskError || !task) {
      return NextResponse.json(
        { feasible: false, reason: 'Task not found' },
        { status: 404, headers: corsHeaders }
      )
    }

    const taskStart = new Date(task.start_date)
    const taskDue = new Date(task.due_date)

    /* -------------------------
       2. Fetch committed assignments
    -------------------------- */
    const { data: committedAssignments } = await supabase
      .from('assignments')
      .select('*')
      .eq('status', 'committed')

    const teamWork = task.team_work || {}

    const plan: any = {}
    let feasible = true
    let blockingReason = null
    let latestEnd = taskStart

    /* -------------------------
       3. Helper functions
    -------------------------- */
    const daysFromHours = (hours: number) =>
      Math.ceil(hours / 8)

    const addDays = (date: Date, days: number) => {
      const d = new Date(date)
      d.setDate(d.getDate() + days)
      return d
    }

    const getTeamAvailability = (team: string) => {
      const teamAssignments =
        committedAssignments?.filter(a => a.source === team) || []

      if (teamAssignments.length === 0) return taskStart

      return new Date(
        Math.max(
          ...teamAssignments.map(a =>
            new Date(a.end_date).getTime()
          )
        )
      )
    }

    /* -------------------------
       4. Build plan respecting dependencies
    -------------------------- */
    for (const [team, config] of Object.entries(teamWork)) {
      const effort = config.effort_hours || 0
      const dependsOn: string[] = config.depends_on || []

      let start = getTeamAvailability(team)

      for (const dep of dependsOn) {
        if (!plan[dep]) continue
        start = new Date(
          Math.max(start.getTime(), new Date(plan[dep].end_date).getTime())
        )
      }

      const durationDays = daysFromHours(effort)
      const end = addDays(start, durationDays)

      if (end > taskDue) {
        feasible = false
        blockingReason = `Team ${team} cannot complete before due date`
      }

      plan[team] = {
        assigned_to: null, // filled on commit
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        effort_hours: effort,
        depends_on: dependsOn,
        auto_shifted: start > taskStart
      }

      if (end > latestEnd) latestEnd = end
    }

    /* -------------------------
       5. Final response
    -------------------------- */
    return NextResponse.json(
      {
        feasible,
        reason: feasible ? null : blockingReason,
        estimated_delivery: latestEnd.toISOString(),
        plan
      },
      { headers: corsHeaders }
    )
  } catch (err: any) {
    console.error('Analyzer crash:', err)

    return NextResponse.json(
      {
        feasible: false,
        reason: 'Analyzer internal error',
        details: err.message
      },
      { status: 500, headers: corsHeaders }
    )
  }
}
