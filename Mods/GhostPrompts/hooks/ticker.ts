// The pill's ticker since 2.5.1: one drawing inside the native pill.
//
// What it shows. The tips (or a done / error line) as one line that runs from
// right to left without end, and gold glints that stream from left to right
// across it. The line is drawn twice, the second copy exactly one strip
// behind the first, and both move left by exactly one strip per loop at a
// constant speed: the end of a loop is the same picture as its start, so
// there is no jump and no gap. One short line that fits stands still.
//
// Why it does not blink. A desktop loads an <Svg isInteractive> again only
// when its source changes. This source is a pure function of the lines and the
// room (character columns): the same tips and the same band give the same
// bytes at every redraw. While Ghost works the ticker is not drawn at all (the
// figure is native Text), so nothing is loaded during a run.
//
// How it fits the pill. A desktop draws a Box's `width` in `ch` of the app's
// own font, which a mod cannot measure (about 6.5 to 8.1 px: Segoe UI's "0" is
// 0.54 em and the app's body text is 12 to 15 px). So the drawing has no
// viewBox: it is drawn at CSS px, unscaled, in a frame that the pill cuts to
// the room it really has, and the fade at the right end is placed from the
// frame's own right edge (x = 100%). The frame is as wide as the room at the
// widest `ch`; whether one line fits is judged at the narrowest.
//
// Pure: nothing here reads the clock, a random source or the engine.

import { escapeXml } from './crewart'

/**
 * The ticker's measures. `speed` px per second; `gap` px between two lines
 * (a gold dot stands in its middle); `fade` px of soft edge at each end;
 * `chMin` / `chMax` the px one character column may be; `glints` how many
 * sparkles cross a ticker (`strip`: the small strip at the pill's left).
 */
export const TICKER = {
  height: 16,
  px: 12,
  baseline: 12,
  speed: 45,
  gap: 28,
  fade: 14,
  chMin: 6.2,
  chMax: 8.5,
  lines: 8,
  maxChars: 600,
  glints: 10,
  fadeInMs: 160,
} as const

/** The colours: the pill's own fill (the drawing paints it too, see tickerSvg), the text, the dot. */
const INK = { fill: '#1F1B16', text: '#F6E7B8', dot: '#C9A24A' } as const
const TINTS = ['#F6E7B8', '#E9C66E', '#F3E3B0', '#E9D49A'] as const
const FONT = 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'
const REDUCED = '@media (prefers-reduced-motion:reduce){*{animation:none!important}}'
const ELLIPSIS = '\u{2026}'

// Helvetica / Arial advance widths in 1/100 em, close to Segoe UI and San
// Francisco at 12 px. Each line is pinned to its estimate (textLength), so the
// strip's length never depends on which system font the viewer has.
const ASCII_EM: readonly number[] = [
  28, 28, 36, 56, 56, 89, 67, 19, 33, 33, 39, 58, 28, 33, 28, 28, // space ! " # $ % & ' ( ) * + , - . /
  56, 56, 56, 56, 56, 56, 56, 56, 56, 56, 28, 28, 58, 58, 58, 56, // 0-9 : ; < = > ?
  99, 67, 67, 72, 72, 67, 61, 78, 72, 28, 50, 67, 56, 83, 72, 78, // @ A-O
  67, 78, 72, 67, 61, 72, 67, 94, 67, 67, 61, 28, 28, 28, 47, 56, // P-Z [ \ ] ^ _
  33, 56, 56, 50, 56, 56, 28, 56, 56, 22, 22, 50, 22, 83, 56, 56, // backtick a-o
  56, 56, 33, 50, 28, 56, 50, 72, 50, 50, 50, 33, 26, 33, 58, //     p-z { | } ~
]

function charEm(cp: number): number {
  if (cp >= 32 && cp <= 126) return (ASCII_EM[cp - 32] ?? 56) / 100
  if (cp === 0xa0 || cp === 0xb7) return 0.28
  if (cp === 0x2013) return 0.56
  if (cp === 0x2014 || cp === 0x2026) return 1
  if (cp === 0x2018 || cp === 0x2019 || cp === 0x201a) return 0.22
  if (cp === 0x201c || cp === 0x201d || cp === 0x201e) return 0.33
  if (cp === 0x2022) return 0.35
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    cp >= 0x20000
  ) {
    return 1
  }
  if (cp >= 0xc0 && cp <= 0x24f) return 0.6
  return 0.62
}

/** Estimated width in CSS px of one line of system-font text at `px`, a whole number (measured against Segoe UI at 12 px: within -1% to +5%). */
export function textWidth(text: string, px: number): number {
  let em = 0
  for (const ch of text) em += charEm(ch.codePointAt(0) ?? 32)
  return Math.ceil(em * px)
}

