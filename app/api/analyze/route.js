// app/api/analyze/route.js
import { createClient } from '@supabase/supabase-js';
import { parseISO, addDays, isBefore } from 'date-fns';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase env vars NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const MS_IN_HOUR = 1000 * 60 * 60;
const MS_IN_DAY = MS_IN_HOUR * 24;

function ceilDaysBetween(start, end) {
  const ms = end.getTime() - start.getTime();
  if (ms <= 0) return 1;
  return Math.ceil(ms / MS_IN_DAY);
}

function dailyCapacity(member) {
  const capWeek = Number(member.capacity_hours_per_week) || 40;
  return capWeek / 7;
}

function computeBusyHoursFromAssignmentsArray(assignments, windowStart, windowEnd) {
  let busy = 0;
  for (const a of assignments || []) {
    try {
      const aStart = a.start_date ? parseISO(a.start_date) : null;
      const aEnd = a.end_date ? parseISO(a.end_date) : null;
      if (!aStart || !aEnd) continue;
      const assignTotalMs = Math.max(1, aEnd.getTime() - aStart.getTime());
      const overlapMsStart = Math.max(aStart.getTime(), windowStart.getTime());
      const overlapMsEnd = Math.min(aEnd.getTime(), windowEnd.getTime());
      if (overlapMsEnd <= overlapMsStart) continue;
      const overlapMs = overlapMsEnd - overlapMsStart;
      const proportion = Math.min(1, overlapMs / assignTotalMs);
      const hoursInOverlap = (Number(a.assigned_hours) || 0) * proportion;
      busy += hoursInOverlap;
    } catch (err) {
      // ignore malformed
    }
  }
  return busy;
}

