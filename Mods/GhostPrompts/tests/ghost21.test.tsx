// Ghost 2.1: running text, streaming sparkles, the compact row, the gold
// button and the progress figure. Since 2.3 the figure is read from the pill
// (a desktop) or from the dim text (a terminal), and a Stop button stands in
// the Ghost button's place while a run is on. Since 2.3.1 the pill counts by
// itself: its figure is read as a frame would show it (tests/pillfigure.ts).

import { expect, mock, test } from 'claude-code/testing'

import {
  ASKED_PCT,
  CAP,
  HOLD_MS,
  LABEL_MAX,
  PROGRESS_LINES,
  TICK_MS,
  eased,
  labelFor,
  lineFor,
  progressPick,
} from '../hooks/progress'
import { flat, ghostLabel, go, hasGhost, pillNow, timed } from './band'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const answered = (text: string) => ({ value: { isAnswered: true as const, text, usage: USAGE } })
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u
const BUSY = 'Ghost is already improving a prompt. Wait for it to finish.'
const TIPS = ['Run npm test before you commit.', 'Oven timers live in src/oven.', 'Keep the README in step with package.json.']

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
const pctOf = (label: unknown) => Number(String(label).split('%')[0])
const progressWrites = (sets: { key?: unknown; value?: unknown }[]) =>
  sets.filter(e => e.key === 'progress').map(e => e.value as { pct: number } | null)

type Drawn = {
  find: (query: { type: string; key?: string }) => Promise<{ props: Record<string, unknown> } | undefined>
  drawn: () => Promise<unknown>
}
const FIGURE = /^\d+% \S/
/** The figure line the band shows: Text of the pill on a desktop, the dim text in a terminal; undefined when none. */
async function figureOf(ui: Drawn): Promise<string | undefined> {
  const pill = await pillNow(ui)
  if (pill.has) return pill.figure === '' ? undefined : pill.figure
  for (const kid of (node(await ui.drawn()).children ?? []).map(node)) {
    if (kid.type === 'Text' && kid.props?.['dimColor'] === true && FIGURE.test(flat(kid))) return flat(kid)
  }
  return undefined
}
/** What the band says of a run: the figure line while one shows, else the Ghost control's name. */
const shownLine = async (ui: Drawn) => (await figureOf(ui)) ?? (await ghostLabel(ui))

// ------------------------------------------------------------------ running text

test('progress: the figure eases from 0, never reaches the cap, and every range has its lines', async () => {
  expect(eased(0)).toBe(0)
  let last = 0
  for (let ms = 0; ms <= 600_000; ms += TICK_MS) {
    const p = eased(ms)
    expect(p >= last && p < CAP).toBe(true)
    last = p
  }
  expect([eased(5000), eased(10_000), eased(20_000), eased(40_000), eased(600_000)]).toEqual([39, 61, 82, 90, 91])

  expect(PROGRESS_LINES.map(r => [r.from, r.to])).toEqual([[0, 14], [15, 34], [35, 59], [60, 84], [85, 99], [100, 100]])
  const all = PROGRESS_LINES.flatMap(r => r.lines)
  expect(new Set(all).size).toBe(all.length) // no line twice
  expect(all.length >= 18).toBe(true) // several variants per range
  for (let pick = 0; pick < 3; pick++) {
    for (let pct = 0; pct <= 100; pct++) {
      const label = labelFor(pct, pick)
      const range = PROGRESS_LINES.find(r => pct >= r.from && pct <= r.to)
      expect(label.startsWith(`${pct}% `)).toBe(true)
      expect(range?.lines.includes(label.slice(`${pct}% `.length))).toBe(true)
      expect(label.length <= LABEL_MAX).toBe(true)
      expect(EMOJI.test(label)).toBe(false)
    }
    // The line changes at every range edge.
    for (const edge of [15, 35, 60, 85, 100]) expect(lineFor(edge, pick) !== lineFor(edge - 1, pick)).toBe(true)
  }
  expect(labelFor(0, 0)).toBe('0% waking the ghost')
  expect(labelFor(42, 0)).toBe('42% mixing the potion')
  expect(labelFor(100, 0)).toBe('100% done. your move')
  expect(new Set(['a', 'b', 'make me a website', 'fix my essay'].map(progressPick)).size > 1).toBe(true)
  expect(progressPick('same draft')).toBe(progressPick('same draft'))
})

