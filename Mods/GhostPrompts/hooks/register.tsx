// Ghost: a button above the prompt box, /ghost and /prompt-master.
// It reads the unsent draft, improves it with one or two model calls, and puts
// the result back in the prompt box for the person to review. It never submits.
// Since 2.0: project tips in the pill and the Ghost Crew pane (/ghost-crew).
// Since 2.1: the row is one tight, left-aligned group, and a figure counts 0%
// to 100% with a short line while a prompt is improved (a simulated figure,
// see progress.ts).
// Since 2.3: while Ghost works a Stop button cancels the run, and the figure
// is shown inside the pill in place of the tips.
// Since 2.4: the ghost is a drawing of its own whose source never changes.
// Since 2.5: the pill is native (a bordered Box with Text in it, pill.ts), so
// nothing blinks at the press, a question, 100% or a stop: no drawing in the
// band ever changes its source. On the desktop the Ghost button is a dropdown
// (Ghost, Show), the Crew button is gone (/ghost-crew opens the pane), and the
// role character stands in the running-step line in place of the app's
// spinner; no character is added to tool rows any more.
// Since 2.5.1: the tips (and a done / error line) run right to left in a
// ticker inside the pill, with glints streaming left to right (ticker.ts); the
// dropdown stands directly right of the pill and has no caption; no page timer.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { GhostView } from '../types'
import { GHOST_BAND_SVG, GHOST_IDLE_SVG, GHOST_SLOT, GHOST_WORKING_SVG, GOLD } from './art'
import { EMPTY_MESSAGE, GHOST_SYSTEM, WORKING_MESSAGE, fence, improve, makeRedactor } from './core'
import type { Completion, GhostQuestion, Improved } from './core'
import {
  CREW_TITLE,
  beginStep,
  crewNow,
  endStep,
  endTurn,
  readCrew,
  stepLines,
  syncBackground,
} from './crew'
import { CREW_SPEC, SPINNER_PX, characterAlt, crewArt, crewSections, spinnerSvg } from './crewart'
import type { CrewRow, Role } from './crewart'
import { DIVIDER, PILL_INK, TIP_ROOM, pillCols, pillWords } from './pill'
import { labelFor, lineFor, progressPick, settleProgress, shownProgress, startProgress } from './progress'
import type { ProgressRun } from './progress'
import { PILL_SPARK_SVG, SPARK, TICKER_EMPTY, tickerSvg } from './ticker'
import type { Ticker } from './ticker'
import { claimTipsStart, loadTips, readTips, setTipsAudience, switchTips, tipsAfterTurn } from './tips'
import type { TipsWork } from './tips'

const PANE = 'ghost'
// The Ghost Crew pane's id, a literal here so the engine's scan reads the matcher.
const CREW = 'ghost-crew'
const MODEL = 'sonnet'
const IDLE: GhostView = { phase: 'idle' }
// Session memory only: the original draft and the result never go to disk.
const view = atom({ plugin: 'ghost', key: 'view' } as const, IDLE, { shape: 'ghost-view-1' })

// The pill's label while Ghost is idle.
const IDLE_WORDS = 'Improve the draft below'
// The least the pill may be squeezed to (character columns) where the band is too narrow for it.
const PILL_MIN_COLS = 24
// The Ghost dropdown of the desktop band: its key and the values of its rows.
// A picker always has one row selected and a pick of that row tells nobody
// (desktop 5.11492.5.0), so the two choices stand under a resting row, and
// every pick puts the picker back on it (the `menu` count: the resting row's
// value changes, so the surface draws the picker anew). It has no `label`: a
// label is drawn as a caption left of the picker, and the picker stands
// directly right of the pill (2.5.1).
const MENU = 'ghost-menu'
const MENU_RUN = 'ghost'
const MENU_SHOW = 'show'
const menu = atom({ plugin: 'ghost', key: 'menu' } as const, 0)
const PLACED = 'Improved prompt is in your prompt box. Review it, then press Enter yourself. Nothing was sent.'
const RESTORED = 'Your original draft is back in the prompt box.'

type Ok = Extract<Improved, { ok: true }>
type Source = 'button' | 'command' | 'pane'
type Outcome =
  | { kind: 'busy' }
  | { kind: 'empty' }
  | { kind: 'failed'; error: string }
  | { kind: 'stopped' }
  | { kind: 'done'; result: Ok; placed: boolean; why: string }

// One improvement at a time. A module variable: a reload starts it over.
let busy = false
// The running improvement's progress figure, for the question dialog to pause.
let figure: ProgressRun | undefined

// The running improvement as the Stop button sees it.
type Job = {
  /** Cuts a model call in flight; absent where the environment has no AbortController. */
  abort: AbortController | undefined
  /** Stop was pressed: nothing more is asked of the model and nothing is placed. */
  isStopped: boolean
  /** The result is going into the prompt box, or is shown: a Stop from here on changes nothing. */
  isSettled: boolean
  /** Ends every wait of the pipeline at once. */
  halt: () => void
  halted: Promise<void>
  /** Resolves when the run has cleaned up after itself. */
  end: () => void
  ended: Promise<void>
}
let job: Job | undefined

const BUSY_MESSAGE = 'Ghost is already improving a prompt. Wait for it to finish.'
const STOPPED = 'Ghost stopped. Your draft is unchanged.'
const STOPPED_REPLY: Completion = { ok: false, error: 'Ghost was stopped' }

