// Ghost Crew: a session-memory list of the steps the session runs (tool calls,
// subagents, workflows, background shells), kept by event hooks and read by
// the Ghost Crew pane. Bookkeeping only: nothing here denies, rewrites or
// delays a tool call, and nothing about a step is written to disk.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { GhostCrewStatus, GhostCrewStep } from '../types'
import { classifyRole, stepLabel } from './crewart'

export const CREW_PANE = 'ghost-crew'
export const CREW_TITLE = 'Ghost Crew'
/** The most steps kept in session memory. */
export const CREW_MAX_STEPS = 60
/** Crew writes closer together than this are folded into one. */
export const CREW_WRITE_GAP_MS = 250

const NO_STEPS: GhostCrewStep[] = []
export const crewAtom = atom({ plugin: 'ghost', key: 'crew' } as const, NO_STEPS, { shape: 'ghost-crew-1' })

type Change = (steps: GhostCrewStep[]) => GhostCrewStep[]
type Call = { tool: string; tool_use_id?: string; agentId?: string }
type Ran = { deny?: unknown; isError?: unknown; result?: unknown }
export type BackgroundTask = { id: string }

// ------------------------------------------------------------------ pure

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** The step a call starts as: its role and a short description, from the call's own input. */
export function stepOf(call: Call, now: number): GhostCrewStep {
  const tool = String(call.tool)
  const step: GhostCrewStep = {
    id:
      typeof call.tool_use_id === 'string' && call.tool_use_id !== ''
        ? call.tool_use_id
        : `step-${now}-${Math.random().toString(36).slice(2, 8)}`,
    tool,
    label: stepLabel(tool, call),
    role: classifyRole(tool, call),
    status: 'running',
    startedAt: now,
  }
  if (typeof call.agentId === 'string') step.loop = call.agentId
  return step
}

/** A background job the call launched, which outlives the call: the step then stays running. */
export function launchOf(
  tool: string,
  result: unknown,
): { taskId: string; kind: NonNullable<GhostCrewStep['kind']> } | undefined {
  const r = record(result)
  if ((tool === 'Bash' || tool === 'PowerShell') && typeof r['backgroundTaskId'] === 'string') {
    return { taskId: r['backgroundTaskId'], kind: 'shell' }
  }
  if (tool === 'Agent' && r['status'] === 'async_launched' && typeof r['agentId'] === 'string') {
    return { taskId: r['agentId'], kind: 'agent' }
  }
  if (tool === 'Workflow' && typeof r['taskId'] === 'string') return { taskId: r['taskId'], kind: 'workflow' }
  if (tool === 'Monitor' && typeof r['taskId'] === 'string') return { taskId: r['taskId'], kind: 'monitor' }
  return undefined
}

/** The step after its call answered: done, failed, stopped, or still running in the background. */
export function settle(step: GhostCrewStep, ran: Ran, now: number, isAborted: boolean): GhostCrewStep {
  const hasFailed = ran.deny !== undefined || ran.isError === true
  if (!hasFailed) {
    const launch = launchOf(step.tool, ran.result)
    if (launch !== undefined) return { ...step, ...launch, status: 'running' }
  }
  const wasCut = isAborted || record(ran.result)['interrupted'] === true
  const status: GhostCrewStatus = !hasFailed ? 'done' : wasCut ? 'interrupted' : 'failed'
  return { ...step, status, endedAt: now }
}

export function capSteps(steps: GhostCrewStep[]): GhostCrewStep[] {
  return steps.length > CREW_MAX_STEPS ? steps.slice(steps.length - CREW_MAX_STEPS) : steps
}

/** Foreground steps of one loop that a finished turn left running (a call cut off before it answered). */
export function sweepLoop(
  steps: GhostCrewStep[],
  loop: string | undefined,
  status: GhostCrewStatus,
  now: number,
): GhostCrewStep[] {
  return steps.map(s =>
    s.status === 'running' && s.taskId === undefined && s.loop === loop ? { ...s, status, endedAt: now } : s,
  )
}

/** Ends the background step(s) of one job. */
export function endTask(steps: GhostCrewStep[], taskId: string, status: GhostCrewStatus, now: number): GhostCrewStep[] {
  return steps.map(s => (s.status === 'running' && s.taskId === taskId ? { ...s, status, endedAt: now } : s))
}

/**
 * Background shells, workflows and monitors that are no longer in the engine's
 * in-flight list are done. The list's ids are assumed to be the ids the launch
 * answered; when the list holds jobs and none of Ghost's, that assumption did
 * not hold and nothing is changed.
 */
