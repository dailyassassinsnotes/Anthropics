// Ghost 2.5.1: the pill's ticker. The tips run right to left as a seamless
// loop, glints stream left to right, the source is the same bytes at every
// idle redraw, no drawing is loaded while Ghost works, the ticker is back
// after a finish and after a stop, the dropdown stands directly after the
// pill with no caption, and no timer is left.

import { expect, mock, test } from 'claude-code/testing'

import { GHOST_BAND_SVG } from '../hooks/art'
import { PILL_INK, SHORT_LABEL, TIP_ROOM, pillCols, pillWords } from '../hooks/pill'
import { ASKED_PCT, HOLD_MS, TICK_MS } from '../hooks/progress'
import { resetTipsForTest } from '../hooks/tips'
import { PILL_SPARK_SVG, TICKER, TICKER_EMPTY, hashText, textWidth, tickerSvg } from '../hooks/ticker'
import { allNodes, go, menuCaption, pillNow, timed } from './band'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const answered = (text: string) => ({ value: { isAnswered: true as const, text, usage: USAGE } })
const IDLE = 'Improve the draft below'
const WORKING = 'Ghost is improving your prompt...'
const PLACED = 'Improved prompt is in your prompt box. Review it, then press Enter yourself. Nothing was sent.'
const UNSAFE_SVG = /<script|\son[a-z]+=|href=|<animate|<image|<foreignObject/i
const REDUCED = '@media (prefers-reduced-motion:reduce){*{animation:none!important}}'
const SHORT_TIP = 'Run npm test before you commit.'
const LONG_TIP = 'Pastikan adb ada di PATH sebelum menjalankan Jalankan_Servers.bat dari folder Proyekku.'
const TIPS = [SHORT_TIP, LONG_TIP, 'Oven timers live in src/oven.']
const OTHER = ['Keep the README in step with package.json.', 'Deploy from the release branch only.']

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

