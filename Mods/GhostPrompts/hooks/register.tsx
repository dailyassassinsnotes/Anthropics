// Ghost: a button above the prompt box, /ghost and /prompt-master.
// It reads the unsent draft, improves it with one or two model calls, and puts
// the result back in the prompt box for the person to review. It never submits.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { GhostView } from '../types'
import { GHOST_IDLE_SVG, GHOST_WORKING_SVG, GOLD } from './art'
import { EMPTY_MESSAGE, GHOST_SYSTEM, WORKING_MESSAGE, fence, improve } from './core'
import type { Completion, GhostQuestion, Improved } from './core'

const PANE = 'ghost'
const MODEL = 'sonnet'
const IDLE: GhostView = { phase: 'idle' }
// Session memory only: the original draft and the result never go to disk.
const view = atom({ plugin: 'ghost', key: 'view' } as const, IDLE, { shape: 'ghost-view-1' })

const PLACED = 'Improved prompt is in your prompt box. Review it, then press Enter yourself. Nothing was sent.'
const RESTORED = 'Your original draft is back in the prompt box.'

type Ok = Extract<Improved, { ok: true }>
type Source = 'button' | 'command' | 'pane'
type Outcome =
  | { kind: 'busy' }
  | { kind: 'empty' }
  | { kind: 'failed'; error: string }
  | { kind: 'done'; result: Ok; placed: boolean; why: string }

// One improvement at a time. A module variable: a reload starts it over.
let busy = false

// "/ghost …", "/prompt-master …", "/ghost-undo" as typed in the prompt box.
const GHOST_COMMAND = /^\s*\/(ghost|prompt-master|ghost-undo)(?=\s|$)([\s\S]*)$/

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

function setView($: EngineInterface, patch: Partial<GhostView>) {
  return update($, view, v => ({ ...v, ...patch }))
}

function say($: EngineInterface, text: string): string {
  $.ui.toast(text, { timeoutMs: 7000 })
  return text
}

async function completeWith($: EngineInterface, prompt: string): Promise<Completion> {
  const r = await $.model.complete({
    model: MODEL,
    system: [{ text: GHOST_SYSTEM, cache: true }],
    prompt,
    maxTokens: 4096,
    timeoutMs: 120_000,
  })
  if (r.isAnswered) return { ok: true, text: r.text }
  if (r.reason === 'api-error') {
    return { ok: false, error: `the model request failed (${r.status ?? 'no status'}, ${String(r.error)})` }
  }
  if (r.reason === 'aborted') return { ok: false, error: 'the model request was stopped or timed out' }
  return { ok: false, error: 'the model sent an empty reply' }
}

async function askWith($: EngineInterface, q: GhostQuestion): Promise<string | undefined> {
  try {
    const question = q.q.endsWith('?') ? q.q : `${q.q}?`
    return await $.ui.ask(question, { options: q.options, header: q.header })
  } catch {
    return undefined // dismissed, or nobody to ask (a -p run)
  }
}

// Puts the result in the prompt box only while the box still holds what Ghost
// started from (the button) or nothing (a command or the pane): never over
// text the person typed meanwhile.
async function place(
  $: EngineInterface,
  text: string,
  source: Source,
  original: string,
): Promise<{ placed: boolean; why: string }> {
  const box = await $.prompt.read()
  const isOurs = source === 'button' ? box.text === original : box.text.trim() === ''
  if (!isOurs) return { placed: false, why: 'your prompt box changed while Ghost worked' }
  const filled = await $.prompt.fill({ text, mode: 'replace' })
  if (filled.isFilled) return { placed: true, why: '' }
  if (filled.refusal === 'no_composer') return { placed: false, why: 'this app does not let Ghost write to its prompt box' }
  if (filled.refusal === 'dialog') return { placed: false, why: 'a dialog held the prompt box' }
  return { placed: false, why: 'the prompt box refused the text' }
}

async function runGhost($: EngineInterface, draft: string, source: Source): Promise<Outcome> {
  if (busy) {
    say($, 'Ghost is already improving a prompt. Wait for it to finish.')
    return { kind: 'busy' }
  }
  if (draft.trim() === '') {
    say($, EMPTY_MESSAGE)
    return { kind: 'empty' }
  }
  busy = true
  await update($, view, () => ({ phase: 'working', original: draft, message: WORKING_MESSAGE }))
  $.ui.status(WORKING_MESSAGE)
  try {
    const r = await improve(draft, {
      complete: prompt => completeWith($, prompt),
      ask: q => askWith($, q),
    })
    if (!r.ok) {
      const error = `Ghost could not improve the prompt: ${r.error}. Your draft is unchanged.`
      await setView($, { phase: 'error', message: error, placed: false, undone: false })
      say($, error)
      return { kind: 'failed', error }
    }
    const spot = await place($, r.prompt, source, draft)
    const message = spot.placed
      ? PLACED
      : `The improved prompt is in the Ghost pane because ${spot.why}. Nothing was sent or overwritten.`
    await setView($, { phase: 'done', result: r.prompt, notes: r.notes, placed: spot.placed, undone: false, message })
    if (!spot.placed) await $.ui.open({ id: PANE, title: 'Ghost' })
    say($, message + secretNote(r))
    return { kind: 'done', result: r, ...spot }
  } catch (err) {
    const error = `Ghost could not improve the prompt: ${err instanceof Error ? err.message : String(err)}. Your draft is unchanged.`
    await setView($, { phase: 'error', message: error, placed: false, undone: false })
    say($, error)
    return { kind: 'failed', error }
  } finally {
    busy = false
    $.ui.status(undefined)
  }
}

