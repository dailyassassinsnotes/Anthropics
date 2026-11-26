// Ghost's progress figure: the percentage and the short line shown while a
// prompt is being improved. The band draws it inside the pill and a Stop
// button stands in the Ghost control's place meanwhile; a terminal shows it as
// text beside the button. Since 2.5 the figure is native text on every
// surface: each whole percent is written to the state and drawn as text, so
// no drawing is loaded again while it counts (2.3.1 to 2.4.1 counted inside
// an Svg by CSS, whose every change of source blinked).
//
// The figure is SIMULATED. The engine gives a mod no progress signal for a
// model request (the reply comes back whole), so the figure eases toward 91%
// on a timer, stands still while a clarifying question is open, and reaches
// 100% only when the improved prompt is ready and shown. A failed run never
// shows 100%.
//
// One timer ticks while a run is on; none while Ghost is idle and none while
// a question is open. A value is written only when the whole percent changed,
// at most once per TICK_MS, and only the band reads it. The figure never
// holds the work up: starting it awaits nothing.

import { atom, read } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'

import type { GhostProgress } from '../types'

/** The ticker's period: ten a second, so the figure never skips a percent (the curve rises at most 1.03% in 100 ms). */
export const TICK_MS = 100
/** The figure eases toward this and never reaches it: CAP - 1 is the most a running job shows. */
export const CAP = 92
/** The ease's time constant: 39% after 5 s, 61% after 10 s, 82% after 20 s, 90% after 40 s. */
export const TAU_MS = 9000
/** How long 100% stays on the button before it reads "Ghost" again. */
export const HOLD_MS = 700
/**
 * A 100% older than this is not shown when the band next draws. A hold whose
 * timer never fired (a refused timer neither throws nor fires) asks for no
 * redraw by itself, so that 100% can stay on screen until something else
 * draws the band; the next sent prompt clears it (settleProgress).
 */
export const STALE_MS = 5000
/**
 * The figure a run is at when its first clarifying question opens: the first
 * of two model calls is back, so a run below this steps up to it, then stands
 * still until the answer.
 */
export const ASKED_PCT = 50
/** The most characters of a button label, the percent included. */
export const LABEL_MAX = 28

/** The lines beside the percent, by range; a run keeps one variant per range. No emoji. */
export const PROGRESS_LINES: readonly { from: number; to: number; lines: readonly string[] }[] = [
  { from: 0, to: 14, lines: ['waking the ghost', 'booting the vibes', 'shaking out the sheet'] },
  { from: 15, to: 34, lines: ['reading your vibes', 'sniffing the draft', 'poking at the idea'] },
  { from: 35, to: 59, lines: ['untangling spaghetti', 'stacking the blocks', 'mixing the potion'] },
  { from: 60, to: 84, lines: ['sprinkling prompt dust', 'tightening the bolts', 'sanding the edges'] },
  { from: 85, to: 99, lines: ['polishing magic words', 'last lap on the slide', 'one last cartwheel'] },
  { from: 100, to: 100, lines: ['boo! prompt ready', 'ta-da! all yours', 'done. your move'] },
]

// ------------------------------------------------------------------ pure

/** The simulated figure after `ms` of unpaused work: 0 at the start, rising ever slower, never above CAP - 1. */
export function eased(ms: number): number {
  if (!(ms > 0)) return 0
  return Math.min(CAP - 1, Math.floor(CAP * (1 - Math.exp(-ms / TAU_MS))))
}

/**
 * The inverse of the curve: the unpaused time (ms, exact) at which the figure
 * reaches `pct`, t(p) = -TAU_MS * ln(1 - p / CAP). A figure that stood at a
 * percent (a question) goes on from this time, upward from that number.
 */
export function countMs(pct: number): number {
  const p = Math.max(0, Math.min(CAP - 1, pct))
  return p <= 0 ? 0 : -TAU_MS * Math.log(1 - p / CAP)
}