export function reconcile(steps: GhostCrewStep[], inFlight: readonly BackgroundTask[], now: number): GhostCrewStep[] {
  const ids = new Set(inFlight.map(t => t.id))
  const isTracked = (s: GhostCrewStep) => s.status === 'running' && s.taskId !== undefined && s.kind !== 'agent'
  const tracked = steps.filter(isTracked)
  if (tracked.length === 0) return steps
  if (ids.size > 0 && !tracked.some(s => ids.has(s.taskId ?? ''))) return steps
  return steps.map(s => (isTracked(s) && !ids.has(s.taskId ?? '') ? { ...s, status: 'done', endedAt: now } : s))
}

/** The last steps as short lines for the tips request: "builder: Edit hooks/art.ts". */
export function stepLines(steps: readonly GhostCrewStep[], count: number): string[] {
  return steps.slice(-count).map(s => `${s.role}: ${s.label}`)
}

// ------------------------------------------------------------------ engine

// Writes are folded: a burst of parallel calls redraws the pane once. Module
// memory; a reload may lose one folded batch, which the next write replaces.
let pending: Change[] = []
let lastWriteAt = 0
let flushTimer: { cancel: () => void } | undefined

export async function crewNow($: EngineInterface): Promise<number> {
  try {
    return await $.clock.now()
  } catch {
    return Date.now()
  }
}

/** Writes everything folded so far, in one update. */
export async function flushCrew($: EngineInterface, now: number): Promise<void> {
  if (flushTimer !== undefined) {
    try {
      flushTimer.cancel()
    } catch {
      // a timer already gone
    }
    flushTimer = undefined
  }
  const batch = pending
  pending = []
  if (batch.length === 0) return
  lastWriteAt = now
  await update($, crewAtom, steps => capSteps(batch.reduce((list, change) => change(list), steps)))
  // An open Crew pane did not redraw after these writes in the desktop app
  // (it stayed at 0 / 0 while steps were recorded), so ask for the redraw
  // outright. The engine folds these to ten a second at most.
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // drawing only
  }
}

async function flushLater($: EngineInterface): Promise<void> {
  flushTimer = undefined
  try {
    await flushCrew($, await crewNow($))
  } catch {
    // the next write carries the batch
  }
}

async function writeCrew($: EngineInterface, change: Change, now: number): Promise<void> {
  pending.push(change)
  if (now - lastWriteAt >= CREW_WRITE_GAP_MS || now < lastWriteAt) {
    await flushCrew($, now)
    return
  }
  if (flushTimer === undefined) {
    flushTimer = $.clock.after(CREW_WRITE_GAP_MS, () => void flushLater($))
  }
}

/** Before the tool runs: records the step. Never throws; answers the step, or undefined when it could not be recorded. */
export async function beginStep($: EngineInterface, call: Call): Promise<GhostCrewStep | undefined> {
  try {
    const now = await crewNow($)
    const step = stepOf(call, now)
    await writeCrew($, steps => [...steps.filter(s => s.id !== step.id), step], now)
    return step
  } catch {
    return undefined
  }
}

/** After the tool answered: marks the step. Never throws and never touches the result. */
export async function endStep(
  $: EngineInterface,
  step: GhostCrewStep | undefined,
  ran: Ran,
  isAborted: boolean,
): Promise<void> {
  if (step === undefined) return
  try {
    const now = await crewNow($)
    const settled = settle(step, ran, now, isAborted)
    const stopped = step.tool === 'TaskStop' && settled.status === 'done' ? record(ran.result)['task_id'] : undefined
    await writeCrew(
      $,
      steps => {
        const list = steps.map(s => (s.id === step.id ? settled : s))
        return typeof stopped === 'string' ? endTask(list, stopped, 'killed', now) : list
      },
      now,
    )
  } catch {
    // bookkeeping only
  }
}

/** A turn ended: its loop's unanswered steps end with it, and a subagent's own background step is finished. */
export async function endTurn($: EngineInterface, loop: string | undefined, reason: string): Promise<void> {
  try {
    const now = await crewNow($)
    const status: GhostCrewStatus = reason === 'answer' ? 'done' : reason === 'aborted' ? 'interrupted' : 'failed'
    pending.push(steps => {
      const swept = sweepLoop(steps, loop, reason === 'answer' ? 'done' : 'interrupted', now)
      return loop === undefined ? swept : endTask(swept, loop, status, now)
    })
    await flushCrew($, now)
  } catch {
    // bookkeeping only
  }
}

/** The engine's own list of background work still in flight, as a Stop reports it. */
export async function syncBackground(
  $: EngineInterface,
  inFlight: readonly BackgroundTask[] | undefined,
): Promise<void> {
  if (inFlight === undefined) return
  try {
    const now = await crewNow($)
    pending.push(steps => reconcile(steps, inFlight, now))
    await flushCrew($, now)
  } catch {
    // bookkeeping only
  }
}

export function readCrew($: EngineInterface): Promise<GhostCrewStep[]> {
  return read($, crewAtom)
}

/** For tests: the write folding as a new session has it. */
export function resetCrewForTest(): void {
  pending = []
  lastWriteAt = 0
  flushTimer = undefined
}
