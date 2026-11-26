// Ghost 2.5: the native pill (nothing blinks at the press), the figure as text
// counting every percent, the Ghost dropdown of the desktop, no Crew button,
// and no timer left behind. Since 2.5.1 the tips and a done / error line run
// in the pill's ticker (tests/ghost251.test.tsx): no page timer.

import { expect, mock, test } from 'claude-code/testing'

import { GHOST_BAND_SVG, GHOST_IDLE_SVG, GHOST_WORKING_SVG } from '../hooks/art'
import { parseReply } from '../hooks/core'
import { ROLES, spinnerSvg } from '../hooks/crewart'
import { PILL_COLS, SHORT_LABEL, TIP_ROOM, pillCols, pillWords } from '../hooks/pill'
import { ASKED_PCT, HOLD_MS, TICK_MS, eased, lineFor, progressPick } from '../hooks/progress'
import { resetTipsForTest } from '../hooks/tips'
import { PILL_SPARK_SVG, SPARK, tickerSvg } from '../hooks/ticker'
import { allNodes, ghostLabel, go, hasGhost, menuCaption, pillNow, timed } from './band'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const answered = (text: string) => ({ value: { isAnswered: true as const, text, usage: USAGE } })
const WORKING = 'Ghost is improving your prompt...'
const IDLE = 'Improve the draft below'
const STOPPED = 'Ghost stopped. Your draft is unchanged.'
const UNREADABLE = 'Ghost could not improve the prompt: Ghost could not read the model reply. Your draft is unchanged.'
const UNSAFE_SVG = /<script|\son[a-z]+=|href=|<animate|<image|<foreignObject/i
const SHORT_TIP = 'Run npm test before you commit.'
// Under the 90 characters a tip may have, and longer than the pill's room.
const LONG_TIP = 'Pastikan adb ada di PATH sebelum menjalankan Jalankan_Servers.bat dari folder Proyekku.'
const TIPS = [SHORT_TIP, LONG_TIP, 'Oven timers live in src/oven.']

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

function gate<T = void>() {
  let open: (value: T) => void = () => undefined
  const wait = new Promise<T>(resolve => {
    open = resolve
  })
  return { wait, open }
}

type Rec = { key?: unknown; value?: unknown }
type Ui = { drawn: () => Promise<unknown> }
const writesOf = (sets: Rec[], key: string) => sets.filter(e => e.key === key)
/** Every Svg of the band as drawn: all of its props, in drawing order. */
const svgsOf = async (ui: Ui) =>
  JSON.stringify(
    allNodes(await ui.drawn())
      .filter(n => n.type === 'Svg')
      .map(n => n.props),
  )
/** True when some Box of the tree is positioned (the desktop draws nothing of such a Box in the band). */
const hasPositioned = async (ui: Ui) =>
  allNodes(await ui.drawn()).some(n => n.props?.['position'] !== undefined || ['top', 'left', 'right', 'bottom'].some(side => n.props?.[side] !== undefined))

// ------------------------------------------------------------------ pure

test('2.5 width: the pill has one width per band, within its floor and cap, and its label fits the room', async () => {
  expect(pillCols(40)).toBe(PILL_COLS.min)
  expect(pillCols(120)).toBe(120 - PILL_COLS.beside)
  expect(pillCols(400)).toBe(PILL_COLS.max)
  expect(pillCols(Number.NaN)).toBe(PILL_COLS.min)
  // The full label where the figure still fits beside it, the short one otherwise.
  expect(pillWords(92, WORKING)).toEqual({ label: WORKING, room: 92 - PILL_COLS.chrome - WORKING.length })
  expect(pillWords(60, WORKING).label).toBe(SHORT_LABEL)
  for (let cols = PILL_COLS.min; cols <= PILL_COLS.max; cols++) {
    const fit = pillWords(cols, WORKING)
    expect(fit.room >= PILL_COLS.figure).toBe(true) // "100% polishing magic words" always fits
    expect(fit.label.length + fit.room + PILL_COLS.chrome <= cols).toBe(true)
  }
  expect(pillWords(46, IDLE, 0).label).toBe(IDLE)
})