/** The unpaused time at which eased() first reads `pct`: whole ms, just past countMs. */
export function msFor(pct: number): number {
  return Math.ceil(countMs(pct)) + 1
}

/** Which variant of each range's line a run shows: from the draft, so one run never changes its wording mid-range. */
export function progressPick(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % 3
}

/** The line for a percent: the range it falls in, the run's variant of it. */
export function lineFor(pct: number, pick = 0): string {
  const at = Math.max(0, Math.min(100, Math.floor(pct)))
  const index = Math.max(
    0,
    PROGRESS_LINES.findIndex(range => at >= range.from && at <= range.to),
  )
  const lines = PROGRESS_LINES[index]?.lines ?? []
  // Each range starts one variant on from the range before it, so a run mixes the sets.
  return lines[(Math.abs(Math.floor(pick)) + index) % Math.max(1, lines.length)] ?? ''
}

/** The Ghost button's label while a run is on: "42% mixing the potion". */
export function labelFor(pct: number, pick = 0): string {
  const at = Math.max(0, Math.min(100, Math.floor(pct)))
  return `${at}% ${lineFor(at, pick)}`
}

// ------------------------------------------------------------------ state

const PROGRESS = { plugin: 'ghost', key: 'progress' } as const
const NO_PROGRESS: GhostProgress | null = null
/** Session memory only. `null`: no run, the button reads "Ghost". */
export const progressAtom = atom(PROGRESS, NO_PROGRESS)

// This copy of the module. $.state outlives a hot reload and timers do not, so
// a figure another copy left behind (its ticker gone) is read as "no run".
const LOAD = Math.random().toString(36).slice(2, 10)

// Module variables: a hot reload drops them with the old copy's timers.
let generation = 0
// True from a run's start until its figure is cleared (the failure, or the end
// of the 100% hold). The button shows a figure only while this is true, so a
// clearing write that is refused or lost cannot leave one standing.
let live = false
let tickTimer: Timer | undefined
let holdTimer: Timer | undefined

function writeProgress($: EngineInterface, value: GhostProgress | null): Promise<unknown> {
  return $.state.set(PROGRESS, value)
}

/**
 * The figure the Ghost button shows now, or null for the plain button. Read
 * while the band draws, so a write draws the band again. Never throws.
 */
export async function shownProgress($: EngineInterface): Promise<GhostProgress | null> {
  if (!live) return null
  try {
    const held = await read($, progressAtom)
    if (held === null || held.load !== LOAD) return null
    if (held.pct < 100) return held
    const now = await $.clock.now()
    return held.at !== undefined && now - held.at <= STALE_MS ? held : null
  } catch {
    return null
  }
}

/**
 * Drops a figure nothing stands behind any more: one a lost clearing write
 * left in the state, or a 100% whose hold timer never fired. Called when a
 * prompt is sent; a running figure and a fresh 100% are left alone. Never throws.
 */
export async function settleProgress($: EngineInterface): Promise<void> {
  try {
    const held = await read($, progressAtom)
    if (held === null) return
    if (live && held.load === LOAD) {
      if (held.pct < 100) return
      const now = await $.clock.now()
      if (held.at !== undefined && now - held.at <= STALE_MS) return
      live = false
    }
    await writeProgress($, null)
  } catch {
    // the button already reads "Ghost" for a figure that is not live or is stale
  }
}

/** One run's handle: the questions pause it, the end of the job finishes it. */
export type ProgressRun = {
  /** A clarifying question opened: the figure stands still and its ticker stops. */
  pause: () => void
  /** The question was answered or dismissed: the figure moves on from where it stood. */
  resume: () => void
  /**
   * The job ended. Stops the ticker; `ok` shows 100%, holds it HOLD_MS, then
   * clears the figure; a failure clears it at once and never shows 100%.
   */
  finish: (ok: boolean) => Promise<void>
}

function cancelTimers(): void {
  try {
    tickTimer?.cancel()
  } catch {
    // already gone
  }
  try {
    holdTimer?.cancel()
  } catch {
    // already gone
  }
  tickTimer = undefined
  holdTimer = undefined
}