// The button: the draft as it stands in the prompt box.
async function pressGhost($: EngineInterface): Promise<void> {
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
  if (out.kind === 'busy') return { text: 'Ghost is already improving a prompt. Wait for it to finish.' }
  if (out.kind === 'empty') return { text: EMPTY_MESSAGE }
  if (out.kind === 'failed') return { text: out.error }
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
}

// A sent prompt ends Ghost's band message; the text itself is untouched.
async function settleOnSubmit($: EngineInterface): Promise<void> {
  const v = await read($, view)
  if (v.phase === 'done' || v.phase === 'error') {
    await update($, view, old => ({ phase: 'idle', original: old.original, result: old.result, notes: old.notes }))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await registerCommands($)
    return next(e)
  })

  on('command.run', { command: 'ghost' }, ($, e) => commandGhost($, e.args))
  on('command.run', { command: 'prompt-master' }, ($, e) => commandGhost($, e.args))
  on('command.run', { command: 'ghost-undo' }, $ => commandUndo($))

  on('prompt.submit', async ($, e, next) => {
    // A Ghost command that reached the prompt path instead of the command
    // path (for any reason) is answered here and dropped, so the draft never
    // goes to the model as a request.
    const hit = GHOST_COMMAND.exec(e.text)
    if (hit) {
      const out = hit[1] === 'ghost-undo' ? await commandUndo($) : await commandGhost($, (hit[2] ?? '').replace(/^\s+/, ''))
      return { drop: out.text }
    }
    // Never in the way of a prompt: a failure here only leaves the band as it was.
    await settleOnSubmit($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) =>
    // Fails closed for Ghost's own commands only; every other prompt goes on.
    !next.called && GHOST_COMMAND.test(e.text)
      ? { drop: 'Ghost hit an error, so your prompt was not sent. Try /ghost again.' }
      : next(e),
  )

  // The long work of the Ghost button and the pane field runs here, on the
  // press's own `$`: its model and dialog calls then stop the hook's 10 s
  // clock, which a `$` captured while drawing does not. Answered here, the
  // elements' own onPress / onSubmit (no-ops) never run.
  on('ui.press', { element: 'ghost' }, async ($, e) => {
    await pressGhost($)
    return { element: e.element }
  })
  on('ui.input', { element: 'draft' }, async ($, e, next) => {
    if (e.kind !== 'submit') return next(e)
    await runGhost($, e.value, 'pane')
    return { element: e.element, value: e.value }
  })

  // The Ghost button, in the band directly above the prompt box.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    // Vector art on surfaces that draw Svg (desktop, mobile, editor); the
    // terminal has none and shows the gold button alone.
    const Svg = 'Svg' in els ? els.Svg : undefined
    const v = await read($, view)
    if (v.phase === 'working') {
      return (
        <Box flexDirection="row" columnGap={1} alignItems="center">
          {Svg ? <Svg source={GHOST_WORKING_SVG} alt="Ghost at work" isInteractive height={32} /> : null}
          <Text dimColor>{WORKING_MESSAGE}</Text>
        </Box>
      )
    }
    const isDone = v.phase === 'done'
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
        {Svg ? <Svg source={GHOST_IDLE_SVG} alt="Ghost" isInteractive width={30} height={28} /> : null}
        <Button key="ghost" label="Ghost" onPress={() => undefined}>
          <Text color={GOLD.ink} backgroundColor={GOLD.button} bold>
            {' Ghost '}
          </Text>
        </Button>
        {isDone && v.placed ? <Button key="undo" label="Undo" onPress={() => undo($)} /> : null}
        {isDone && v.undone && v.result !== undefined ? (
          <Button key="redo" label="Use improved" onPress={() => putResult($)} />
        ) : null}
        {v.result !== undefined ? <Button key="show" label="Show" onPress={() => openPane($)} /> : null}
        <Text dimColor>{v.phase === 'idle' ? 'Improve the draft below' : (v.message ?? '')}</Text>
      </Box>
    )
  })

  // The Ghost pane: the result for review, recovery, and a field for surfaces
  // whose prompt box Ghost cannot read.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Code, Input, Text } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
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
}