function newJob(): Job {
  let abort: AbortController | undefined
  try {
    abort = new AbortController()
  } catch {
    abort = undefined // the flag alone stops the run
  }
  let halt: () => void = () => undefined
  const halted = new Promise<void>(resolve => {
    halt = resolve
  })
  let end: () => void = () => undefined
  const ended = new Promise<void>(resolve => {
    end = resolve
  })
  return { abort, isStopped: false, isSettled: false, halt, halted, end, ended }
}

// "/ghost …", "/prompt-master …", "/ghost-undo", "/ghost-crew", "/ghost-tips …" as typed in the prompt box.
const GHOST_COMMAND = /^\s*\/(ghost|prompt-master|ghost-undo|ghost-crew|ghost-tips)(?=\s|$)([\s\S]*)$/

// What the person last asked for, for the tips request only: likely secrets
// hidden, cut short, session memory, never logged or stored.
let lastTopic = ''

function secretNote(r: Ok): string {
  if (r.secretsHidden === 0) return ''
  const n = r.secretsHidden
  const them = n === 1 ? 'it' : 'them'
  const dropped =
    r.secretsDropped > 0 ? ` ${r.secretsDropped} did not survive the rewrite; add it back if it is needed.` : ''
  return ` Ghost hid ${n} likely secret${n === 1 ? '' : 's'} from the model and put ${them} back; remove ${them} if the AI does not need ${them}.${dropped}`
}

function unansweredNote(r: Ok): string {
  return r.questions.length > r.answered
    ? `\nGhost would have asked: ${r.questions.join(' / ')} (unanswered parts are [PLACEHOLDERS]).`
    : ''
}

// A failure as one line. The reason may end in a period of its own: one period, never two.
function failLine(reason: string): string {
  return `Ghost could not improve the prompt: ${reason.trim().replace(/[.\s]+$/, '')}. Your draft is unchanged.`
}

function setView($: EngineInterface, patch: Partial<GhostView>) {
  return update($, view, v => ({ ...v, ...patch }))
}

function say($: EngineInterface, text: string): string {
  $.ui.toast(text, { timeoutMs: 7000 })
  return text
}

async function completeWith($: EngineInterface, prompt: string, signal?: AbortSignal): Promise<Completion> {
  const r = await $.model.complete(
    {
      model: MODEL,
      system: [{ text: GHOST_SYSTEM, cache: true }],
      prompt,
      maxTokens: 4096,
      timeoutMs: 120_000,
    },
    // The Stop button aborts this signal: the call in flight then ends as `aborted`.
    signal === undefined ? undefined : { signal },
  )
  if (r.isAnswered) return { ok: true, text: r.text }
  if (r.reason === 'api-error') {
    return { ok: false, error: `the model request failed (${r.status ?? 'no status'}, ${String(r.error)})` }
  }
  if (r.reason === 'aborted') return { ok: false, error: 'the model request was stopped or timed out' }
  return { ok: false, error: 'the model sent an empty reply' }
}

async function askWith($: EngineInterface, q: GhostQuestion): Promise<string | undefined> {
  // The figure on the button stands still while the person reads and answers.
  const held = figure
  held?.pause()
  try {
    const question = q.q.endsWith('?') ? q.q : `${q.q}?`
    return await $.ui.ask(question, { options: q.options, header: q.header })
  } catch {
    return undefined // dismissed, or nobody to ask (a -p run)
  } finally {
    held?.resume()
  }
}

// One model call of a run. A stopped run makes no call, and a Stop while the
// call is in flight aborts it and ends the wait at once, whatever becomes of it.
async function completeOrStop($: EngineInterface, mine: Job, prompt: string): Promise<Completion> {
  if (mine.isStopped) return STOPPED_REPLY
  const call = completeWith($, prompt, mine.abort?.signal)
  void call.catch(() => undefined) // a call left behind by a Stop fails in silence
  const r = await Promise.race([call, mine.halted.then(() => STOPPED_REPLY)])
  return mine.isStopped ? STOPPED_REPLY : r
}

// One clarifying question of a run. A stopped run asks nothing; a Stop while
// the dialog is open ends the wait (a mod cannot close the dialog: whatever
// is answered in it afterwards is not used).
async function askOrStop($: EngineInterface, mine: Job, q: GhostQuestion): Promise<string | undefined> {
  if (mine.isStopped) return undefined
  const a = await Promise.race([askWith($, q), mine.halted.then(() => undefined)])
  return mine.isStopped ? undefined : a
}

// The Stop button. It flags the run, cuts its model call and ends its waits;
// the run then cleans up after itself (runGhost) and this waits for that.
// With no run, a run already stopping, or one whose result is already going
// into the prompt box, it does nothing.
async function stopGhost(): Promise<void> {
  const mine = job
  if (mine === undefined || mine.isStopped || mine.isSettled) return
  mine.isStopped = true
  try {
    mine.abort?.abort()
  } catch {
    // the flag and the halt below stop the run
  }
  mine.halt()
  await mine.ended
}

