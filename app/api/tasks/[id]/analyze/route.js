import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/* ---------- Helpers ---------- */

function addDays(date, days) {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function ceilDays(hours, capacityPerDay = 8) {
  return Math.max(1, Math.ceil(hours / capacityPerDay))
}

function maxDate(dates) {
  const valid = dates.filter(Boolean).map(d => new Date(d))
  if (!valid.length) return null
  return new Date(Math.max(...valid.map(d => d.getTime())))
}

/* ---------- Route ---------- */

export async function POST(req, context) {
  // ✅ FIX: params must be awaited
  const { id: taskId } = await context.params

  if (!taskId) {
    return NextResponse.json(
      { feasible: false, reason: 'Task ID missing' },
      { status: 400 }
    )
  }

  /* ---------- Fetch task ---------- */
  const { data: task, error: taskErr } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single()

  if (taskErr || !task) {
    return NextResponse.json(
      { feasible: false, reason: 'Task not found' },
      { status: 400 }
    )
  }

  if (!task.team_work || !task.start_date || !task.due_date) {
    return NextResponse.json(
      { feasible: false, reason: 'Task missing planning data' },
      { status: 400 }
    )
  }

  /* ---------- Fetch committed assignments ---------- */
  const { data: assignments = [] } = await supabase
    .from('assignments')
    .select('*')
    .eq('status', 'Committed')

  /* ---------- Fetch module ---------- */
  const { data: module } = await supabase
    .from('modules')
    .select('*')
    .eq('id', task.module_id)
    .single()

  if (!module?.primary_roles_map) {
    return NextResponse.json(
      { feasible: false, reason: 'Module owners not defined' },
      { status: 400 }
    )
  }

  /* ---------- Planning ---------- */
  const plan = {}
  const timeline = {}
  let feasible = true
  let blocking_team = null

  const teams = Object.keys(task.team_work)

  // Process teams in dependency-safe loop
  for (const team of teams) {
    const config = task.team_work[team]
    const effort = config.effort_hours
    const dependsOn = config.depends_on || []

    const primaryOwner = module.primary_roles_map[team]
    if (!primaryOwner) {
      feasible = false
      blocking_team = team
      continue
    }

    /* ---- Dependency constraint ---- */
    const dependencyEndDates = dependsOn
      .map(dep => timeline[dep]?.end_date)
      .filter(Boolean)

    const dependencyStart = maxDate(dependencyEndDates)

    /* ---- Availability constraint ---- */
    const memberAssignments = assignments.filter(
      a => a.member_id === primaryOwner
    )

    const busyUntil = maxDate(memberAssignments.map(a => a.end_date))

    /* ---- Final start date ---- */
    const startDate =
      maxDate([task.start_date, dependencyStart, busyUntil]) ??
      new Date(task.start_date)

    const durationDays = ceilDays(effort)
    const endDate = addDays(startDate, durationDays)

    /* ---- Due date check ---- */
    if (endDate > new Date(task.due_date)) {
      feasible = false
      blocking_team = team
    }

    timeline[team] = {
      assigned_to: primaryOwner,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      effort_hours: effort,
      depends_on: dependsOn,
      auto_shifted: Boolean(dependencyStart || busyUntil)
    }

    plan[team] = timeline[team]
  }

  const estimatedDelivery = maxDate(
    Object.values(timeline).map(t => t.end_date)
  )

  return NextResponse.json({
    feasible,
    blocking_team,
    estimated_delivery: estimatedDelivery
      ? estimatedDelivery.toISOString()
      : null,
    plan
  })
}