export async function POST(request) {
  try {
        // ---- LOCAL TESTING: bypass auth (remove for production) ----
    const userData = { user: { id: 'local-dev' } };

    const payload = await request.json();
    const task = payload?.task;
    if (!task) return new Response(JSON.stringify({ error: 'Missing task in body' }), { status: 400 });

    const START = parseISO(task.start_date);
    const REQUIRED_BY = parseISO(task.required_by);
    if (!START || !REQUIRED_BY || isBefore(REQUIRED_BY, START)) {
      return new Response(JSON.stringify({ error: 'Invalid start_date or required_by' }), { status: 400 });
    }

    // policy/options
    const policy = payload.policy || {};
    const preferPrimary = policy.preferPrimary ?? false;

    // fetch teams
    const { data: teamsData } = await supabaseAdmin.from('teams').select('id,name');
    const teamNameToId = {};
    for (const t of teamsData || []) teamNameToId[String(t.name)] = String(t.id);

    // fetch members
    const { data: membersData } = await supabaseAdmin
      .from('team_members')
      .select('*')
      .eq('is_active', true);

    // fetch assignments
    const { data: assignmentsData } = await supabaseAdmin
      .from('assignments')
      .select('*');

    // fetch tasks' assignees if used
    const { data: tasksAll } = await supabaseAdmin
      .from('tasks')
      .select('id,assignees,start_date,required_by');

    // build member map and attach their assignments
    const memberMap = {};
    for (const m of membersData || []) {
      memberMap[String(m.id)] = { ...m, assignments: [] };
    }

    for (const a of assignmentsData || []) {
      const mid = String(a.member_id);
      if (!memberMap[mid]) continue;
      memberMap[mid].assignments.push({
        assigned_hours: Number(a.assigned_hours) || 0,
        start_date: a.start_date || a.created_at,
        end_date: a.end_date || a.start_date || a.created_at
      });
    }

    for (const t of tasksAll || []) {
      const ass = t.assignees || [];
      for (const a of ass) {
        const mid = String(a.member_id);
        if (!memberMap[mid]) continue;
        memberMap[mid].assignments.push({
          assigned_hours: Number(a.assigned_hours) || 0,
          start_date: a.start_date || t.start_date || START.toISOString(),
          end_date: a.end_date || t.end_date || t.required_by || REQUIRED_BY.toISOString()
        });
      }
    }

    // determine dependency chains
    let orderedChains = [];
    if (task.dependency_order && Array.isArray(task.dependency_order)) {
      orderedChains = [task.dependency_order];
    } else {
      orderedChains = [task.teams_involved || Object.keys(task.team_work || {})];
    }

    const report = { feasible: true, perTeam: {}, overallMessage: '' };

    const resolveTeamId = (teamName) => teamNameToId[teamName] || null;

    const checkOwnerAvailability = (ownerId, windowStart, windowEnd, effortHours) => {
      if (!ownerId) return { available: false, reason: 'No owner assigned' };
      const member = memberMap[String(ownerId)];
      if (!member) return { available: false, reason: 'Owner not found or inactive' };

      const numDays = ceilDaysBetween(windowStart, windowEnd);
      const capacityInWindow = dailyCapacity(member) * numDays;
      const busy = computeBusyHoursFromAssignmentsArray(member.assignments || [], windowStart, windowEnd);
      const free = Math.max(0, capacityInWindow - busy);
      const fits = free >= effortHours;

      return { available: fits, freeHours: free, busyHours: busy, capacityInWindow, member };
    };

    // process chains sequentially
    for (const chain of orderedChains) {
      let cursorStart = START;
      for (const teamName of chain) {
        const teamWork = (task.team_work || {})[teamName];
        if (!teamWork) {
          report.perTeam[teamName] = { skipped: true, message: 'No work specified for this team' };
          continue;
        }

        const effort = Number(teamWork.effort_hours || 0);
        const primaryId = teamWork.owner_id || null;
        const secondaryIds = teamWork.secondary_ids || [];

        const windowStart = cursorStart;
        const windowEnd = REQUIRED_BY;

        // check primary
        const pcheck = checkOwnerAvailability(primaryId, windowStart, windowEnd, effort);
        if (pcheck.available) {
          const dailyCap = dailyCapacity(pcheck.member);
          const daysNeeded = Math.max(1, Math.ceil(effort / dailyCap));
          const finishDate = addDays(windowStart, daysNeeded - 1);
          report.perTeam[teamName] = {
            assignedTo: pcheck.member.id,
            assignedName: pcheck.member.name,
            available: true,
            finishDate: finishDate.toISOString().split('T')[0],
            details: { freeHours: pcheck.freeHours, busyHours: pcheck.busyHours, capacityInWindow: pcheck.capacityInWindow }
          };
          cursorStart = addDays(windowStart, daysNeeded);
          continue;
        }

        // check secondaries
        let assigned = null;
        for (const sid of secondaryIds) {
          const scheck = checkOwnerAvailability(sid, windowStart, windowEnd, effort);
          if (scheck.available) { assigned = { member: scheck.member, check: scheck }; break; }
        }

        if (assigned) {
          const dailyCap = dailyCapacity(assigned.member);
          const daysNeeded = Math.max(1, Math.ceil(effort / dailyCap));
          const finishDate = addDays(windowStart, daysNeeded - 1);
          report.perTeam[teamName] = {
            assignedTo: assigned.member.id,
            assignedName: assigned.member.name,
            available: true,
            finishDate: finishDate.toISOString().split('T')[0],
            details: { freeHours: assigned.check.freeHours ?? assigned.check.free, busyHours: assigned.check.busyHours ?? assigned.check.busy, capacityInWindow: assigned.check.capacityInWindow ?? assigned.check.capacityInWindow }
          };
          cursorStart = addDays(windowStart, daysNeeded);
          continue;
        }

        // fallback: any team member
        const teamId = resolveTeamId(teamName);
        let altFound = null;
        if (teamId) {
          for (const m of Object.values(memberMap)) {
            if (String(m.team_id) !== String(teamId)) continue;
            const numDays = ceilDaysBetween(windowStart, windowEnd);
            const capacityInWindow = dailyCapacity(m) * numDays;
            const busy = computeBusyHoursFromAssignmentsArray(m.assignments || [], windowStart, windowEnd);
            const free = Math.max(0, capacityInWindow - busy);
            if (free >= effort) { altFound = { member: m, free, busy, capacityInWindow }; break; }
          }
        }

        if (altFound) {
          const dailyCap = dailyCapacity(altFound.member);
          const daysNeeded = Math.max(1, Math.ceil(effort / dailyCap));
          const finishDate = addDays(windowStart, daysNeeded - 1);
          report.perTeam[teamName] = {
            assignedTo: altFound.member.id,
            assignedName: altFound.member.name,
            available: true,
            finishDate: finishDate.toISOString().split('T')[0],
            details: { freeHours: altFound.free, busyHours: altFound.busy, capacityInWindow: altFound.capacityInWindow },
            note: 'Assigned to alternative member (not primary/secondary)'
          };
          cursorStart = addDays(windowStart, daysNeeded);
          continue;
        }

        // nothing fits
        report.perTeam[teamName] = {
          assignedTo: null,
          available: false,
          message: `No available primary/secondary/alternative member in team ${teamName} can complete ${effort}h between ${windowStart.toISOString().split('T')[0]} and ${windowEnd.toISOString().split('T')[0]}`
        };
        report.feasible = false;
        report.overallMessage = `Task cannot be completed by ${task.required_by} due to ${teamName} capacity.`;
        break;
      }

      if (!report.feasible) break;
    }

    if (report.feasible) report.overallMessage = `All teams can complete work before ${task.required_by}`;

    return new Response(JSON.stringify({ report, meta: { checkedAt: new Date().toISOString() } }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('[analyze] error', err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