// A stopped run ends here: the band as it was before the press (idle, the
// earlier result still on Show), one short line, nothing placed.
async function settleStopped($: EngineInterface, before: GhostView): Promise<Outcome> {
  try {
    await update($, view, () => ({ phase: 'idle', original: before.original, result: before.result, notes: before.notes }))
  } catch {
    // the band keeps what it shows; Ghost is free again either way
  }
  say($, STOPPED)
  return { kind: 'stopped' }
}

// Puts the result in the prompt box only while the box still holds what Ghost
// started from (the button) or nothing (a command or the pane): never over
// text the person typed meanwhile, and never after a Stop.
async function place(
  $: EngineInterface,
  text: string,
  source: Source,
  original: string,
  mine: Job,
): Promise<{ placed: boolean; why: string }> {
  const box = await $.prompt.read()
  if (mine.isStopped) return { placed: false, why: 'Ghost was stopped' }
  const isOurs = source === 'button' ? box.text === original : box.text.trim() === ''
  if (!isOurs) return { placed: false, why: 'your prompt box changed while Ghost worked' }
  // From here the text goes in: a Stop pressed now is too late and changes nothing.
  mine.isSettled = true
  const filled = await $.prompt.fill({ text, mode: 'replace' })
  if (filled.isFilled) return { placed: true, why: '' }
  if (filled.refusal === 'no_composer') return { placed: false, why: 'this app does not let Ghost write to its prompt box' }
  if (filled.refusal === 'dialog') return { placed: false, why: 'a dialog held the prompt box' }
  return { placed: false, why: 'the prompt box refused the text' }
}

async function runGhost($: EngineInterface, draft: string, source: Source): Promise<Outcome> {
  if (busy) {
    say($, BUSY_MESSAGE)
    return { kind: 'busy' }
  }
  if (draft.trim() === '') {
    say($, EMPTY_MESSAGE)
    return { kind: 'empty' }
  }
  busy = true
  const mine = newJob()
  job = mine
  // What the band held before this run: a stopped run puts it back.
  let before: GhostView = IDLE
  // The figure counts from 0% while this runs; 100% only when a result is
  // ready and shown. The figure is started, never awaited: it cannot hold the work.
  let ready = false
  let run: ProgressRun | undefined
  try {
    before = await read($, view).catch(() => IDLE)
    await update($, view, () => ({ phase: 'working', original: draft, message: WORKING_MESSAGE }))
    $.ui.status(WORKING_MESSAGE)
    try {
      run = startProgress($, draft)
    } catch {
      run = undefined // the pill shows 0% until the job ends
    }
    figure = run
    const r = await improve(draft, {
      complete: prompt => completeOrStop($, mine, prompt),
      ask: q => askOrStop($, mine, q),
    })
    // Checked after every wait of the pipeline: a stopped run places nothing.
    if (mine.isStopped) return await settleStopped($, before)
    if (!r.ok) {
      const error = failLine(r.error)
      await setView($, { phase: 'error', message: error, placed: false, undone: false })
      say($, error)
      return { kind: 'failed', error }
    }
    const spot = await place($, r.prompt, source, draft, mine)
    if (mine.isStopped) return await settleStopped($, before)
    mine.isSettled = true
    const message = spot.placed
      ? PLACED
      : `The improved prompt is in the Ghost pane because ${spot.why}. Nothing was sent or overwritten.`
    await setView($, { phase: 'done', result: r.prompt, notes: r.notes, placed: spot.placed, undone: false, message })
    if (!spot.placed) await $.ui.open({ id: PANE, title: 'Ghost' })
    say($, message + secretNote(r))
    // Only now: a pane that could not open ends in the catch below, a failure.
    ready = true
    return { kind: 'done', result: r, ...spot }
  } catch (err) {
    // A Stop that made a call fail is a stop, not an error.
    if (mine.isStopped && !mine.isSettled) return await settleStopped($, before)
    const error = failLine(err instanceof Error ? err.message : String(err))
    await setView($, { phase: 'error', message: error, placed: false, undone: false })
    say($, error)
    return { kind: 'failed', error }
  } finally {
    // Ghost is free again before the figure's last writes are awaited: they
    // cannot leave it busy. Stops the ticker and its timers either way; a
    // failure or a stop never shows 100%.
    if (figure === run) figure = undefined
    if (job === mine) job = undefined
    busy = false
    try {
      $.ui.status(undefined)
      await run?.finish(ready).catch(() => undefined)
    } finally {
      mine.end()
    }
  }
}

// The Ghost dropdown. The picker goes back to its resting row first, then the
// choice runs: Ghost is the button's press, Show opens the Ghost pane.
async function pickMenu($: EngineInterface, value: string): Promise<void> {
  try {
    await update($, menu, n => (n + 1) % 1000)
  } catch {
    // the picker keeps the picked row until the band next draws
  }
  if (value === MENU_RUN) await pressGhost($)
  else if (value === MENU_SHOW) await openPane($)
}

// The role the running-step line shows: the newest running step, the main
// loop's before a subagent's; none running, the plain ghost. Never throws.
async function runningRole($: EngineInterface): Promise<Role> {
  try {
    const running = (await readCrew($)).filter(s => s.status === 'running')
    const pick = (list: typeof running) => list.reduce<(typeof running)[number] | undefined>((a, s) => (a === undefined || s.startedAt >= a.startedAt ? s : a), undefined)
    return (pick(running.filter(s => s.loop === undefined)) ?? pick(running))?.role ?? 'generic'
  } catch {
    return 'generic'
  }
}