/**
 * Starts the figure at 0% and its ticker. `seed` (the draft) picks the wording.
 * One run at a time: starting cancels what an earlier run left (its hold).
 * It returns at once and awaits nothing, so the figure is never in the way of
 * the work it counts: its writes and its clock go on beside the job. With no
 * clock there is no ticker and no 100% hold: 0%, then the plain button.
 * Never throws; trouble leaves the button plain.
 */
export function startProgress($: EngineInterface, seed: string): ProgressRun {
  generation += 1
  const mine = generation
  cancelTimers()
  live = true
  const pick = progressPick(seed)

  let activeMs = 0
  let pauses = 0
  let last = 0
  let stopped = false
  let hasClock = false
  let myTick: Timer | undefined
  // Writes go out one after another, in the order they were made.
  let queue: Promise<unknown> = Promise.resolve()
  const put = (value: GhostProgress | null): Promise<unknown> => {
    queue = queue.then(() => (mine === generation ? writeProgress($, value) : undefined)).catch(() => undefined)
    return queue
  }
  // The button stops showing the figure at once, whatever becomes of the write.
  const clear = (): Promise<unknown> => {
    if (mine === generation) live = false
    return put(null)
  }
  // One write per whole percent: the band draws it as text.
  const show = (pct: number): void => {
    if (pct === last) return
    last = pct
    void put({ pct: last, pick, load: LOAD })
  }
  const tick = (): void => {
    if (stopped || pauses > 0 || mine !== generation) return
    activeMs += TICK_MS
    show(Math.max(last, eased(activeMs)))
    // At the cap nothing is left to count: the ticker ends until the job does.
    if (last >= CAP - 1) stopTicker()
  }
  const stopTicker = (): void => {
    try {
      myTick?.cancel()
    } catch {
      // already gone
    }
    if (tickTimer === myTick) tickTimer = undefined
    myTick = undefined
  }
  // One ticker, and only while the figure can move: not before the clock
  // answered, not while a question is open, not after the job ended.
  const startTicker = (): void => {
    if (!hasClock || stopped || pauses > 0 || mine !== generation || myTick !== undefined || last >= CAP - 1) return
    try {
      myTick = $.clock.every(TICK_MS, tick)
      tickTimer = myTick
    } catch {
      myTick = undefined // no timers here: the figure stays where it is until the job ends
    }
  }
  const clockNow = (): Promise<number | undefined> =>
    Promise.resolve()
      .then(() => $.clock.now())
      .catch(() => undefined)

  void put({ pct: 0, pick, load: LOAD })
  // A refused timer never throws and never fires, so ask the clock first.
  void clockNow().then(now => {
    if (now === undefined) return // no clock: the figure stays at 0% until the job ends
    hasClock = true
    startTicker()
  })

  return {
    pause: () => {
      if (stopped) return
      pauses += 1
      stopTicker()
      // A question means the first of two model calls is back: a real
      // milestone. A run below it steps up to it, then stands until the answer.
      show(Math.max(last, ASKED_PCT))
    },
    resume: () => {
      pauses = Math.max(0, pauses - 1)
      if (pauses > 0) return
      // Moving again from the start of the percent that stood (the inverse of
      // the curve): upward from that number, never from below it.
      activeMs = Math.max(activeMs, msFor(last))
      startTicker()
    },
    finish: async ok => {
      if (stopped) return
      stopped = true
      stopTicker()
      if (mine !== generation) return
      if (!ok) {
        await clear()
        return
      }
      const at = await clockNow()
      if (at === undefined) {
        await clear()
        return
      }
      await put({ pct: 100, pick, load: LOAD, at })
      if (mine !== generation) return
      try {
        const timer: Timer = $.clock.after(HOLD_MS, () => {
          if (holdTimer === timer) holdTimer = undefined
          void clear()
        })
        holdTimer = timer
      } catch {
        await clear()
      }
    },
  }
}