/** Every translateX of a keyframes rule, in px, in order. */
const shifts = (css: string, name: string): number[] => {
  const rule = new RegExp(`@keyframes ${name}\\{((?:[^{}]*\\{[^{}]*\\})+)\\}`).exec(css)?.[1] ?? ''
  return Array.from(rule.matchAll(/translateX\((-?[\d.]+)px\)/g)).map(m => Number(m[1]))
}
/** The x of every <text> of a source, in order. */
const textXs = (svg: string): number[] => Array.from(svg.matchAll(/<text class='tk' x='(-?[\d.]+)'/g)).map(m => Number(m[1]))
/** How many elements of a source carry an animation: the classes its style animates, counted where they are used. */
const animated = (svg: string): number => {
  const style = /<style>([\s\S]*?)<\/style>/.exec(svg)?.[1] ?? ''
  const classes = Array.from(style.matchAll(/\.([a-z]+)\{[^}]*animation:/g)).map(m => m[1] ?? '')
  return classes.reduce((n, cls) => n + (svg.match(new RegExp(`class='${cls}[ ']`, 'g')) ?? []).length, 0)
}
/** The properties every keyframes rule of a source changes. */
const framed = (svg: string): string[] =>
  (svg.match(/@keyframes [^{]+\{(?:[^{}]*\{[^{}]*\})+\}/g) ?? []).flatMap(frame => (frame.match(/[{;]\s*([a-z-]+)\s*:/g) ?? []).map(p => p.replace(/[{;:\s]/g, '')))

// ------------------------------------------------------------------ pure

test('2.5.1 ticker: the source depends on the tips and the room only: equal for equal tips, different for different tips', async () => {
  const room = pillWords(pillCols(120), IDLE, TIP_ROOM).room
  const a = tickerSvg(TIPS, room)
  const b = tickerSvg([...TIPS], room)
  // Another ticker in between: the one drawn last is not all that is remembered right.
  const other = tickerSvg(OTHER, room)
  const c = tickerSvg(TIPS.map(tip => `  ${tip}  `), room)
  expect(b.source).toBe(a.source)
  expect(c.source).toBe(a.source) // spaces around a tip are not text
  expect(other.source !== a.source).toBe(true)
  expect(tickerSvg([TIPS[0] ?? '', TIPS[2] ?? ''], room).source !== a.source).toBe(true)
  expect(tickerSvg(TIPS, room - 9).source !== a.source).toBe(true)
  for (const t of [a, other, TICKER_EMPTY, tickerSvg([PLACED], 60), tickerSvg([SHORT_TIP], 60)]) {
    expect(t.source.startsWith("<svg xmlns='http://www.w3.org/2000/svg' ")).toBe(true)
    expect(t.source.endsWith('</svg>')).toBe(true)
    expect(UNSAFE_SVG.test(t.source)).toBe(false)
    expect(t.source.length < 131072).toBe(true)
    expect(t.source.includes('viewBox')).toBe(false) // CSS px, unscaled: the frame is cut to the room, never shrunk
    expect([t.height, t.source.includes(`height='${TICKER.height}'`)]).toEqual([TICKER.height, true])
    expect(t.source.includes(`<rect width='100%' height='100%' fill='${PILL_INK.fill}'/>`)).toBe(true)
    expect(framed(t.source).every(p => p === 'transform' || p === 'opacity')).toBe(true)
    expect(t.source.includes(REDUCED)).toBe(true)
    expect(t.alt.trim() !== '').toBe(true)
  }
  // What a tip holds cannot break the document.
  const odd = tickerSvg(['Use <b> & "quotes" in \'src\' > lib', 'second'], room)
  expect(odd.source.includes('>Use &lt;b&gt; &amp; &quot;quotes&quot; in &#39;src&#39; &gt; lib</text>')).toBe(true)
  expect(odd.source.includes('<b>')).toBe(false)
})

test('2.5.1 marquee: two copies one strip apart move left by exactly one strip, linear and infinite, never back; about 45 px a second', async () => {
  const room = pillWords(pillCols(120), IDLE, TIP_ROOM).room
  for (const [lines, cols] of [
    [TIPS, room],
    [OTHER, room],
    [[PLACED], pillWords(pillCols(120), '').room],
    [[LONG_TIP], 24],
    [TIPS, 80],
  ] as const) {
    const t = tickerSvg(lines, cols)
    expect(t.runs).toBe(true)
    expect(t.width).toBe(Math.ceil(cols * TICKER.chMax))
    // One strip is at least as long as the widest frame: the second copy covers what the first has left.
    expect(t.strip >= t.width).toBe(true)
    const passes = t.strip / lines.reduce((sum, line) => sum + textWidth(line, TICKER.px) + TICKER.gap, 0)
    expect(Number.isInteger(passes) && passes >= 1).toBe(true)
    // Two copies of the whole strip, in one moving group; the second is hidden from a reader.
    expect((t.source.match(/<g class='mq'>/g) ?? []).length).toBe(1)
    expect(t.source.includes("<g class='mq'><g><text ")).toBe(true)
    expect((t.source.match(/<g aria-hidden='true'>/g) ?? []).length).toBe(1)
    for (const line of lines) expect(t.source.split(`>${line}</text>`).length - 1).toBe(2 * passes)
    const xs = textXs(t.source)
    const each = lines.length * passes
    expect(xs.length).toBe(2 * each)
    // The second copy is the first, exactly one strip to the right: the loop's end is its start.
    expect(xs.slice(each).map((x, i) => x - (xs[i] ?? 0))).toEqual(Array.from({ length: each }, () => t.strip))
    expect(xs[0]).toBe(TICKER.fade)
    // Every gap between two lines is the same, the seam of the loop included, with a gold dot in its middle.
    const dots = Array.from(t.source.matchAll(/<circle class='dot' cx='(-?[\d.]+)'/g)).map(m => Number(m[1]))
    expect(dots.length).toBe(2 * each)
    const widths = Array.from(t.source.matchAll(/textLength='(\d+)'/g)).map(m => Number(m[1]))
    for (let i = 0; i + 1 < xs.length; i++) {
      expect((xs[i + 1] ?? 0) - (xs[i] ?? 0) - (widths[i] ?? 0)).toBe(TICKER.gap)
      expect((dots[i] ?? 0) - (xs[i] ?? 0) - (widths[i] ?? 0)).toBe(TICKER.gap / 2)
    }
    // Right to left, by one strip, at one speed, without end, and never back.
    expect(shifts(t.source, 'mq')).toEqual([0, -t.strip])
    const rule = /\.mq\{animation:mq ([\d.]+)s linear infinite;/.exec(t.source)
    expect(rule !== null).toBe(true)
    const speed = t.strip / Number(rule?.[1])
    expect(speed >= 40 && speed <= 50).toBe(true)
    expect(t.source.includes('alternate')).toBe(false)
    expect(/ease|steps\(/.test(/\.mq\{[^}]*\}/.exec(t.source)?.[0] ?? '')).toBe(false)
    // A soft edge at both ends of the window, the right one from the frame's own right edge.
    expect(t.source.includes(`<rect x='0' y='0' width='${TICKER.fade}'`)).toBe(true)
    expect(t.source.includes(`<rect x='100%' y='0' width='${TICKER.fade}' height='${TICKER.height}' transform='translate(-${TICKER.fade} 0)'`)).toBe(true)
    // 12 px text in the tip colour.
    expect(t.source.includes(`.tk{font:12px `) && t.source.includes(`fill:${PILL_INK.text}}`)).toBe(true)
  }
})

test('2.5.1 marquee: one short tip that fits stands still, with the glints; under reduced motion the first tip stands readable at the start', async () => {
  const room = pillWords(pillCols(120), IDLE, TIP_ROOM).room
  const still = tickerSvg([SHORT_TIP], room)
  expect([still.runs, still.strip]).toEqual([false, 0])
  expect(still.source.includes('mq')).toBe(false)
  expect(textXs(still.source)).toEqual([TICKER.fade])
  expect(still.source.split(`>${SHORT_TIP}</text>`).length - 1).toBe(1)
  expect((still.source.match(/<path class='g g\d+'/g) ?? []).length).toBe(TICKER.glints)
  // It fits even where a column is as narrow as it can be.
  expect(TICKER.fade + textWidth(SHORT_TIP, TICKER.px) + TICKER.fade <= Math.floor(room * TICKER.chMin)).toBe(true)
  // The same tip in a room too small for it runs.
  expect(tickerSvg([SHORT_TIP], 24).runs).toBe(true)
  // Reduced motion: nothing moves, so the strip stands where it starts: the first tip from the window's left.
  const run = tickerSvg(TIPS, room)
  expect(run.source.includes(REDUCED)).toBe(true)
  expect(run.source.indexOf(`>${SHORT_TIP}</text>`) < run.source.indexOf(`>${LONG_TIP}</text>`)).toBe(true)
  expect(textXs(run.source)[0]).toBe(TICKER.fade)
  expect(shifts(run.source, 'mq')[0]).toBe(0)
  // A glint is not seen unless its animation runs.
  expect(run.source.includes('.g{transform-box:fill-box;transform-origin:50% 50%;opacity:0;animation:fl ')).toBe(true)
})

test('2.5.1 sparkles: seeded glints stream left to right, fade in and out, differ in size, start and pace, and at most 20 elements are animated', async () => {
  const room = pillWords(pillCols(120), IDLE, TIP_ROOM).room
  const marksOf = (svg: string) => (svg.match(/<path class='g g\d+'[^>]*>/g) ?? []).join('')
  const a = tickerSvg(TIPS, room)
  for (const svg of [a.source, tickerSvg(OTHER, room).source, tickerSvg([SHORT_TIP], room).source, TICKER_EMPTY.source, PILL_SPARK_SVG]) {
    // Left to right only: every step of the run is at or right of its start, and it ends right of it.
    const run = shifts(svg, 'fl')
    expect(run.length).toBe(3)
    expect(run[0]).toBe(0)
    expect(run.every((x, i) => i === 0 || x > (run[i - 1] ?? 0))).toBe(true)
    // Fading in and out.
    expect(/@keyframes fl\{0%\{[^}]*opacity:0\}15%\{opacity:1\}[^@]*85%\{opacity:1\}100%\{[^}]*opacity:0\}\}/.test(svg)).toBe(true)
    expect(/\.g\{[^}]*animation:fl [\d.]+s linear infinite\}/.test(svg)).toBe(true)
    const count = (svg.match(/<path class='g g\d+'/g) ?? []).length
    expect(count >= 4 && count <= TICKER.glints).toBe(true)
    expect(animated(svg) <= 20).toBe(true)
    // Varied: no two glints share a pace and a start, and their sizes differ.
    const paces = Array.from(svg.matchAll(/\.g\d+\{animation-duration:([\d.]+)s;animation-delay:-([\d.]+)s\}/g)).map(m => `${m[1]}/${m[2]}`)
    expect(paces.length).toBe(count)
    expect(new Set(paces).size).toBe(count)
    expect(new Set(Array.from(svg.matchAll(/<path class='g g\d+' d='([^']+)'/g)).map(m => (m[1] ?? '').length)).size > 1).toBe(true)
    expect(svg.includes('alternate')).toBe(false)
  }
  // The running ticker: its glints, the moving strip and the soft start.
  expect(animated(a.source)).toBe(TICKER.glints + 2)
  // Seeded by the text: the same tips give the same glints, other tips other glints.
  expect(marksOf(tickerSvg([...TIPS], room).source)).toBe(marksOf(a.source))
  expect(marksOf(tickerSvg(OTHER, room).source) !== marksOf(a.source)).toBe(true)
  expect(hashText('a') !== hashText('b') && hashText('same') === hashText('same')).toBe(true)
  // The ticker comes in softly: 160 ms, once.
  expect(a.source.includes(`.in{animation:in ${TICKER.fadeInMs / 1000}s ease-out}@keyframes in{from{opacity:0}to{opacity:1}}`)).toBe(true)
  // The strip and the glints-only ticker are constants and hold no words.
  expect(PILL_SPARK_SVG.includes('<text')).toBe(false)
  expect([TICKER_EMPTY.source.includes('<text'), TICKER_EMPTY.runs, TICKER_EMPTY.source.includes('mq')]).toEqual([false, false, false])
})

// ------------------------------------------------------------------ the band

test('2.5.1 desktop: the ticker is the same bytes at every idle redraw; a whole run loads no drawing and shows no ticker; the ticker is back after a finish and after a stop; no timer is left', { timeoutMs: 120_000 }, async ($, on) => {
  resetTipsForTest()
  const clock = timed(mock.clock(on, { now: 50_000_000 }))
  mock.store(on)
  const draft = 'make me a website for my bakery'
  let first = gate()
  let answer = gate()
  let second = gate()
  let box = draft
  let calls = 0
  const sets: Rec[] = []
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
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.set', (_, e, next) => {
    sets.push(e)
    return next(e)
  })
  on('model.complete', async (_, e) => {
    if (e.model === 'haiku') return answered(`<tips>${JSON.stringify(TIPS)}</tips>`)
    calls += 1
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
  const room = pillWords(pillCols(120), IDLE, TIP_ROOM).room
  const want = tickerSvg(TIPS, room)
  const idle = await pillNow(ui)
  expect(idle.sources).toEqual([GHOST_BAND_SVG, PILL_SPARK_SVG, want.source])
  expect([idle.tickerSvg?.props?.['width'], idle.tickerSvg?.props?.['height'], idle.tickerSvg?.props?.['isInteractive']]).toEqual([want.width, TICKER.height, true])
  expect(idle.tickerSvg?.props?.['alt']).toBe(TIPS.join(' / '))
  // The ticker's window grows into the room the pill has left and cuts the frame to it.
  expect([idle.tickerBox?.props?.['flexGrow'], idle.tickerBox?.props?.['minWidth'], idle.tickerBox?.props?.['overflow']]).toEqual([1, 0, 'hidden'])

  // Idle redraws: time passes, the band is drawn again for another reason (a pick of Show), a
  // second band is mounted: the same bytes every time, and nothing is written by a timer.
  const quiet = sets.length
  for (let i = 0; i < 12; i++) {
    await clock.advance(5000)
    expect((await pillNow(ui)).sources).toEqual(idle.sources)
  }
  expect(sets.length).toBe(quiet)
  await ui.select({ key: 'ghost-menu', value: 'show' })
  expect((await pillNow(ui)).sources).toEqual(idle.sources)
  const twin = await $.ui.mount(band('desktop'))
  expect((await pillNow(twin)).ticker).toBe(want.source)
  await twin.unmount()
  // Another width of the band is another ticker (its own bytes, again the same at every redraw).
  const narrow = await $.ui.mount(band('desktop', 100))
  const narrowRoom = pillWords(pillCols(100), IDLE, TIP_ROOM).room
  expect((await pillNow(narrow)).ticker).toBe(tickerSvg(TIPS, narrowRoom).source)
  expect((await pillNow(narrow)).ticker !== want.source).toBe(true)
  await narrow.unmount()

  // A whole run: press, counting, a question, the answer, 100%. The band's drawings are the
  // ghost and the strip at every look, never a ticker.
  const kept = [GHOST_BAND_SVG, PILL_SPARK_SVG]
  const during = new Set<string>()
  const look = async () => {
    const pill = await pillNow(ui)
    during.add(JSON.stringify(pill.sources))
    expect(pill.sources).toEqual(kept)
    expect([pill.ticker, pill.tickerBox]).toEqual(['', undefined])
    expect(pill.label).toBe(WORKING)
    return pill
  }
  const run = go(ui)
  await clock.settle()
  expect((await look()).percent).toBe('0%')
  for (let ms = 0; ms < 6000; ms += TICK_MS) {
    await clock.advance(TICK_MS)
    await look()
  }
  first.open()
  await clock.settle()
  await clock.advance(20_000)
  expect((await look()).percent).toBe(`${ASKED_PCT}%`)
  answer.open()
  await clock.settle()
  await clock.advance(3000)
  await look()
  second.open()
  await run
  expect((await look()).percent).toBe('100%')
  expect(during.size).toBe(1)

  // The run is over: after the hold the done line runs in the ticker, right to left.
  await clock.advance(HOLD_MS)
  const done = await pillNow(ui)
  const said = tickerSvg([PLACED], pillWords(pillCols(120), '').room)
  expect(done.sources).toEqual([...kept, said.source])
  expect([done.label, done.line, said.runs]).toEqual([SHORT_LABEL, PLACED, true])
  // No timer after a finish: nothing is written, and the ticker stays the same bytes.
  const afterDone = sets.length
  await clock.advance(120_000)
  expect(sets.length).toBe(afterDone)
  expect((await pillNow(ui)).sources).toEqual(done.sources)

  // The next prompt is sent by the person: idle again, the tips' ticker back, byte for byte.
  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  expect((await pillNow(ui)).sources).toEqual(idle.sources)

  // A stopped run: no ticker while it runs, the tips' ticker back after the Stop, and no timer.
  box = draft
  first = gate()
  answer = gate()
  second = gate()
  const stopping = go(ui)
  await clock.settle()
  await clock.advance(1500)
  await look()
  await ui.press({ key: 'stop' })
  await stopping
  const stopped = await pillNow(ui)
  expect(stopped.sources).toEqual(idle.sources)
  expect([stopped.label, stopped.line]).toEqual([IDLE, TIPS.join(' / ')])
  const afterStop = sets.length
  await clock.advance(120_000)
  expect(sets.length).toBe(afterStop)
  expect((await pillNow(ui)).sources).toEqual(idle.sources)
  expect(submitted).toEqual(['hello']) // Ghost never sends: the one prompt is the person's
  await ui.unmount()
  const gone = sets.length
  await clock.advance(120_000)
  expect(sets.length).toBe(gone)
})

test('2.5.1 desktop: with no tips the pill has the constant glints-only ticker, the same bytes in every band', async ($, on) => {
  resetTipsForTest()
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  const seen: string[] = []
  for (const columns of [70, 100, 120, 200]) {
    const ui = await $.ui.mount(band('desktop', columns))
    const pill = await pillNow(ui)
    expect(pill.sources).toEqual([GHOST_BAND_SVG, PILL_SPARK_SVG, TICKER_EMPTY.source])
    expect([pill.label, pill.line]).toEqual([IDLE, ''])
    expect(pill.kinds).toEqual(['Svg', 'Text', 'Box']) // no divider: no words follow the label
    seen.push(pill.ticker)
    await ui.unmount()
  }
  expect(new Set(seen).size).toBe(1)
})

test('2.5.1 desktop: the row is the ghost, the pill, then the dropdown directly after it, centred on one line; the dropdown has no caption; no Box is positioned', async ($, on) => {
  resetTipsForTest()
  const clock = timed(mock.clock(on))
  const hold = gate()
  on('prompt.read', () => ({ value: { text: 'draft', cursor: 5 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('model.complete', async () => {
    await hold.wait
    return answered('<prompt>better</prompt>')
  })
  const ui = await $.ui.mount(band('desktop'))
  type Kid = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const row = async () => (await ui.drawn()) as Kid
  const kids = async () => ((await row()).children ?? []) as Kid[]
  const positioned = async () =>
    allNodes(await ui.drawn()).some(n => n.props?.['position'] !== undefined || ['top', 'left', 'right', 'bottom'].some(side => n.props?.[side] !== undefined))
  const check = async (order: string[]) => {
    const root = await row()
    // One row, never wrapped (the pill gives way instead), its parts centred on one line.
    expect([root.props?.['flexDirection'], root.props?.['flexWrap'], root.props?.['alignItems'], root.props?.['justifyContent'], root.props?.['columnGap']]).toEqual(['row', 'nowrap', 'center', 'flex-start', 1])
    expect((await pillNow(ui)).row).toEqual(order)
    expect(await positioned()).toBe(false)
    const pill = (await pillNow(ui)).box
    expect([pill['width'], pill['flexShrink'], pill['borderStyle'], pill['borderColor'], pill['backgroundColor']]).toEqual([pillCols(120), 1, 'round', PILL_INK.rim, PILL_INK.fill])
  }

  // Idle: ghost, pill, dropdown. Nothing stands between the pill and the dropdown, and the
  // dropdown draws no caption: it has no `label`, and no Text or empty Box takes its place.
  await check(['Svg:', 'Box:', 'Select:ghost-menu'])
  const menu = (await kids())[2]
  expect(menu?.type).toBe('Select')
  expect(Object.keys(menu?.props ?? {}).includes('label')).toBe(false)
  expect(await menuCaption(ui)).toBe(undefined)
  expect(((menu?.props?.['options'] ?? []) as { label?: string }[]).map(o => o.label)).toEqual(['Menu', 'Ghost', 'Show'])
  const bare = (await kids()).filter(k => k.type === 'Text' || (k.type === 'Box' && (k.children ?? []).length === 0))
  expect(bare.length).toBe(0)

  // Working: Stop takes the dropdown's place.
  const run = go(ui)
  await clock.settle()
  await check(['Svg:', 'Box:', 'Button:stop'])
  hold.open()
  await run
  // Done and placed: the dropdown is back in its place, then Undo.
  await check(['Svg:', 'Box:', 'Select:ghost-menu', 'Button:undo'])
  expect(await menuCaption(ui)).toBe(undefined)
  await ui.unmount()

  // A terminal keeps its wrapping row, the Ghost button and no drawing.
  const term = await $.ui.mount(band('terminal'))
  const plain = (await term.drawn()) as Kid
  expect(plain.props?.['flexWrap']).toBe('wrap')
  expect(allNodes(plain).some(n => n.type === 'Svg' || n.type === 'Select')).toBe(false)
  expect((await term.find({ type: 'Button', key: 'ghost' }))?.props['label']).toBe('Ghost')
  await term.unmount()
})