// The button: the draft as it stands in the prompt box.
async function pressGhost($: EngineInterface): Promise<void> {
  // While Ghost works the row has Stop in this button's place; a press that
  // still arrives (a frame drawn before the run began) starts nothing.
  if (busy) {
    say($, BUSY_MESSAGE)
    return
  }
  const box = await $.prompt.read()
  if (box.text.trim() !== '') {
    await runGhost($, box.text, 'button')
    return
  }
  // Empty, or a surface that keeps its prompt box to itself? Appending
  // nothing to an empty box changes nothing and tells the two apart.
  let noBox = false
  try {
    const probe = await $.prompt.fill({ text: '', mode: 'append' })
    noBox = !probe.isFilled && probe.refusal === 'no_composer'
  } catch {
    noBox = false
  }
  if (noBox) {
    await $.ui.open({ id: PANE, title: 'Ghost', focus: true })
    say($, 'This app does not share its prompt box with Ghost. Type or paste your prompt in the Ghost pane.')
    return
  }
  say($, EMPTY_MESSAGE)
}

// Undo: the original draft back in the box. Whatever it replaces (the
// improved prompt, maybe edited) is kept for "Use improved".
async function undo($: EngineInterface): Promise<string> {
  const v = await read($, view)
  if (v.original === undefined) return say($, 'Ghost has no earlier draft to restore in this session.')
  const box = await $.prompt.read()
  const filled = await $.prompt.fill({ text: v.original, mode: 'replace' })
  if (!filled.isFilled) {
    await $.ui.open({ id: PANE, title: 'Ghost' })
    return say($, 'Ghost could not write to the prompt box. Your original draft is shown in the Ghost pane.')
  }
  const kept = box.text.trim() !== '' && box.text !== v.original ? box.text : v.result
  await setView($, { result: kept, placed: false, undone: true, message: RESTORED })
  return say($, RESTORED)
}

// "Put in prompt box" / "Use improved": over the box when it is empty or
// holds Ghost's own texts, after the person's text otherwise; never over it.
async function putResult($: EngineInterface): Promise<void> {
  const v = await read($, view)
  if (v.result === undefined) return
  const box = await $.prompt.read()
  const isOverwritable = box.text.trim() === '' || box.text === v.original || box.text === v.result
  const filled = await $.prompt.fill(
    isOverwritable ? { text: v.result, mode: 'replace' } : { text: `\n\n${v.result}`, mode: 'append' },
  )
  if (!filled.isFilled) {
    say($, 'Ghost could not write to the prompt box here. Copy the prompt from the Ghost pane instead.')
    return
  }
  await setView($, { placed: true, undone: false, message: PLACED })
  say($, isOverwritable ? PLACED : 'Ghost added the improved prompt after your text. Nothing was sent.')
}

async function copyText($: EngineInterface, surface: RenderSurface, text: string): Promise<void> {
  const r = await $.ui.copy({ text, surface })
  say($, r.isCopied ? 'Copied the improved prompt.' : 'Copy is not available here. Select the text in the Ghost pane instead.')
}

function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: 'Ghost' })
}

function closePane($: EngineInterface) {
  return $.ui.close({ id: PANE })
}

async function commandGhost($: EngineInterface, args: string): Promise<{ text: string }> {
  if (args.trim() === '') {
    await openPane($)
    return {
      text: `${EMPTY_MESSAGE} You can also put it after the command (/ghost <your prompt>) or type it in the Ghost pane.`,
    }
  }
  const out = await runGhost($, args, 'command')
  if (out.kind === 'busy') return { text: BUSY_MESSAGE }
  if (out.kind === 'empty') return { text: EMPTY_MESSAGE }
  if (out.kind === 'failed') return { text: out.error }
  if (out.kind === 'stopped') return { text: STOPPED }
  const notes = out.result.notes === '' ? '' : `\nNotes: ${out.result.notes}`
  const extra = unansweredNote(out.result) + secretNote(out.result)
  if (out.placed) {
    return { text: `Ghost: ${PLACED}${notes}${extra}\nUndo: /ghost-undo puts your original back.` }
  }
  return { text: `Ghost: improved prompt (not sent; ${out.why}):\n${fence(out.result.prompt)}${notes}${extra}` }
}

async function commandUndo($: EngineInterface): Promise<{ text: string }> {
  return { text: await undo($) }
}

// ---------------------------------------------------------------- crew, tips

function openCrew($: EngineInterface) {
  return $.ui.open({ id: CREW, title: CREW_TITLE })
}

function closeCrew($: EngineInterface) {
  return $.ui.close({ id: CREW })
}

async function commandCrew($: EngineInterface): Promise<{ text: string }> {
  await openCrew($)
  const steps = await readCrew($).catch(() => [])
  const running = steps.filter(s => s.status === 'running').length
  return { text: `Ghost Crew: ${running} running, ${steps.length - running} finished. The Ghost Crew pane lists them.` }
}

// The work now going on, for the tips request. Never throws.
async function workNow($: EngineInterface): Promise<TipsWork> {
  try {
    return { steps: stepLines(await readCrew($), 6), topic: lastTopic }
  } catch {
    return { steps: [], topic: lastTopic }
  }
}