// ------------------------------------------------------------------ the figure in the pill, Stop in the button's place

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the figure counts 0% to 100% beside a Stop button, stands still while a question is open, then the Ghost button is back`, { timeoutMs: 120_000 }, async ($, on) => {
    const clock = timed(mock.clock(on, { now: 1_000_000 }))
    const draft = 'make me a website for my bakery'
    const pick = progressPick(draft)
    const first = gate()
    const answer = gate()
    const second = gate()
    let box = draft
    let completions = 0
    const toasts: string[] = []
    const submitted: string[] = []
    const sets: { key?: unknown; value?: unknown }[] = []
    on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
    on('prompt.fill', (_, e) => {
      box = e.text
      return { isFilled: true }
    })
    on('prompt.submit', (_, e) => {
      submitted.push(e.text)
      return { text: e.text }
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
      if (completions === 1) {
        await first.wait
        return answered('<questions>[{"q":"Who is it for?","header":"Audience","options":["Beginners","Experts"]}]</questions>')
      }
      await second.wait
      return answered('<prompt>Role: web designer</prompt><notes>n</notes>')
    })
    on('tool.call', { tool: 'AskUserQuestion' }, async (_, e) => {
      await answer.wait
      return { result: { questions: e.questions, answers: { 'Who is it for?': 'Beginners' } } }
    })

    const ui = await $.ui.mount(band(surface))
    const label = () => shownLine(ui)
    // The pill counts every percent by itself; the terminal's text shows every percent.
    const want = (pct: number) => labelFor(pct, pick)
    // 2.5.1: at rest the band has the ghost, the sparkle strip and the ticker; while Ghost
    // runs it has the first two only, and they never change (no drawing is loaded in a run).
    const sources = async () => (await pillNow(ui)).sources.join('|')
    const atRest = await sources()
    const atWork = (await pillNow(ui)).sources.slice(0, 2).join('|')
    expect(atRest.startsWith(atWork)).toBe(true)
    if (surface === 'desktop') expect((await pillNow(ui)).sources.length).toBe(3)
    const has = async (key: string) => (await ui.findAll({ type: 'Button', key })).length
    const seen: string[] = []
    const look = async () => {
      const text = String(await label())
      seen.push(text)
      return text
    }
    expect(await look()).toBe('Ghost')
    expect([await hasGhost(ui), await has('stop')]).toEqual([1, 0])

    const pressed = go(ui) // not awaited: the hook is in flight for the whole run
    await clock.settle()
    expect(await look()).toBe(want(0))
    expect(await sources()).toBe(atWork)
    // Stop stands where the Ghost button was, and the button's label never carries the figure.
    expect([await hasGhost(ui), await has('stop')]).toEqual([0, 1])
    expect((await ui.find({ type: 'Button', key: 'stop' }))?.props['label']).toBe('Stop')

    await clock.advance(5000)
    expect(await look()).toBe(want(39))
    expect([await hasGhost(ui), await has('stop')]).toEqual([0, 1])
    if (surface === 'desktop') {
      // The label and the figure are native Text of the pill; no drawing was loaded again.
      const pill = await pillNow(ui)
      expect(pill.label).toBe('Ghost is improving your prompt...')
      expect([pill.percent, pill.line]).toEqual(['39%', want(39).slice(4)])
      expect(pill.sources.join('|')).toBe(atWork)
      expect(pill.ticker).toBe('')
    }

    // Another run asked for while this one runs starts nothing.
    const again = await $.command.run({ command: 'ghost', args: 'another draft' })
    expect(again.text).toBe(BUSY)
    expect(toasts).toEqual([BUSY])
    expect(completions).toBe(1)
    expect(await look()).toBe(want(39))

    // The first reply asks a question: the figure steps to the milestone and stands still.
    first.open()
    await clock.settle()
    await clock.advance(30_000)
    expect(await look()).toBe(want(ASKED_PCT))

    // Answered: it moves again from where it stood.
    answer.open()
    await clock.settle()
    expect(await look()).toBe(want(ASKED_PCT)) // it goes on from the number that stood, never from below it
    await clock.advance(5000)
    const moved = pctOf(await look())
    expect(moved > ASKED_PCT && moved < CAP).toBe(true)

    // A very slow call creeps toward the cap and never passes it.
    await clock.advance(120_000)
    expect(await look()).toBe(want(91))
    // At the cap the figure stands still.
    await clock.advance(30_000)
    expect(await look()).toBe(want(91))
    expect(await sources()).toBe(atWork)

    // The result is ready: 100% at once, held, then the pill's own message; the Ghost button is back at once.
    second.open()
    await pressed
    expect(await look()).toBe(want(100))
    expect([await hasGhost(ui), await has('stop')]).toEqual([1, 0])
    expect(await ghostLabel(ui)).toBe('Ghost')
    expect(await sources()).toBe(atWork) // the 100% hold is still the figure: no ticker yet
    expect(box).toBe('Role: web designer')
    await clock.advance(HOLD_MS - 1)
    expect(await look()).toBe(want(100))
    await clock.advance(1)
    expect(await look()).toBe('Ghost')

    // The figure's timers are gone: no figure is written afterwards (the page
    // of the long done line may still turn on its own slow timer).
    const before = progressWrites(sets).length
    await clock.advance(60_000)
    expect(progressWrites(sets).length).toBe(before)
    expect(await look()).toBe('Ghost')

    // The figure only ever rose, every line is short, and a write came at most once per tick.
    const figures = progressWrites(sets)
    expect(figures.at(-1)).toBe(null)
    const pcts = figures.filter(f => f !== null).map(f => f?.pct ?? 0)
    expect(pcts[0]).toBe(0)
    expect(pcts.at(-1)).toBe(100)
    // (a question writes the same percent again: once standing, once moving on)
    expect(pcts.every((p, i) => i === 0 || p >= (pcts[i - 1] ?? 0))).toBe(true)
    expect(pcts.length <= CAP + 4).toBe(true)
    expect(seen.every(text => text.length <= LABEL_MAX && !EMOJI.test(text))).toBe(true)
    expect(submitted).toEqual([]) // Ghost never sends
    await ui.unmount()
  })
}

test('a failed run never shows 100% and stops the ticker', async ($, on) => {
  const clock = timed(mock.clock(on))
  const first = gate()
  const sets: { key?: unknown; value?: unknown }[] = []
  on('prompt.read', () => ({ value: { text: 'draft', cursor: 5 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('state.set', (_, e, next) => {
    sets.push(e)
    return next(e)
  })
  on('model.complete', async () => {
    await first.wait
    return { value: { isAnswered: false as const, reason: 'aborted' as const, usage: USAGE } }
  })
  const ui = await $.ui.mount(band('desktop'))
  const label = () => shownLine(ui)
  const pressed = go(ui)
  await clock.settle()
  expect(await label()).toBe(labelFor(0, progressPick('draft')))
  await clock.advance(2000)
  expect(await label()).toBe(labelFor(eased(2000), progressPick('draft')))
  first.open()
  await pressed
  expect(await label()).toBe('Ghost')
  const figures = progressWrites(sets)
  expect(figures.some(f => f?.pct === 100)).toBe(false)
  expect(figures.at(-1)).toBe(null)
  const before = sets.filter(e => e.key !== 'page').length
  await clock.advance(60_000)
  expect(sets.filter(e => e.key !== 'page').length).toBe(before)
  expect(await label()).toBe('Ghost')
  await ui.unmount()
})

test('a refused model request is a failure too: no 100%, the plain button at once', async ($, on) => {
  const clock = timed(mock.clock(on))
  const sets: { key?: unknown; value?: unknown }[] = []
  on('prompt.read', () => ({ value: { text: 'draft', cursor: 5 } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('state.set', (_, e, next) => {
    sets.push(e)
    return next(e)
  })
  on('model.complete', () => {
    throw new Error('blocked model')
  })
  const ui = await $.ui.mount(band('terminal'))
  await go(ui)
  expect(await ghostLabel(ui)).toBe('Ghost')
  expect(progressWrites(sets).some(f => f?.pct === 100)).toBe(false)
  const before = sets.filter(e => e.key !== 'page').length
  await clock.advance(10_000)
  expect(sets.filter(e => e.key !== 'page').length).toBe(before)
  await ui.unmount()
})

test('with no clock there is no ticker and no 100% hold: 0%, then the plain button', async ($, on) => {
  const sets: { key?: unknown; value?: unknown }[] = []
  on('clock.now', () => {
    throw new Error('no clock')
  })
  on('prompt.read', () => ({ value: { text: 'draft', cursor: 5 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('state.set', (_, e, next) => {
    sets.push(e)
    return next(e)
  })
  on('model.complete', () => answered('<prompt>better</prompt>'))
  const ui = await $.ui.mount(band('desktop'))
  await go(ui)
  expect(await ghostLabel(ui)).toBe('Ghost')
  // 0% (no clock: nothing counts), then cleared.
  expect(progressWrites(sets).map(f => f?.pct ?? null)).toEqual([0, null])
  await ui.unmount()
})

test('a new press during the 100% hold is not wiped by the old hold', async ($, on) => {
  const clock = timed(mock.clock(on))
  const slow = gate()
  let n = 0
  let box = 'draft one'
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', (_, e) => {
    box = e.text
    return { isFilled: true }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('model.complete', async () => {
    n += 1
    if (n === 2) await slow.wait
    return answered(`<prompt>better ${n}</prompt>`)
  })
  const ui = await $.ui.mount(band('desktop'))
  const label = () => shownLine(ui)
  await go(ui)
  expect(pctOf(await label())).toBe(100)
  const again = go(ui)
  await clock.settle()
  expect(await label()).toBe(labelFor(0, progressPick('better 1')))
  await clock.advance(HOLD_MS + 300) // the first run's hold would have ended here
  const now = pctOf(await label())
  expect(now > 0 && now < 100).toBe(true)
  slow.open()
  await again
  expect(pctOf(await label())).toBe(100)
  await clock.advance(HOLD_MS)
  expect(await label()).toBe('Ghost')
  await ui.unmount()
})

test('/ghost and the pane field drive the same figure in the pill', async ($, on) => {
  const clock = timed(mock.clock(on))
  let hold = gate()
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.complete', async () => {
    await hold.wait
    return answered('<prompt>Improved</prompt>')
  })
  const ui = await $.ui.mount(band('desktop'))
  const label = () => shownLine(ui)

  const ran = $.command.run({ command: 'ghost', args: 'fix my essay' })
  await clock.settle()
  expect(await label()).toBe(labelFor(0, progressPick('fix my essay')))
  await clock.advance(5000)
  expect(await label()).toBe(labelFor(39, progressPick('fix my essay')))
  hold.open()
  const out = await ran
  expect(out.text?.includes('Nothing was sent')).toBe(true)
  expect(pctOf(await label())).toBe(100)
  await clock.advance(HOLD_MS)
  expect(await label()).toBe('Ghost')

  hold = gate()
  const pane = await $.ui.mount(ghostPane('desktop'))
  const typed = pane.input({ key: 'draft', text: 'plan my trip' })
  await clock.settle()
  expect(await label()).toBe(labelFor(0, progressPick('plan my trip')))
  await clock.advance(10_000)
  expect(await label()).toBe(labelFor(61, progressPick('plan my trip')))
  hold.open()
  await typed
  expect(pctOf(await label())).toBe(100)
  await clock.advance(HOLD_MS)
  expect(await label()).toBe('Ghost')
  await pane.unmount()
  await ui.unmount()
})

// ------------------------------------------------------------------ the row

test('desktop: one tight row from the left: ghost and native pill, the Ghost dropdown, then the other buttons; no Crew button', async ($, on) => {
  on('prompt.read', () => ({ value: { text: 'draft', cursor: 5 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('model.complete', () => answered('<prompt>better</prompt>'))

  const ui = await $.ui.mount(band('desktop'))
  await go(ui) // done and placed: Undo joins the row; Show is a row of the dropdown
  const root = node(await ui.drawn())
  expect(root.type).toBe('Box')
  // No background of Ghost's own behind the row, nothing pushed to the far edge, and a
  // prop beyond layout, so a desktop draws the row as written (buttons beside the pill).
  expect(root.props?.['backgroundColor']).toBe(undefined)
  expect(root.props?.['flexDirection']).toBe('row')
  expect(root.props?.['justifyContent']).toBe('flex-start')
  expect(root.props?.['overflow']).toBe('visible')
  const pill = await pillNow(ui)
  expect(pill.row).toEqual(['Svg:', 'Box:', 'Select:ghost-menu', 'Button:undo'])
  expect(root.props?.['alignItems']).toBe('center')
  expect(pill.ghost?.props?.['alt']).toBe('Ghost')
  expect([pill.ghost?.props?.['width'], pill.ghost?.props?.['height']]).toEqual([40, 36])
  // The pill is a Box with a round gold rim and the charcoal fill; its label is Text, and what
  // follows is Text (a figure) or the ticker in its Box (2.5.1).
  expect([pill.box['borderStyle'], pill.box['borderColor'], pill.box['backgroundColor']]).toEqual(['round', '#C9A24A', '#1F1B16'])
  expect(pill.kinds[0]).toBe('Svg')
  expect(pill.kinds[1]).toBe('Text')
  expect(pill.kinds.slice(1).every(kind => kind === 'Text' || kind === 'Box')).toBe(true)
  expect(pill.kinds.filter(kind => kind === 'Box').length <= 1).toBe(true)
  expect(JSON.stringify(root).includes('#252525')).toBe(false)
  // The pill is compact: never wider than its cap, whatever room the band has, and never under its floor.
  const wide = await $.ui.mount(band('desktop', 400))
  expect((await pillNow(wide)).box['width']).toBe(92)
  await wide.unmount()
  const narrow = await $.ui.mount(band('desktop', 40))
  expect((await pillNow(narrow)).box['width']).toBe(46)
  await narrow.unmount()
  await ui.unmount()
})

test('terminal: the gold Ghost label and the words in one row; no Crew button', async ($, on) => {
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  const ui = await $.ui.mount(band('terminal'))
  const root = node(await ui.drawn())
  const kids = (root.children ?? []).map(node)
  expect(kids.map(k => `${k.type}:${String(k.props?.['key'] ?? '')}`)).toEqual(['Button:ghost', 'Text:'])
  const ghost = JSON.stringify(kids[0])
  expect(ghost.includes('#AA8231') && ghost.includes('#17130C') && ghost.includes(' Ghost ')).toBe(true)
  await ui.unmount()
})

// ------------------------------------------------------------------ review fixes

test('a ready result whose pane cannot open is a failure: the button never claims 100%', async ($, on) => {
  const clock = timed(mock.clock(on))
  const sets: { key?: unknown; value?: unknown }[] = []
  // The box changed while Ghost worked, so the result goes to the pane, and the pane cannot open.
  on('prompt.read', () => ({ value: { text: 'typed meanwhile', cursor: 0 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => {
    throw new Error('no panes here')
  })
  on('state.set', (_, e, next) => {
    sets.push(e)
    return next(e)
  })
  on('model.complete', () => answered('<prompt>Improved</prompt>'))
  const ui = await $.ui.mount(band('desktop'))
  const out = await $.command.run({
    command: 'ghost',
    args: 'fix my essay',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  expect(out.text?.includes('could not improve')).toBe(true)
  expect(await ghostLabel(ui)).toBe('Ghost')
  const figures = progressWrites(sets)
  expect(figures.some(f => f?.pct === 100)).toBe(false)
  expect(figures.at(-1)).toBe(null)
  await clock.advance(HOLD_MS)
  await ui.unmount()
})

// A desktop's pill counts by itself, so its state holds the run's start (0%) and
// nothing per percent; a terminal's state holds every percent. Either way the
// figure a lost clearing write leaves behind must not come back on the band.
for (const [surface, heldPct] of [['terminal', 39], ['desktop', 39]] as const) {
  test(`${surface}: a lost clearing write does not leave a figure on the button`, async ($, on) => {
    const clock = timed(mock.clock(on))
    const hold = gate()
    let failing = false
    let refused = 0
    const sets: { key?: unknown; value?: unknown }[] = []
    on('prompt.read', () => ({ value: { text: 'draft', cursor: 5 } }))
    on('prompt.fill', () => ({ isFilled: true }))
    on('prompt.submit', (_, e) => ({ text: e.text }))
    on('ui.toast', () => ({ value: undefined }))
    on('ui.status', () => ({ value: undefined }))
    on('state.set', (_, e, next) => {
      if (failing && e.key === 'progress') {
        refused += 1
        return { deny: 'lost' } as never // another plugin refuses the write
      }
      sets.push(e)
      return next(e)
    })
    on('model.complete', async () => {
      await hold.wait
      return { value: { isAnswered: false as const, reason: 'aborted' as const, usage: USAGE } }
    })
    const ui = await $.ui.mount(band(surface))
    const label = () => shownLine(ui)
    const pressed = go(ui)
    await clock.settle()
    expect(pctOf(await label())).toBe(0)
    await clock.advance(5000)
    // On screen: 39% on both surfaces, as text.
    expect(pctOf(await label())).toBe(39)
    failing = true
    hold.open()
    await pressed
    failing = false
    expect(refused).toBe(1) // the clearing write, and only it, was lost
    // The band draws again for the error message: the figure must not come back.
    expect(await label()).toBe('Ghost')
    expect((await ui.findAll({ type: 'Button', key: 'stop' })).length).toBe(0)
    await clock.advance(60_000)
    expect(await label()).toBe('Ghost')
    // A figure is still in the session's state (the last one written before the
    // lost clear); the next sent prompt drops it, and the prompt goes on.
    expect(progressWrites(sets).at(-1)?.pct).toBe(heldPct)
    const sent = await $.prompt.submit({ text: 'my own words', wait: false, origin: { kind: 'composer' } })
    expect(JSON.stringify(sent).includes('my own words')).toBe(true)
    expect(progressWrites(sets).at(-1)).toBe(null)
    expect(await label()).toBe('Ghost')
    await ui.unmount()
  })
}

test('the figure is never in the way: a progress write that hangs does not hold the model call', async ($, on) => {
  const clock = timed(mock.clock(on))
  const stuck = gate()
  let completions = 0
  on('prompt.read', () => ({ value: { text: 'draft', cursor: 5 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('state.set', async (_, e, next) => {
    if (e.key === 'progress') await stuck.wait
    return next(e)
  })
  on('model.complete', () => {
    completions += 1
    return answered('<prompt>better</prompt>')
  })
  const ui = await $.ui.mount(band('desktop'))
  const pressed = go(ui)
  await clock.advance(1000)
  expect(completions).toBe(1)
  stuck.open()
  await pressed
  await clock.advance(HOLD_MS)
  expect(await ghostLabel(ui)).toBe('Ghost')
  await ui.unmount()
})

test('the ticker stops while a clarifying question is open and starts again after the answer', async ($, on) => {
  const clock = timed(mock.clock(on))
  const answer = gate<string>()
  const second = gate()
  let n = 0
  on('prompt.read', () => ({ value: { text: 'make a site', cursor: 0 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('model.complete', async () => {
    n += 1
    if (n === 1) return answered('<questions>[{"q":"Who is it for?","header":"Audience","options":["Kids","Adults"]}]</questions>')
    await second.wait
    return answered('<prompt>better</prompt>')
  })
  on('tool.call', { tool: 'AskUserQuestion' }, async (_, e) => {
    const picked = await answer.wait
    return { result: { questions: e.questions, answers: { 'Who is it for?': picked } } }
  })
  const ui = await $.ui.mount(band('desktop'))
  const label = () => shownLine(ui)
  const pressed = go(ui)
  await clock.settle()
  expect(pctOf(await label())).toBe(ASKED_PCT)
  await clock.advance(30_000) // the person walks away with the dialog open
  expect(pctOf(await label())).toBe(ASKED_PCT)
  answer.open('Kids')
  await clock.settle()
  expect(pctOf(await label())).toBe(ASKED_PCT) // it moves on from where it stood
  await clock.advance(5000)
  const moved = pctOf(await label())
  expect(moved > ASKED_PCT && moved < 100).toBe(true)
  second.open()
  await pressed
  expect(pctOf(await label())).toBe(100)
  await clock.advance(HOLD_MS)
  expect(await label()).toBe('Ghost')
  await ui.unmount()
})
