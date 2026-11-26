// Ghost 2.3: the Stop button in the Ghost control's place while a run is on.
// (The 2.3 / 2.3.1 tests of the Svg ticker and of the pill counting by CSS
// went with that drawing in 2.5: the pill is native, see ghost25.test.tsx.)

import { expect, mock, test } from 'claude-code/testing'

import { ASKED_PCT, HOLD_MS, TICK_MS, eased, labelFor, progressPick } from '../hooks/progress'
import { flat, ghostLabel, go, hasGhost, pillNow, timed } from './band'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const answered = (text: string) => ({ value: { isAnswered: true as const, text, usage: USAGE } })
const STOPPED = 'Ghost stopped. Your draft is unchanged.'
const IDLE = 'Improve the draft below'

const band = (surface: 'terminal' | 'desktop', bodyColumns = 120) =>
  ({
    plugin: 'ghost',
    surface,
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns,
      scroll: { offset: 0, bodyRows: 9 },
      view: {},
    },
  }) as const

const ghostPane = (surface: 'terminal' | 'desktop') =>
  ({
    plugin: 'ghost',
    surface,
    component: 'Pane',
    requestId: 'ghost',
    props: {
      title: 'Ghost',
      isFocused: false,
      bodyColumns: 60,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  }) as const

function gate<T = void>() {
  let open: (value: T) => void = () => undefined
  const wait = new Promise<T>(resolve => {
    open = resolve
  })
  return { wait, open }
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const node = (value: unknown): Node => (typeof value === 'object' && value !== null ? (value as Node) : {})
const FIGURE = /^\d+% \S/
/** The figure a desktop shows: the pill's percent and line, native Text; undefined when none shows. */
const watched = (ui: { drawn: () => Promise<unknown> }) => async () => {
  const pill = await pillNow(ui)
  return pill.figure === '' ? undefined : pill.figure
}
const progressWrites = (sets: { key?: unknown; value?: unknown }[]) =>
  sets.filter(e => e.key === 'progress').map(e => e.value as { pct: number } | null)
// ------------------------------------------------------------------ Stop

type Bench = {
  box: string
  fills: string[]
  toasts: string[]
  statuses: (string | undefined)[]
  submitted: string[]
  sets: { key?: unknown; value?: unknown }[]
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`${surface}: Stop cancels the run: no fill, no 100%, idle again, one line, timers gone, the model call aborted`, async ($, on) => {
    const clock = timed(mock.clock(on, { now: 1_000_000 }))
    const draft = 'make me a website for my bakery'
    const pick = progressPick(draft)
    const reply = gate()
    const b: Bench = { box: draft, fills: [], toasts: [], statuses: [], submitted: [], sets: [] }
    let completions = 0
    let callSignal: AbortSignal | undefined
    let callEnded = false
    on('prompt.read', () => ({ value: { text: b.box, cursor: b.box.length } }))
    on('prompt.fill', (_, e) => {
      b.fills.push(e.text)
      b.box = e.text
      return { isFilled: true }
    })
    on('prompt.submit', (_, e) => {
      b.submitted.push(e.text)
      return { text: e.text }
    })
    on('ui.toast', (_, e) => {
      b.toasts.push(e.text)
      return { value: undefined }
    })
    on('ui.status', (_, e) => {
      b.statuses.push((e as { text?: string }).text)
      return { value: undefined }
    })
    on('state.set', (_, e, next) => {
      b.sets.push(e)
      return next(e)
    })
    on('model.complete', async (_, _e, next) => {
      completions += 1
      callSignal = next.signal
      await reply.wait
      callEnded = true
      return answered('<prompt>Role: web designer</prompt><notes>n</notes>')
    })

    const ui = await $.ui.mount(band(surface))
    const has = async (key: string) => (await ui.findAll({ type: 'Button', key })).length
    const kids = async () => (node(await ui.drawn()).children ?? []).map(node)
    const dim = async () => flat((await kids()).find(k => k.type === 'Text' && k.props?.['dimColor'] === true))
    const figure = watched(ui)
    expect([await hasGhost(ui), await has('stop')]).toEqual([1, 0])

    const pressed = go(ui)
    await clock.settle()
    if (surface === 'desktop') expect(await figure()).toBe(labelFor(0, pick))
    await clock.advance(5000)
    expect([await hasGhost(ui), await has('stop')]).toEqual([0, 1])
    expect((await ui.find({ type: 'Button', key: 'stop' }))?.props['label']).toBe('Stop')
    if (surface === 'desktop') {
      expect(await figure()).toBe(labelFor(eased(5000), pick))
      expect(await figure()).toBe(labelFor(39, pick)) // every percent, not a step of 5
    } else {
      // No pill in a terminal: Stop, and the figure as the dim text, every percent.
      expect((await kids()).map(k => `${k.type}:${String(k.props?.['key'] ?? '')}`)).toEqual(['Button:stop', 'Text:'])
      expect(await dim()).toBe(labelFor(39, pick))
    }
    expect(completions).toBe(1)

    await ui.press({ key: 'stop' })
    await pressed // the press that started the run ends too
    expect(b.fills).toEqual([])
    expect(b.box).toBe(draft)
    expect(b.toasts).toEqual([STOPPED])
    expect(b.statuses.at(-1)).toBe(undefined)
    expect([await hasGhost(ui), await has('stop')]).toEqual([1, 0])
    expect(await ghostLabel(ui)).toBe('Ghost')
    if (surface === 'desktop') {
      expect(await figure()).toBe(undefined)
      expect((await pillNow(ui)).label).toBe(IDLE)
    } else {
      expect((await kids()).map(k => `${k.type}:${String(k.props?.['key'] ?? '')}`)).toEqual(['Button:ghost', 'Text:'])
      expect(await dim()).toBe(IDLE)
    }
    // No 100%, the figure cleared, and the model call was cut by the signal.
    const figures = progressWrites(b.sets)
    expect(figures.some(f => f?.pct === 100)).toBe(false)
    expect(figures.at(-1)).toBe(null)
    expect(callSignal?.aborted).toBe(true)
    expect(callEnded).toBe(false)

    // Every timer is gone: nothing is written afterwards, and the late reply is dropped.
    const before = b.sets.length
    await clock.advance(60_000)
    expect(b.sets.length).toBe(before)
    reply.open()
    await clock.advance(HOLD_MS + 1000)
    expect(b.fills).toEqual([])
    expect(b.box).toBe(draft)
    expect(b.toasts).toEqual([STOPPED])
    expect(progressWrites(b.sets).some(f => f?.pct === 100)).toBe(false)
    expect([await hasGhost(ui), await has('stop')]).toEqual([1, 0])
    expect(b.submitted).toEqual([])
    await ui.unmount()
  })
}

test('desktop: a Stop right after the press stops the run before a model call is used, and a run after it is a fresh one', async ($, on) => {
  const clock = timed(mock.clock(on))
  let box = 'draft one'
  const fills: string[] = []
  const toasts: string[] = []
  const sets: { key?: unknown; value?: unknown }[] = []
  let hold = gate()
  let completions = 0
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    box = e.text
    return { isFilled: true }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('state.set', (_, e, next) => {
    sets.push(e)
    return next(e)
  })
  on('model.complete', async () => {
    completions += 1
    await hold.wait
    return answered(`<prompt>better ${completions}</prompt>`)
  })
  const ui = await $.ui.mount(band('desktop'))
  const has = async (key: string) => (await ui.findAll({ type: 'Button', key })).length
  const figure = watched(ui)

  const first = go(ui)
  await clock.settle() // the Stop button is drawn: 0%
  expect(await figure()).toBe(labelFor(0, progressPick('draft one')))
  await ui.press({ key: 'stop' })
  await first
  expect(fills).toEqual([])
  expect(toasts).toEqual([STOPPED])
  expect(progressWrites(sets).some(f => f?.pct === 100)).toBe(false)
  expect([await hasGhost(ui), await has('stop')]).toEqual([1, 0])

  // A new press right after the stop: a fresh run from 0%, with its own model call, to the end.
  const calls = completions
  hold = gate()
  const second = go(ui)
  await clock.settle()
  expect([await hasGhost(ui), await has('stop')]).toEqual([0, 1])
  expect(await figure()).toBe(labelFor(0, progressPick('draft one')))
  await clock.advance(10_000)
  expect(await figure()).toBe(labelFor(61, progressPick('draft one')))
  expect(completions).toBe(calls + 1)
  hold.open()
  await second
  expect(fills.length).toBe(1)
  expect(box).toBe(fills[0])
  expect(await figure()).toBe(labelFor(100, progressPick('draft one')))
  expect(toasts.length).toBe(2)
  expect(toasts[1]?.includes('Nothing was sent')).toBe(true)
  await clock.advance(HOLD_MS)
  // After the hold: the pill's own done message, the Ghost button, no figure.
  expect(await figure()).toBe(undefined)
  expect([await hasGhost(ui), await has('stop')]).toEqual([1, 0])
  await ui.unmount()
})

test('desktop: Stop while a clarifying question is open ends the run: no second model call, the late answer is not used', async ($, on) => {
  const clock = timed(mock.clock(on))
  const answer = gate<string>()
  let completions = 0
  const fills: string[] = []
  const toasts: string[] = []
  const sets: { key?: unknown; value?: unknown }[] = []
  on('prompt.read', () => ({ value: { text: 'make a site', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('state.set', (_, e, next) => {
    sets.push(e)
    return next(e)
  })
  on('model.complete', () => {
    completions += 1
    if (completions === 1) return answered('<questions>[{"q":"Who is it for?","header":"Audience","options":["Kids","Adults"]}]</questions>')
    return answered('<prompt>better</prompt>')
  })
  on('tool.call', { tool: 'AskUserQuestion' }, async (_, e) => {
    const picked = await answer.wait
    return { result: { questions: e.questions, answers: { 'Who is it for?': picked } } }
  })
  const ui = await $.ui.mount(band('desktop'))
  const has = async (key: string) => (await ui.findAll({ type: 'Button', key })).length
  const figure = watched(ui)
  const pressed = go(ui)
  await clock.settle()
  expect(await figure()).toBe(labelFor(ASKED_PCT, progressPick('make a site')))
  expect(await has('stop')).toBe(1)

  await ui.press({ key: 'stop' })
  await pressed
  expect(completions).toBe(1)
  expect(fills).toEqual([])
  expect(toasts).toEqual([STOPPED])
  expect([await hasGhost(ui), await has('stop')]).toEqual([1, 0])
  // 2.4.1: the idle pill is back at once, in the pill's own Svg.
  expect(await figure()).toBe(undefined)

  // The dialog is answered afterwards: nothing more happens, and no ticker starts again
  // (the crew tracker notes the dialog's end as it does for any tool call; that is not Ghost's run).
  const own = () => sets.filter(e => e.key !== 'crew' && e.key !== 'page' && e.key !== 'menu').length
  const before = own()
  answer.open('Kids')
  await clock.advance(60_000)
  expect(completions).toBe(1)
  expect(fills).toEqual([])
  expect(toasts).toEqual([STOPPED])
  expect(own()).toBe(before)
  expect(progressWrites(sets).some(f => f?.pct === 100)).toBe(false)
  expect(progressWrites(sets).at(-1)).toBe(null)
  await ui.unmount()
})

test('desktop: two presses on Stop are one stop, and a Stop as the result arrives never leaves the band stuck', async ($, on) => {
  const clock = timed(mock.clock(on))
  let box = 'draft'
  const fills: string[] = []
  const toasts: string[] = []
  let hold = gate()
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    box = e.text
    return { isFilled: true }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('model.complete', async () => {
    await hold.wait
    return answered('<prompt>better</prompt>')
  })
  const ui = await $.ui.mount(band('desktop'))
  const has = async (key: string) => (await ui.findAll({ type: 'Button', key })).length

  const first = go(ui)
  await clock.advance(2000)
  const a = ui.press({ key: 'stop' })
  const again = ui.press({ key: 'stop' })
  await a
  await again.catch(() => undefined) // the button may be gone by then
  await first
  expect(toasts).toEqual([STOPPED])
  expect(fills).toEqual([])
  expect([await hasGhost(ui), await has('stop')]).toEqual([1, 0])

  // The reply and a Stop in the same instant: either the stop won (nothing placed) or the result
  // did (placed, no stop line); never both, never an error, and Ghost is free afterwards.
  hold = gate()
  const second = go(ui)
  await clock.advance(2000)
  hold.open()
  const late = ui.press({ key: 'stop' }).catch(() => undefined) // the button may be gone by then
  await second
  await late
  const stops = toasts.filter(t => t === STOPPED).length
  if (fills.length === 0) {
    expect(stops).toBe(2)
    expect(box).toBe('draft')
  } else {
    expect(stops).toBe(1)
    expect(fills).toEqual(['better'])
    expect(toasts.at(-1)?.includes('Nothing was sent')).toBe(true)
  }
  expect(toasts.some(t => t.includes('could not improve'))).toBe(false)
  await clock.advance(HOLD_MS)
  expect([await hasGhost(ui), await has('stop')]).toEqual([1, 0])

  // Free again: one more run goes through.
  hold = gate()
  hold.open()
  box = 'third draft'
  await go(ui)
  expect(box).toBe('better')
  await clock.advance(HOLD_MS)
  expect([await hasGhost(ui), await has('stop')]).toEqual([1, 0])
  await ui.unmount()
})

test('/ghost <text> and the pane field are stopped by the same Stop; the command answers the same short line', async ($, on) => {
  const clock = timed(mock.clock(on))
  const fills: string[] = []
  const toasts: string[] = []
  const opened: string[] = []
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', (_, e) => {
    opened.push(String((e as { id?: unknown }).id))
    return { value: { isPlaced: true } }
  })
  on('model.complete', () => new Promise<never>(() => undefined)) // never answers
  const ui = await $.ui.mount(band('desktop'))
  const has = async (key: string) => (await ui.findAll({ type: 'Button', key })).length
  const figure = watched(ui)

  const ran = $.command.run({ command: 'ghost', args: 'fix my essay' })
  await clock.settle()
  expect(await figure()).toBe(labelFor(0, progressPick('fix my essay')))
  await clock.advance(5000)
  expect(await figure()).toBe(labelFor(39, progressPick('fix my essay')))
  await ui.press({ key: 'stop' })
  const out = await ran
  expect(out.text).toBe(STOPPED)
  expect(fills).toEqual([])
  expect(toasts).toEqual([STOPPED])
  expect(opened).toEqual([]) // no pane was opened for a result that does not exist
  expect([await hasGhost(ui), await has('stop')]).toEqual([1, 0])

  const pane = await $.ui.mount(ghostPane('desktop'))
  const typed = pane.input({ key: 'draft', text: 'plan my trip' })
  await clock.settle()
  expect(await figure()).toBe(labelFor(0, progressPick('plan my trip')))
  await clock.advance(10_000)
  expect(await figure()).toBe(labelFor(61, progressPick('plan my trip')))
  expect(await has('stop')).toBe(1)
  await ui.press({ key: 'stop' })
  await typed
  expect(fills).toEqual([])
  expect(toasts).toEqual([STOPPED, STOPPED])
  expect([await hasGhost(ui), await has('stop')]).toEqual([1, 0])
  expect(await figure()).toBe(undefined)
  await pane.unmount()
  await ui.unmount()
})