async function commandTips($: EngineInterface, args: string): Promise<{ text: string }> {
  const word = args.trim().toLowerCase()
  if (word !== 'on' && word !== 'off') return { text: 'Use /ghost-tips on or /ghost-tips off.' }
  return { text: await switchTips($, word === 'on', await workNow($)) }
}

async function startTips($: EngineInterface, cwd: string): Promise<void> {
  await loadTips($, cwd, await workNow($), false)
}

// After the session started, never before the first prompt: a timer, so the
// start hook returns at once. Without a timer the first finished turn loads them.
function scheduleTips($: EngineInterface, cwd: string): void {
  try {
    $.clock.after(1500, () => void startTips($, cwd))
  } catch {
    // no timer here
  }
}

// The desktop app hosts the session through the SDK, where session.start says
// isInteractive: false, so tips never started there. The band being drawn on
// a surface is the real sign that a person can read them: start once, then.
async function tipsOnFirstDraw($: EngineInterface, surface: string): Promise<void> {
  if (surface !== 'desktop' && surface !== 'terminal' && surface !== 'mobile') return
  if (!claimTipsStart()) return
  try {
    setTipsAudience(true)
    scheduleTips($, await $.session.cwd())
  } catch {
    // tips are optional
  }
}

function noteTopic(e: { text: string; isMeta?: true; command?: unknown; origin?: { kind?: string } }): void {
  const kind = e.origin?.kind
  if (e.isMeta === true || e.command !== undefined || e.text.trim().startsWith('/')) return
  if (kind !== 'composer' && kind !== 'bridge' && kind !== 'sdk') return
  lastTopic = makeRedactor()
    .hide(e.text.replace(/\s+/g, ' ').trim().slice(0, 400))
    .replace(/\u27E6GHOST_SECRET_\d+\u27E7/g, '[hidden]')
    .slice(0, 200)
}

async function registerCommands($: EngineInterface): Promise<void> {
  await $.command.register({
    name: 'ghost',
    description: 'Ghost: turn a rough prompt into a precise one (you send it yourself)',
    argumentHint: '<your rough prompt>',
  })
  await $.command.register({
    name: 'prompt-master',
    description: 'Ghost Prompt Master (same as /ghost)',
    argumentHint: '<your rough prompt>',
  })
  await $.command.register({
    name: 'ghost-undo',
    description: 'Ghost: put your original draft back in the prompt box',
  })
  await $.command.register({
    name: 'ghost-crew',
    description: 'Ghost Crew: show the running and finished steps of this session',
  })
  await $.command.register({
    name: 'ghost-tips',
    description: 'Ghost: turn the project tips in the pill on or off',
    argumentHint: 'on|off',
  })
}