test('2.5 art: the ghost and the sparkle strip are constants, safe for a frame, moving by transform and opacity only, never back and forth text', async () => {
  for (const svg of [GHOST_BAND_SVG, PILL_SPARK_SVG]) {
    expect(svg.startsWith("<svg xmlns='http://www.w3.org/2000/svg' ")).toBe(true)
    expect(UNSAFE_SVG.test(svg)).toBe(false)
    expect(svg.includes('@media (prefers-reduced-motion:reduce){*{animation:none!important}}')).toBe(true)
    expect(svg.includes('<text')).toBe(false) // no words in a drawing: words are native Text
    for (const frame of svg.match(/@keyframes [^{]+\{(?:[^{}]*\{[^{}]*\})+\}/g) ?? []) {
      const props = (frame.match(/[{;]\s*([a-z-]+)\s*:/g) ?? []).map(p => p.replace(/[{;:\s]/g, ''))
      expect(props.every(p => p === 'transform' || p === 'opacity')).toBe(true)
    }
  }
  // The old plain pill ran its text back and forth (`mq ... alternate`): no drawing does that now.
  for (const svg of [GHOST_BAND_SVG, PILL_SPARK_SVG, GHOST_IDLE_SVG, GHOST_WORKING_SVG, ...ROLES.map(role => spinnerSvg(role))]) {
    expect(svg.includes('alternate')).toBe(false)
    expect(svg.includes('mq')).toBe(false)
  }
})

// ------------------------------------------------------------------ no blink

test('2.5 desktop: no Svg is loaded from the press through counting, a question and 100%; the ghost and the strip never change; the ticker is back after done, a stop and an error; every percent is counted', { timeoutMs: 120_000 }, async ($, on) => {
  resetTipsForTest()
  const clock = timed(mock.clock(on, { now: 50_000_000 }))
  mock.store(on)
  const draft = 'make me a website for my bakery'
  const pick = progressPick(draft)
  let reply: 'ask' | 'bad' = 'ask'
  let first = gate()
  let answer = gate()
  let second = gate()
  let box = draft
  let calls = 0
  const toasts: string[] = []
  const submitted: string[] = []
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
  on('model.complete', async (_, e) => {
    if (e.model === 'haiku') return answered(`<tips>${JSON.stringify(TIPS)}</tips>`)
    calls += 1
    if (reply === 'bad') return answered('Sure! Here is your prompt.')
    if (calls % 2 === 1) {
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
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.list', () => ({ value: [{ name: 'README.md', kind: 'file' as const, size: 100, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => ({ value: '# Bakery\nOven timers.' }))
  await $.session.start({ cwd: '/work/bakery', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)

  const ui = await $.ui.mount(band('desktop'))
  // Idle: the two constant drawings, the label as Text, and the tips in the ticker.
  const room = pillWords(pillCols(120), IDLE, TIP_ROOM).room
  const tips = tickerSvg(TIPS, room)
  const svgs = await svgsOf(ui)
  const idle = await pillNow(ui)
  expect(idle.sources).toEqual([GHOST_BAND_SVG, PILL_SPARK_SVG, tips.source])
  expect([idle.label, idle.line]).toEqual([IDLE, TIPS.join(' / ')])
  expect(idle.kinds).toEqual(['Svg', 'Text', 'Text', 'Box'])
  expect([idle.spark?.props?.['width'], idle.spark?.props?.['height']]).toEqual([SPARK.width, SPARK.height])
  const width = idle.box['width']
  expect(width).toBe(pillCols(120))
  // The two drawings a run keeps, with every prop: the ghost and the sparkle strip.
  const kept = JSON.stringify(JSON.parse(svgs).slice(0, 2))
  const seen: Record<string, unknown> = {}
  // While a figure shows: the kept drawings only, no ticker, the words as Text.
  const check = async (phase: string) => {
    const pill = await pillNow(ui)
    seen[phase] = [await svgsOf(ui), pill.box['width'], await hasPositioned(ui), pill.kinds.filter(kind => kind !== 'Text'), pill.ticker]
    expect(seen[phase]).toEqual([kept, width, false, ['Svg'], ''])
    return pill
  }
  // While no figure shows: the kept drawings, unchanged, and the ticker of `lines`.
  const rested = async (phase: string, lines: string[], tickerRoom: number) => {
    const pill = await pillNow(ui)
    const all = JSON.parse(await svgsOf(ui)) as unknown[]
    seen[phase] = [JSON.stringify(all.slice(0, 2)), all.length, pill.box['width'], await hasPositioned(ui), pill.kinds.filter(kind => kind !== 'Text'), pill.ticker]
    expect(seen[phase]).toEqual([kept, 3, width, false, ['Svg', 'Box'], tickerSvg(lines, tickerRoom).source])
    return pill
  }

  // Press: the count is text in the pill at once; Stop is one click away; no dropdown meanwhile.
  const run = go(ui)
  await clock.settle()
  const pressed = await check('press')
  expect([pressed.label, pressed.percent, pressed.line]).toEqual([WORKING, '0%', lineFor(0, pick)])
  expect([await hasGhost(ui), (await ui.findAll({ type: 'Button', key: 'stop' })).length]).toEqual([0, 1])

  // Counting: one percent at a time, never skipping one, never down.
  const counted = [0]
  for (let ms = TICK_MS; ms <= 6000; ms += TICK_MS) {
    await clock.advance(TICK_MS)
    const now = Number((await pillNow(ui)).percent.replace('%', ''))
    expect(now - (counted.at(-1) ?? 0) === 0 || now - (counted.at(-1) ?? 0) === 1).toBe(true)
    if (now !== counted.at(-1)) counted.push(now)
  }
  expect(counted.at(-1)).toBe(eased(6000))
  expect(counted).toEqual(Array.from({ length: eased(6000) + 1 }, (_, i) => i))
  const counting = await check('counting')
  expect(counting.line).toBe(lineFor(eased(6000), pick))

  // A question: the figure steps to its milestone and stands.
  first.open()
  await clock.settle()
  await clock.advance(20_000)
  const asked = await check('question')
  expect([asked.percent, asked.line]).toEqual([`${ASKED_PCT}%`, lineFor(ASKED_PCT, pick)])

  // Answered: on from that number.
  answer.open()
  await clock.settle()
  await clock.advance(3000)
  const moved = await check('answered')
  expect(Number(moved.percent.replace('%', '')) > ASKED_PCT).toBe(true)

  // The result: 100% as text, the dropdown back.
  second.open()
  await run
  const full = await check('100%')
  expect([full.label, full.percent, full.line]).toEqual([WORKING, '100%', lineFor(100, pick)])
  expect([await hasGhost(ui), (await ui.findAll({ type: 'Button', key: 'stop' })).length]).toEqual([1, 0])
  expect(box).toBe('Role: web designer')

  // After the hold: the done line, whole, in the ticker.
  const PLACED = 'Improved prompt is in your prompt box. Review it, then press Enter yourself. Nothing was sent.'
  const lineRoom = pillWords(pillCols(120), '').room
  await clock.advance(HOLD_MS)
  const done = await rested('done', [PLACED], lineRoom)
  expect(done.label).toBe(SHORT_LABEL)
  expect(done.percent).toBe('')
  expect(done.line).toBe(PLACED)

  // A stop: idle again, the same drawings, and the tips' ticker back, byte for byte.
  box = draft
  first = gate()
  const stopping = go(ui)
  await clock.settle()
  await clock.advance(1000)
  await check('second run')
  await ui.press({ key: 'stop' })
  await stopping
  const stopped = await rested('stopped', TIPS, room)
  expect(stopped.label).toBe(IDLE)
  expect(await svgsOf(ui)).toBe(svgs)
  expect(toasts.at(-1)).toBe(STOPPED)
  expect([await hasGhost(ui), (await ui.findAll({ type: 'Button', key: 'stop' })).length]).toEqual([1, 0])

  // An error: its line, whole, in the ticker; the same drawings.
  reply = 'bad'
  await go(ui)
  const failed = await rested('error', [UNREADABLE], lineRoom)
  expect(failed.label).toBe(SHORT_LABEL)
  expect(failed.line).toBe(UNREADABLE)
  expect(toasts.at(-1)).toBe(UNREADABLE)

  expect(Object.keys(seen)).toEqual(['press', 'counting', 'question', 'answered', '100%', 'done', 'second run', 'stopped', 'error'])
  expect(submitted).toEqual([]) // Ghost never sends
  await ui.unmount()
})

// ------------------------------------------------------------------ the dropdown

test('2.5 desktop: the Ghost control is a dropdown with no caption, directly after the pill: Ghost runs Ghost on the draft, Show opens the Ghost pane, and each pick puts it back on its resting row', async ($, on) => {
  resetTipsForTest()
  const clock = timed(mock.clock(on))
  const hold = gate()
  const opened: string[] = []
  const submitted: string[] = []
  let box = 'draft'
  let calls = 0
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', (_, e) => {
    box = e.text
    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('model.complete', async () => {
    calls += 1
    await hold.wait
    return answered('<prompt>better</prompt>')
  })

  const ui = await $.ui.mount(band('desktop'))
  const menu = async () => (await ui.find({ type: 'Select', key: 'ghost-menu' }))?.props as { label?: string; value?: string; options?: { value: string; label?: string }[] } | undefined
  const rest = await menu()
  // 2.5.1: no caption is drawn left of the dropdown (a `label` would be one), and no element stands in its place.
  expect(rest !== undefined && !('label' in rest)).toBe(true)
  expect(await menuCaption(ui)).toBe(undefined)
  // The two choices, Ghost and Show, under the resting row the dropdown shows when closed.
  expect((rest?.options ?? []).map(o => o.label)).toEqual(['Menu', 'Ghost', 'Show'])
  expect((rest?.options ?? []).slice(1).map(o => o.value)).toEqual(['ghost', 'show'])
  expect(rest?.value).toBe(rest?.options?.[0]?.value)
  // No Ghost button, no Show button, no Crew button beside it.
  expect((await pillNow(ui)).row).toEqual(['Svg:', 'Box:', 'Select:ghost-menu'])

  // Show: the Ghost pane opens; no model call; the dropdown is back on a resting row (a new one, so it is drawn anew).
  await ui.select({ key: 'ghost-menu', value: 'show' })
  expect(opened).toEqual(['ghost'])
  expect(calls).toBe(0)
  const afterShow = await menu()
  expect(afterShow?.value).toBe(afterShow?.options?.[0]?.value)
  expect(afterShow?.value !== rest?.value).toBe(true)
  expect((afterShow?.options ?? []).map(o => o.label)).toEqual(['Menu', 'Ghost', 'Show'])
  // The same choice again works at once.
  await ui.select({ key: 'ghost-menu', value: 'show' })
  expect(opened).toEqual(['ghost', 'ghost'])

  // Ghost: the same path as the button's press. While it runs Stop is one click away and the dropdown is gone.
  const run = ui.select({ key: 'ghost-menu', value: 'ghost' })
  await clock.settle()
  expect(calls).toBe(1)
  expect(await menu()).toBe(undefined)
  expect((await ui.find({ type: 'Button', key: 'stop' }))?.props['label']).toBe('Stop')
  expect((await pillNow(ui)).row).toEqual(['Svg:', 'Box:', 'Button:stop'])
  hold.open()
  await run
  expect(box).toBe('better')
  expect(submitted).toEqual([])
  const afterRun = await menu()
  expect(afterRun?.value).toBe(afterRun?.options?.[0]?.value)
  expect(await ghostLabel(ui)).toBe('Ghost')
  expect((await pillNow(ui)).row).toEqual(['Svg:', 'Box:', 'Select:ghost-menu', 'Button:undo'])
  expect(await menuCaption(ui)).toBe(undefined)

  // A pick of the resting row itself does nothing.
  const callsBefore = calls
  await ui.select({ key: 'ghost-menu', value: String(afterRun?.value) })
  expect(calls).toBe(callsBefore)
  expect(opened).toEqual(['ghost', 'ghost'])
  await ui.unmount()
})

// ------------------------------------------------------------------ nothing left behind

test('2.5 desktop: after a Stop and after a finished run whose band is gone, no timer is left: nothing is written', { timeoutMs: 120_000 }, async ($, on) => {
  resetTipsForTest()
  const clock = timed(mock.clock(on))
  let hold = gate()
  const sets: Rec[] = []
  on('prompt.read', () => ({ value: { text: 'draft', cursor: 5 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('state.set', (_, e, next) => {
    sets.push(e)
    return next(e)
  })
  on('model.complete', async () => {
    await hold.wait
    return answered('<prompt>better</prompt>')
  })

  const ui = await $.ui.mount(band('desktop'))
  // A stopped run: idle, no tips: no timer at all.
  const stopping = go(ui)
  await clock.settle()
  await clock.advance(3000)
  await ui.press({ key: 'stop' })
  await stopping
  const afterStop = sets.length
  await clock.advance(120_000)
  expect(sets.length).toBe(afterStop)

  // A finished run: the done line runs in the ticker, a drawing: no timer, nothing written ...
  hold = gate()
  const run = go(ui)
  await clock.settle()
  hold.open()
  await run
  await clock.advance(HOLD_MS)
  const afterHold = sets.length
  expect((await pillNow(ui)).ticker !== '').toBe(true)
  await clock.advance(120_000)
  expect(sets.length).toBe(afterHold)
  // ... and none with the band gone.
  await ui.unmount()
  const quiet = sets.length
  await clock.advance(120_000)
  expect(sets.length).toBe(quiet)
})

test('2.5 terminal: no Svg, no dropdown, no pill and no timer of the band in any phase; the Ghost button and the figure as text', async ($, on) => {
  resetTipsForTest()
  const clock = timed(mock.clock(on))
  const hold = gate()
  const sets: Rec[] = []
  on('prompt.read', () => ({ value: { text: 'draft', cursor: 5 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('state.set', (_, e, next) => {
    sets.push(e)
    return next(e)
  })
  on('model.complete', async () => {
    await hold.wait
    return answered('Sure! Here is your prompt.')
  })
  const ui = await $.ui.mount(band('terminal'))
  const plain = async () => {
    const nodes = allNodes(await ui.drawn())
    expect(nodes.some(n => n.type === 'Svg' || n.type === 'Select')).toBe(false)
    expect((await pillNow(ui)).has).toBe(false)
    expect(await hasPositioned(ui)).toBe(false)
  }
  await plain()
  expect((await ui.find({ type: 'Button', key: 'ghost' }))?.props['label']).toBe('Ghost')
  const run = go(ui)
  await clock.settle()
  await clock.advance(2000)
  await plain()
  expect((await ui.find({ type: 'Text', text: /^\d+% / }))?.text?.startsWith(`${eased(2000)}% `)).toBe(true)
  hold.open()
  await run
  await plain()
  const quiet = sets.length
  await clock.advance(60_000)
  expect(sets.length).toBe(quiet)
  expect(writesOf(sets, 'page').length).toBe(0)
  await ui.unmount()
})

// ------------------------------------------------------------------ the reply

test('core: a reply whose tags are in a code fence or padded with blanks is read; a reply with no tags is still unreadable', async () => {
  const want = { kind: 'prompt', prompt: 'Role: editor\nTask: fix it', notes: 'roles: editor' }
  const body = '<prompt>\nRole: editor\nTask: fix it\n</prompt>\n<notes>roles: editor</notes>'
  expect(parseReply(body)).toEqual(want)
  for (const lang of ['', 'xml', 'text', 'markdown', 'XML', 'Markdown']) {
    expect(parseReply('```' + lang + '\n' + body + '\n```')).toEqual(want)
    expect(parseReply('\n  ```' + lang + '  \r\n' + body + '\r\n```  \n\n')).toEqual(want)
  }
  expect(parseReply('````xml\n' + body + '\n````')).toEqual(want)
  // Blanks inside the brackets and any case of the tag's name.
  expect(parseReply('< prompt >\nRole: editor\nTask: fix it\n</ prompt >\n<Notes >roles: editor</ NOTES>')).toEqual(want)
  expect(parseReply('   <PROMPT>\nRole: editor\nTask: fix it\n</PROMPT>   <NOTES>roles: editor</NOTES>  ')).toEqual(want)
  // A fence inside the prompt is the prompt's own text.
  const inner = parseReply('<prompt>Run this:\n```sh\nnpm test\n```\n</prompt>')
  expect(inner).toEqual({ kind: 'prompt', prompt: 'Run this:\n```sh\nnpm test\n```', notes: '' })
  const wrapped = parseReply('```xml\n<prompt>Run this:\n```sh\nnpm test\n```\n</prompt>\n```')
  expect(wrapped).toEqual({ kind: 'prompt', prompt: 'Run this:\n```sh\nnpm test\n```', notes: '' })

  const questions = '[{"q":"Who is it for?","header":"Audience","options":["Kids","Adults"]}]'
  const asked = { kind: 'questions', questions: [{ q: 'Who is it for?', header: 'Audience', options: ['Kids', 'Adults'] }] }
  expect(parseReply(`<questions>${questions}</questions>`)).toEqual(asked)
  expect(parseReply('```xml\n<questions>\n' + questions + '\n</questions>\n```')).toEqual(asked)
  expect(parseReply('```\n< Questions >' + questions + '</ questions >\n```')).toEqual(asked)

  // No tags: unreadable, fenced or not. Plain text is never taken for the prompt.
  for (const reply of [
    'Sure! Here is your prompt.',
    '```\nRole: editor\nTask: fix it\n```',
    '```markdown\n# A prompt\nDo the thing.\n```',
    'Role: editor\nTask: fix it',
    '',
    '```xml\n```',
    '<prompt></prompt>',
    '<prompt>   </prompt>',
    '```xml\n<questions>not json</questions>\n```',
    '</prompt>text<prompt>',
  ]) {
    expect(parseReply(reply).kind).toBe('unreadable')
  }
})