/** A 32-bit hash of the text (FNV-1a): the seed of a ticker's glints. */
export function hashText(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** A seeded generator of numbers in [0, 1) (mulberry32): the same seed gives the same run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function n1(v: number): string {
  return String(Math.round(v * 10) / 10)
}

function n2(v: number): string {
  return String(Math.round(v * 100) / 100)
}

/** A four-point star around (cx, cy) reaching r. */
function star(cx: number, cy: number, r: number): string {
  const k = r * 0.27
  return (
    'M' + n1(cx) + ' ' + n1(cy - r) + 'L' + n1(cx + k) + ' ' + n1(cy - k) + 'L' + n1(cx + r) + ' ' + n1(cy) + 'L' + n1(cx + k) + ' ' + n1(cy + k) +
    'L' + n1(cx) + ' ' + n1(cy + r) + 'L' + n1(cx - k) + ' ' + n1(cy + k) + 'L' + n1(cx - r) + ' ' + n1(cy) + 'L' + n1(cx - k) + ' ' + n1(cy - k) + 'Z'
  )
}

/**
 * Gold glints that stream from the left edge to `travel` px right of it, each
 * fading in and out: a seeded pseudo-random layout (height, size, tint,
 * strength, pace, a start somewhere in its run), so it looks random and the
 * bytes are the same for the same seed. One animated element per glint, CSS
 * transform and opacity only; a glint is not seen under reduced motion.
 */
function glints(seed: number, count: number, travel: number, fastest: number, slowest: number): { css: string; marks: string } {
  const rand = seeded(seed)
  const top = 2.5
  const bottom = TICKER.height - 2.5
  const start = -6
  let css =
    '.g{transform-box:fill-box;transform-origin:50% 50%;opacity:0;animation:fl ' + n1(slowest) + 's linear infinite}' +
    '@keyframes fl{0%{transform:translateX(0px) scale(.6);opacity:0}15%{opacity:1}50%{transform:translateX(' + n1(travel / 2) +
    'px) scale(1)}85%{opacity:1}100%{transform:translateX(' + n1(travel) + 'px) scale(.6);opacity:0}}'
  let marks = ''
  for (let i = 0; i < count; i++) {
    // One glint per slice of the height, so none rides on another.
    const y = top + ((i + 0.15 + rand() * 0.7) / count) * (bottom - top)
    const isStar = rand() < 0.62
    const size = isStar ? 1.7 + rand() * 1.8 : 1.3 + rand() * 1.1
    const strength = 0.55 + rand() * 0.45
    const seconds = fastest + rand() * (slowest - fastest)
    const begun = rand() * seconds
    const tint = TINTS[Math.floor(rand() * TINTS.length)] ?? TINTS[0]
    const d = isStar ? star(start, y, size) : 'M' + n1(start - size / 2) + ' ' + n1(y - size / 2) + 'h' + n1(size) + 'v' + n1(size) + 'h-' + n1(size) + 'z'
    marks += "<path class='g g" + i + "' d='" + d + "' fill='" + tint + "' fill-opacity='" + n2(strength) + "'/>"
    css += '.g' + i + '{animation-duration:' + n2(seconds) + 's;animation-delay:-' + n2(begun) + 's}'
  }
  return { css, marks }
}

/** One display line of a ticker: one line of spaces, at most TICKER.maxChars characters (then an ellipsis). */
function tidy(line: string): string {
  const chars = Array.from(String(line).replace(/\s+/g, ' ').trim())
  return chars.length > TICKER.maxChars ? chars.slice(0, TICKER.maxChars).join('').trimEnd() + ELLIPSIS : chars.join('')
}

export type Ticker = {
  /** The SVG document. */
  source: string
  /** The frame's size in CSS px: the widest the room can be, and the pill's line. */
  width: number
  height: number
  /** What it says, for a reader that cannot see it. */
  alt: string
  /** True when the line runs (a marquee); false when it stands still or there is no line. */
  runs: boolean
  /** The px one copy of the strip is long, which is the px a loop moves: 0 when nothing runs. */
  strip: number
}

function build(lines: readonly string[], room: number): Ticker {
  const shown = lines.map(tidy).filter(line => line !== '').slice(0, TICKER.lines)
  const cols = Math.max(8, Math.floor(Number.isFinite(room) ? room : 8))
  const width = Math.ceil(cols * TICKER.chMax)
  const least = Math.floor(cols * TICKER.chMin)
  const widths = shown.map(line => textWidth(line, TICKER.px))
  const first = widths[0] ?? 0
  const runs = shown.length > 1 || (shown.length === 1 && TICKER.fade + first + TICKER.fade > least)
  const alt = shown.length === 0 ? 'Ghost sparkles' : shown.join(' / ')
  const y = TICKER.baseline
  const text = (x: number, i: number) =>
    "<text class='tk' x='" + x + "' y='" + y + "' textLength='" + (widths[i] ?? 0) + "' lengthAdjust='spacing'>" + escapeXml(shown[i] ?? '') + '</text>'

  let words = ''
  let css = ''
  let strip = 0
  if (runs) {
    // One pass of the lines, a gap and a dot after each; as many passes as it
    // takes for one copy to be at least as long as the widest frame, so the
    // second copy always covers what the first has left.
    const pass = widths.reduce((sum, w) => sum + w + TICKER.gap, 0)
    const passes = Math.max(1, Math.ceil(width / pass))
    strip = pass * passes
    const copy = (from: number) => {
      let out = ''
      let x = from
      for (let p = 0; p < passes; p++) {
        for (let i = 0; i < shown.length; i++) {
          const w = widths[i] ?? 0
          out += text(x, i) + "<circle class='dot' cx='" + (x + w + TICKER.gap / 2) + "' cy='" + n1(TICKER.height / 2) + "' r='1.6'/>"
          x += w + TICKER.gap
        }
      }
      return out
    }
    words = "<g class='mq'><g>" + copy(TICKER.fade) + "</g><g aria-hidden='true'>" + copy(TICKER.fade + strip) + '</g></g>'
    css =
      '.mq{animation:mq ' + n2(strip / TICKER.speed) + 's linear infinite;will-change:transform}' +
      '@keyframes mq{from{transform:translateX(0px)}to{transform:translateX(-' + strip + 'px)}}'
  } else if (shown.length === 1) {
    words = text(TICKER.fade, 0)
  }

  const field = glints(hashText(shown.join('\n') + '|' + cols), TICKER.glints, width + 12, 3.6, 8.4)
  const h = TICKER.height
  const fades = runs
    ? "<rect x='0' y='0' width='" + TICKER.fade + "' height='" + h + "' fill='url(#tkL)'/>" +
      "<rect x='100%' y='0' width='" + TICKER.fade + "' height='" + h + "' transform='translate(-" + TICKER.fade + " 0)' fill='url(#tkR)'/>"
    : ''
  const source =
    "<svg xmlns='http://www.w3.org/2000/svg' width='" + width + "' height='" + h + "' role='img' aria-label='" + escapeXml(alt) + "'>" +
    "<defs><linearGradient id='tkL' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='" + INK.fill + "'/><stop offset='1' stop-color='" + INK.fill + "' stop-opacity='0'/></linearGradient>" +
    "<linearGradient id='tkR' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='" + INK.fill + "' stop-opacity='0'/><stop offset='1' stop-color='" + INK.fill + "'/></linearGradient></defs>" +
    '<style>.tk{font:' + TICKER.px + 'px ' + FONT + ';fill:' + INK.text + '}.dot{fill:' + INK.dot + '}' +
    '.in{animation:in ' + n2(TICKER.fadeInMs / 1000) + 's ease-out}@keyframes in{from{opacity:0}to{opacity:1}}' +
    css + field.css + REDUCED + '</style>' +
    // The pill's own fill, painted here too: the frame is transparent, but a
    // frame whose colour scheme differs from the app's gets an opaque ground.
    "<rect width='100%' height='100%' fill='" + INK.fill + "'/>" +
    "<g class='in'>" + field.marks + words + fades + '</g></svg>'
  return { source, width, height: h, alt, runs, strip }
}

// The ticker drawn last: the band draws again at every state change, and the
// same lines in the same room are the same ticker.
let lastKey: string | undefined
let last: Ticker | undefined

/**
 * The ticker of `lines` for a room of `room` character columns. Several lines
 * run right to left, one after the other, and around again; one line that
 * fits the narrowest room stands still; no line is glints alone. The source
 * depends on the lines and the room only.
 */
export function tickerSvg(lines: readonly string[], room: number): Ticker {
  const key = room + '\n' + lines.join('\n')
  if (last !== undefined && key === lastKey) return last
  last = build(lines, room)
  lastKey = key
  return last
}

/** The room the glints-only ticker is built for: it is the same bytes in every band. */
const EMPTY_ROOM = 64

/** The ticker with no line: glints streaming left to right, the same bytes always. */
export const TICKER_EMPTY: Ticker = build([], EMPTY_ROOM)

/** The small strip's box at the pill's left: CSS px. */
export const SPARK = { width: 26, height: TICKER.height } as const

/**
 * The pill's constant ornament, in every phase: gold glints that stream left
 * to right across a small strip. The same bytes whatever the pill says, in
 * every run and at every percent, so its frame is loaded once and never
 * again. Transform and opacity only; nothing moves under reduced motion,
 * where three still sparkles stand.
 */
export const PILL_SPARK_SVG: string = (() => {
  const field = glints(0x67686f73, 5, SPARK.width + 12, 1.6, 3.4)
  return (
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + SPARK.width + ' ' + SPARK.height + "' width='" + SPARK.width + "' height='" + SPARK.height + "' role='img' aria-label='Ghost sparkles'>" +
    '<style>' + field.css + '.s{display:none}' + REDUCED + '@media (prefers-reduced-motion:reduce){.s{display:inline}}</style>' +
    "<rect width='100%' height='100%' fill='" + INK.fill + "'/>" +
    field.marks +
    "<path class='s' fill='#E9D49A' d='" + star(7, 8, 4) + "'/><path class='s' fill='#F6E7B8' d='" + star(17, 5, 2.4) + "'/><path class='s' fill='#C9A24A' d='" + star(20, 11.5, 1.8) + "'/>" +
    '</svg>'
  )
})()