// A sent prompt ends Ghost's band message, and a figure nothing stands behind
// any more; the text itself is untouched.
async function settleOnSubmit($: EngineInterface): Promise<void> {
  await settleProgress($)
  const v = await read($, view)
  if (v.phase === 'done' || v.phase === 'error') {
    await update($, view, old => ({ phase: 'idle', original: old.original, result: old.result, notes: old.notes }))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await registerCommands($)
    // Tips need a person to read them: none in a headless run.
    setTipsAudience(e.isInteractive)
    if (e.isInteractive && claimTipsStart()) scheduleTips($, e.cwd)
    return next(e)
  })

  on('command.run', { command: 'ghost' }, ($, e) => commandGhost($, e.args))
  on('command.run', { command: 'prompt-master' }, ($, e) => commandGhost($, e.args))
  on('command.run', { command: 'ghost-undo' }, $ => commandUndo($))
  on('command.run', { command: 'ghost-crew' }, $ => commandCrew($))
  on('command.run', { command: 'ghost-tips' }, ($, e) => commandTips($, e.args))

  on('prompt.submit', async ($, e, next) => {
    // A Ghost command that reached the prompt path instead of the command
    // path (for any reason) is answered here and dropped, so the draft never
    // goes to the model as a request.
    const hit = GHOST_COMMAND.exec(e.text)
    if (hit) {
      const rest = (hit[2] ?? '').replace(/^\s+/, '')
      const out =
        hit[1] === 'ghost-undo'
          ? await commandUndo($)
          : hit[1] === 'ghost-crew'
            ? await commandCrew($)
            : hit[1] === 'ghost-tips'
              ? await commandTips($, rest)
              : await commandGhost($, rest)
      return { drop: out.text }
    }
    // Never in the way of a prompt: a failure here only leaves the band as it was.
    await settleOnSubmit($).catch(() => undefined)
    try {
      noteTopic(e)
    } catch {
      // the tips go without a topic
    }
    return next(e)
  }).catch(($, e, next) =>
    // Fails closed for Ghost's own commands only; every other prompt goes on.
    !next.called && GHOST_COMMAND.test(e.text)
      ? { drop: 'Ghost hit an error, so your prompt was not sent. Try /ghost again.' }
      : next(e),
  )

  // The crew tracker. It only watches: the step is noted before the tool runs
  // and marked after it answered, and the engine's own result is returned as
  // it came. Nothing here denies or rewrites a call; beginStep and endStep
  // never throw, and if this hook fails anyway the call goes on without Ghost.
  on('tool.call', async ($, e, next) => {
    const step = await beginStep($, e)
    const ran = await next(e)
    await endStep($, step, ran, next.signal?.aborted === true)
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await endTurn($, e.agentId, e.reason)
    // Not awaited: a tips refresh (one small model call) never holds a turn's end.
    if (e.agentId === undefined) void tipsAfterTurn($, await workNow($))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Stop', async ($, e, next) => {
    await syncBackground($, e.background_tasks)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The desktop's Ghost dropdown: a pick is the press (Ghost) or opens the
  // pane (Show). Like the press, the long work runs on the pick's own `$`.
  on('ui.select', { element: 'ghost-menu' }, async ($, e) => {
    await pickMenu($, e.value)
    return { element: e.element, value: e.value }
  })
  // The long work of the Ghost button and the pane field runs here, on the
  // press's own `$`: its model and dialog calls then stop the hook's 10 s
  // clock, which a `$` captured while drawing does not. Answered here, the
  // elements' own onPress / onSubmit (no-ops) never run.
  on('ui.press', { element: 'ghost' }, async ($, e) => {
    await pressGhost($)
    return { element: e.element }
  })
  // Stop, in the Ghost button's place while a run is on: it cancels the run.
  on('ui.press', { element: 'stop' }, async (_, e) => {
    await stopGhost()
    return { element: e.element }
  })
  on('ui.input', { element: 'draft' }, async ($, e, next) => {
    if (e.kind !== 'submit') return next(e)
    await runGhost($, e.value, 'pane')
    return { element: e.element, value: e.value }
  })

  // The band directly above the prompt box: the ghost, the pill, the Ghost
  // control (a dropdown on the desktop, a button elsewhere) or Stop while a run
  // is on, then Undo / Use improved when they apply.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    await tipsOnFirstDraw($, e.surface)
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    // Vector art on surfaces that draw Svg (desktop, mobile, editor); the
    // terminal has none (an Svg there draws as an empty box) and shows the
    // gold button and the words as text.
    const Svg = 'Svg' in els && e.surface !== 'terminal' ? els.Svg : undefined
    const v = await read($, view)
    const isWorking = v.phase === 'working'
    const isDone = v.phase === 'done'
    // The figure: while Ghost works (0% from the press on, before the first
    // write lands), and for the 100% hold once the result is shown. A stopped
    // or failed run shows none: its view is idle or an error by then.
    const figureNow = await shownProgress($)
    const hasFigure = isWorking || (isDone && figureNow !== null)
    // A 100% still held from the run before is not this run's figure.
    const isMine = figureNow !== null && !(isWorking && figureNow.pct >= 100)
    const pct = isMine ? figureNow.pct : 0
    const pick = isMine ? figureNow.pick : progressPick(v.original ?? '')
    const words = hasFigure ? WORKING_MESSAGE : v.phase === 'idle' ? IDLE_WORDS : (v.message ?? '')
    // The pill: a Box with a round gold rim and the charcoal fill. Its label
    // and the figure (every percent) are native Text, so the press, a
    // question and 100% load no frame: no blink. The small sparkle strip at
    // its left is the same bytes in every phase. While Ghost is idle, or shows
    // a done / error line, the rest of the pill is the ticker (ticker.ts): the
    // tips or the line running right to left without end, glints streaming
    // left to right. Its source depends on the text and the pill's width only,
    // so it is the same bytes at every redraw; while Ghost works it is not
    // drawn (the figure stands there as Text), and it is drawn again, one
    // frame, when the run ends or is stopped. The Box has one width (character
    // columns) in every phase, so the row never shifts. No timer here.
    let label = ''
    let figure = ''
    let line = ''
    let ticker: Ticker | undefined
    const cols = Svg ? pillCols(e.props.bodyColumns) : 0
    if (Svg) {
      if (hasFigure) {
        label = pillWords(cols, WORKING_MESSAGE).label
        figure = `${pct}%`
        line = lineFor(pct, pick)
      } else if (v.phase === 'idle') {
        // With no tips the label has the pill to itself, glints beside it.
        const tips = (await readTips($)).tips
        const fit = pillWords(cols, IDLE_WORDS, tips.length > 0 ? TIP_ROOM : 0)
        label = fit.label
        ticker = tips.length > 0 ? tickerSvg(tips, fit.room) : TICKER_EMPTY
      } else {
        const fit = pillWords(cols, '')
        label = fit.label
        const message = (v.message ?? '').trim()
        ticker = message === '' ? TICKER_EMPTY : tickerSvg([message], fit.room)
      }
    }
    const hasWords = figure !== '' || line !== '' || (ticker !== undefined && ticker !== TICKER_EMPTY)
    const pill = Svg ? (
      <Box
        flexDirection="row"
        alignItems="center"
        columnGap={1}
        width={cols}
        minWidth={PILL_MIN_COLS}
        flexShrink={1}
        paddingX={1}
        paddingY={0}
        borderStyle="round"
        borderColor={PILL_INK.rim}
        backgroundColor={PILL_INK.fill}
        overflow="hidden"
      >
        <Svg source={PILL_SPARK_SVG} alt="Ghost sparkles" isInteractive width={SPARK.width} height={SPARK.height} />
        <Text bold color={PILL_INK.text}>
          {label}
        </Text>
        {hasWords ? <Text color={PILL_INK.rim}>{DIVIDER}</Text> : null}
        {figure !== '' ? (
          <Text bold color={PILL_INK.rim}>
            {figure}
          </Text>
        ) : null}
        {line !== '' ? <Text color={PILL_INK.text}>{line}</Text> : null}
        {ticker !== undefined ? (
          // The ticker's window: it starts one column wide and grows into all
          // the room the pill has left, and cuts the frame to it. No Box here
          // is positioned.
          <Box flexDirection="row" alignItems="center" width={1} minWidth={0} flexGrow={1} flexShrink={1} overflow="hidden">
            <Svg source={ticker.source} alt={ticker.alt} isInteractive width={ticker.width} height={ticker.height} />
          </Box>
        ) : null}
      </Box>
    ) : null
    // A terminal has no pill: it shows the figure, every percent, as the dim
    // text beside the button.
    const beside = hasFigure ? labelFor(pct, pick) : words
    const ghostLabel = 'Ghost'
    // The terminal draws the Text child: ink on gold. A desktop draws its own
    // native button and the label only, never the child's colours.
    const ghostText = (
      <Text color={GOLD.ink} backgroundColor={GOLD.button} bold>
        {` ${ghostLabel} `}
      </Text>
    )
    // The desktop's Ghost control is the app's own dropdown: a resting row,
    // and under it the two choices, Ghost (improve the draft, the same path
    // as the button's press) and Show (open the Ghost pane). No caption: its
    // name for a screen reader is its key (the surface's own fallback). Every
    // other surface keeps the Ghost button, and Show beside it once there is
    // a result (a mobile app may draw no Select at all).
    const Select = e.surface === 'desktop' && 'Select' in els ? els.Select : undefined
    const rest = Select ? `rest${await read($, menu).catch(() => 0)}` : ''
    const ghostControl = Select ? (
      <Select
        key="ghost-menu"
        value={rest}
        options={[
          { value: rest, label: 'Menu' },
          { value: MENU_RUN, label: 'Ghost' },
          { value: MENU_SHOW, label: 'Show' },
        ]}
        onSelect={() => undefined}
      />
    ) : (
      <Button key="ghost" label={ghostLabel} onPress={() => undefined}>
        {ghostText}
      </Button>
    )
    // The ghost in its own drawing: its source never changes.
    const mascot = Svg ? <Svg source={GHOST_BAND_SVG} alt="Ghost" isInteractive width={GHOST_SLOT.width} height={GHOST_SLOT.height} /> : null
    // One tight row from the left, its parts centred on one line: the ghost,
    // the pill, the Ghost control directly right of the pill (Stop in its
    // place while a run is on), then the other buttons. On a desktop the row
    // never wraps (the pill gives way instead), so the dropdown can never
    // fall under the pill. `overflow` is here so a desktop draws the row as
    // written; a row Box with layout props only has its trailing Buttons
    // moved to the far edge. That is how desktop 5.11492.5.0 behaves, not a
    // rule the API states: a desktop update may change it. No Box here is
    // positioned: the desktop draws nothing of an absolutely placed Box in
    // the band (2.4.0 lost the pill that way).
    return (
      <Box flexDirection="row" flexWrap={Select ? 'nowrap' : 'wrap'} columnGap={1} alignItems="center" justifyContent="flex-start" overflow="visible">
        {mascot}
        {pill}
        {isWorking ? <Button key="stop" label="Stop" onPress={() => undefined} /> : ghostControl}
        {isDone && v.placed ? <Button key="undo" label="Undo" onPress={() => undo($)} /> : null}
        {isDone && v.undone && v.result !== undefined ? (
          <Button key="redo" label="Use improved" onPress={() => putResult($)} />
        ) : null}
        {!Select && !isWorking && v.result !== undefined ? <Button key="show" label="Show" onPress={() => openPane($)} /> : null}
        {Svg ? null : <Text dimColor>{beside}</Text>}
      </Box>
    )
  })

  // The Ghost pane: the result for review, recovery, and a field for surfaces
  // whose prompt box Ghost cannot read.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Code, Input, Text } = els
    const Svg = 'Svg' in els && e.surface !== 'terminal' ? els.Svg : undefined
    const v = await read($, view)
    const isWorking = v.phase === 'working'
    const result = v.result
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" columnGap={1} alignItems="center">
          {Svg ? <Svg source={GHOST_IDLE_SVG} alt="Ghost" isInteractive width={30} height={28} /> : null}
          <Text bold color={GOLD.brass}>
            Ghost
          </Text>
        </Box>
        {isWorking ? (
          <Box flexDirection="column">
            {Svg ? <Svg source={GHOST_WORKING_SVG} alt="Ghost at work" isInteractive height={32} /> : null}
            <Text>{WORKING_MESSAGE}</Text>
          </Box>
        ) : null}
        {v.phase === 'error' && v.message !== undefined ? <Text color="error">{v.message}</Text> : null}
        {result !== undefined && !isWorking ? (
          <Box flexDirection="column" gap={1}>
            <Text dimColor>{v.placed ? 'In your prompt box (not sent):' : 'Improved prompt (not sent):'}</Text>
            <Code source={result} language="markdown" wrap="wrap" />
            {v.notes ? <Text dimColor>Notes: {v.notes}</Text> : null}
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              <Button key="put" variant="primary" label="Put in prompt box" onPress={() => putResult($)} />
              <Button key="copy" label="Copy" onPress={press => copyText($, press.surface, result)} />
              <Button key="restore" label="Restore original" onPress={() => undo($)} />
            </Box>
          </Box>
        ) : null}
        {v.original !== undefined && !isWorking ? (
          <Box flexDirection="column">
            <Text dimColor>Your original draft:</Text>
            <Code source={v.original} wrap="wrap" />
          </Box>
        ) : null}
        {!isWorking ? (
          <Input
            key="draft"
            label="Prompt for Ghost"
            placeholder="Type or paste a rough prompt, then press Enter"
            rows={4}
            submitLabel="Improve"
            onSubmit={() => undefined}
          />
        ) : null}
        <Button key="close" role="dismiss" label="Close" onPress={() => closePane($)} />
      </Box>
    )
  })

  // The Ghost Crew pane: the session's steps, running and finished, each with
  // its role character. It reads the tracker's list and writes nothing.
  on('ui.render', { component: 'Pane', requestId: CREW }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const Svg = 'Svg' in els && e.surface !== 'terminal' ? els.Svg : undefined
    const steps = await readCrew($)
    const now = await crewNow($)
    const isWidget = e.props.placement === 'widget'
    // At most 6 characters move at once (3 in the small widget seat); the
    // other running steps are still poses, finished ones always are.
    const sections = crewSections(steps, now, {
      animated: isWidget ? CREW_SPEC.widgetAnimatedRows : CREW_SPEC.animatedRows,
    })
    const count = `${sections.running.length + sections.moreRunning} running, ${sections.finished.length + sections.moreFinished} finished`
    const mark = (row: CrewRow) => {
      const art = crewArt(row.role, row.pose, e.surface, CREW_SPEC.paneCharacterPx, !row.animated)
      if (art.kind === 'svg' && Svg) {
        return art.isInteractive ? (
          <Svg source={art.source} alt={art.alt} width={art.width} height={art.height} isInteractive />
        ) : (
          <Svg source={art.source} alt={art.alt} width={art.width} height={art.height} />
        )
      }
      const glyph = art.kind === 'glyph' ? art.text : '.'
      const tone = art.kind === 'glyph' ? art.tone : 'dim'
      return (
        <Text color={tone === 'copper' ? '#A0694A' : GOLD.brass} dimColor={tone === 'dim'}>
          {glyph}
        </Text>
      )
    }
    const line = (row: CrewRow) => (
      <Box flexDirection="row" columnGap={1} alignItems="center">
        {mark(row)}
        <Text wrap="truncate-end" dimColor={row.pose !== 'running'}>
          {row.label}
        </Text>
        <Text dimColor>{`${row.tool.startsWith('mcp__') ? 'MCP' : row.tool} ${row.time}`}</Text>
        {row.pose === 'failed' ? <Text color="error">{row.status}</Text> : <Text dimColor>{row.status}</Text>}
      </Box>
    )
    if (isWidget) {
      const lead = sections.running[0]
      return (
        <Box flexDirection="row" columnGap={1} alignItems="center">
          {lead ? mark(lead) : null}
          <Text>{`Crew: ${count}`}</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" columnGap={1} alignItems="center">
          {Svg ? <Svg source={GHOST_IDLE_SVG} alt="Ghost" width={30} height={28} /> : null}
          <Text bold color={GOLD.brass}>
            Ghost Crew
          </Text>
          <Text dimColor>{count}</Text>
        </Box>
        <Box flexDirection="column">
          <Text bold>{`Running (${sections.running.length + sections.moreRunning})`}</Text>
          {sections.running.length === 0 ? <Text dimColor>Nothing is running.</Text> : sections.running.map(line)}
          {sections.moreRunning > 0 ? <Text dimColor>{`+${sections.moreRunning} more running`}</Text> : null}
        </Box>
        <Box flexDirection="column">
          <Text bold>{`Finished (${sections.finished.length + sections.moreFinished})`}</Text>
          {sections.finished.length === 0 ? <Text dimColor>No finished steps yet.</Text> : sections.finished.map(line)}
          {sections.moreFinished > 0 ? <Text dimColor>{`+${sections.moreFinished} more finished`}</Text> : null}
        </Box>
        <Button key="crew-close" role="dismiss" label="Close" onPress={() => closeCrew($)} />
      </Box>
    )
  })

  // The desktop's running-step line ("Creating notes.md... 1m 9s", the row
  // that carries the turn's mark): the role character of the step now running
  // stands in the place of the app's own animated mark, the line's words
  // beside it. A hook that answers a tree here draws in place of the whole
  // line, so the app draws neither its mark nor its elapsed time beside it
  // (desktop 5.11492.5.0). One source per role, so the character's frame is
  // loaded again only when the role changes. Other surfaces, and any trouble
  // here, keep the app's own line.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    try {
      const els = $.ui.resolve(e)
      if (!('Svg' in els)) return next(e)
      const { Box, Svg, Text } = els
      const role = await runningRole($)
      const said = e.props.message ?? e.props.word
      const words = /(\u2026|\.\.\.)$/.test(said) ? said : said + e.props.suffix
      return (
        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Svg source={spinnerSvg(role)} alt={characterAlt(role, 'running')} width={SPINNER_PX} height={SPINNER_PX} isInteractive />
          <Text>{words}</Text>
        </Box>
      )
    } catch {
      return next(e)
    }
  })
}
