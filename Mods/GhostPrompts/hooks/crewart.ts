// Ghost crew art: the role characters of the Ghost Crew pane and of the
// desktop's running-step line (the Spinner site), and the roles themselves.
// The band's pill is native since 2.5 (hooks/pill.ts): no drawing of it is
// made here any more.
//
// Rules every drawing keeps:
// - Pure and deterministic: the same options give the same bytes, so a caller
//   can cache by key and the desktop keeps a frame across redraws.
// - One <svg> root, no prolog, comment, script, on* attribute, href, <image>,
//   <foreignObject> or <animate>; well-formed XML, since an image-mode source
//   is parsed as XML.
// - CSS animates transform and opacity only, and every animated source
//   carries @media (prefers-reduced-motion: reduce) { * { animation: none } }.
//   With the animations removed, each element falls back to a readable rest
//   pose.
// - Ids, classes and keyframes carry a per-drawing prefix, so two drawings can
//   share one document (a web view) without restyling each other.
// - Text is cleaned (controls, bidi marks and emoji dropped) and XML-escaped.

// ------------------------------------------------------------------ types

export type CharacterState = 'running' | 'done' | 'failed'
export type Role =
  | 'scout'
  | 'builder'
  | 'operator'
  | 'tester'
  | 'courier'
  | 'navigator'
  | 'conductor'
  | 'keeper'
  | 'generic'

export type CharacterOptions = {
  role: Role
  state: CharacterState
  /** CSS pixels, 16 to 28 (default 20). */
  size?: number
  /** A running pose drawn still (off screen, or past the animated cap): no style, nothing moves. */
  still?: boolean
}

export const ROLES: readonly Role[] = [
  'scout',
  'builder',
  'operator',
  'tester',
  'courier',
  'navigator',
  'conductor',
  'keeper',
  'generic',
]

/** The palette. Contrast on the pill (#1F1B16): label 10.78:1, ticker 8.58:1. */
export const PALETTE = {
  /** The native Button's gold; ink #17130C on it is 5.24:1. */
  button: '#AA8231',
  ink: '#17130C',
  brass: '#C9A24A',
  champagne: '#E6CB80',
  burnished: '#9C7A30',
  glint: '#F6E7B8',
  charcoal: '#1F1B16',
  /** Ticker text: 8.58:1 on the pill, 5.67:1 under the shimmer scan's peak. */
  tip: '#D4B468',
  ivory: '#F3E3B0',
  spark: '#E9D49A',
  blush: '#B5703F',
  /** The failed badge (muted copper). */
  copper: '#A0694A',
} as const

const REDUCED = '@media (prefers-reduced-motion:reduce){*{animation:none!important}}'
const SVG_OPEN = "<svg xmlns='http://www.w3.org/2000/svg' "

// ------------------------------------------------------------------ text

const XML_INVALID =
  /[\u{0}-\u{8}\u{B}\u{C}\u{E}-\u{1F}\u{FFFE}\u{FFFF}\u{D800}-\u{DFFF}]/gu

/** Escapes text for XML content and attribute values, and drops what XML 1.0 cannot hold. */
export function escapeXml(text: string): string {
  return String(text)
    .replace(XML_INVALID, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const TO_SPACE = /[\u{0}-\u{1F}\u{7F}-\u{9F}\u{2028}\u{2029}]/gu
const INVISIBLE = /[\u{AD}\u{61C}\u{180E}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{206F}\u{FEFF}]/gu
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{231A}\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{3030}\u{303D}\u{3297}\u{3299}\u{FE00}-\u{FE0F}\u{20E3}\u{E0000}-\u{E007F}]/gu

/** One display line: controls to spaces, bidi and zero-width marks and emoji dropped, spaces collapsed, at most 160 characters. Only strings and numbers have text. */
export function cleanText(text: unknown): string {
  const line = (typeof text === 'string' || typeof text === 'number' ? String(text) : '')
    .replace(TO_SPACE, ' ')
    .replace(INVISIBLE, '')
    .replace(EMOJI, '')
    .replace(/\s+/g, ' ')
    .trim()
  const chars = Array.from(line)
  return chars.length > 160 ? chars.slice(0, 160).join('').trim() : line
}

const ELLIPSIS = '\u{2026}'

// ------------------------------------------------------------------ numbers

function n1(v: number): string {
  const r = Math.round(v * 10) / 10
  return r === 0 ? '0' : String(r)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** A four-point sparkle centred on (cx, cy). */
function star(cx: number, cy: number, r: number): string {
  const k = r * 0.27
  const pt = (x: number, y: number) => n1(x) + ' ' + n1(y)
  return (
    'M' + pt(cx, cy - r) + 'L' + pt(cx + k, cy - k) + 'L' + pt(cx + r, cy) + 'L' + pt(cx + k, cy + k) +
    'L' + pt(cx, cy + r) + 'L' + pt(cx - k, cy + k) + 'L' + pt(cx - r, cy) + 'L' + pt(cx - k, cy - k) + 'Z'
  )
}

// ------------------------------------------------------------------ the crew

const ROLE_NAME: Record<Role, string> = {
  scout: 'Scout',
  builder: 'Builder',
  operator: 'Operator',
  tester: 'Tester',
  courier: 'Courier',
  navigator: 'Navigator',
  conductor: 'Conductor',
  keeper: 'Keeper',
  generic: 'Crew ghost',
}

const ROLE_CODE: Record<Role, string> = {
  scout: 'sc',
  builder: 'bu',
  operator: 'op',
  tester: 'te',
  courier: 'co',
  navigator: 'na',
  conductor: 'cn',
  keeper: 'ke',
  generic: 'ge',
}

function isRole(x: unknown): x is Role {
  return typeof x === 'string' && (ROLES as readonly string[]).includes(x)
}

/** An Svg alt of 40 characters at most: "Scout at work", "Builder, done". */
export function characterAlt(role: Role, state: CharacterState): string {
  const name = ROLE_NAME[isRole(role) ? role : 'generic']
  return state === 'done' ? name + ', done' : state === 'failed' ? name + ', failed' : name + ' at work'
}

type Kit = {
  /** " class='<prefix><name>'" while animated, '' in a still pose. */
  c: (name: string) => string
  live: boolean
  /** The drawing's prefix, for the ids of a prop's own gradients. */
  p: string
}

type RoleArt = {
  /** Where the right hand holds the prop. */
  hand: readonly [number, number]
  /** Behind the ghost and not bobbing (a desk terminal). */
  desk?: (k: Kit) => string
  /** Held: bobs with the ghost, drawn over the body, under the right hand. */
  held?: (k: Kit) => string
  /** In front and not bobbing (sparkles, echoes). */
  front?: (k: Kit) => string
  /** A class on the right hand itself (a wave). */
  handClass?: string
  /** Gradients the prop needs, ids prefixed. */
  defs?: (p: string) => string
  /** A class on a group around the eyes (a look). */
  eyesClass?: string
  /** The role's CSS, its classes prefixed; animated elements: at most 5 here (beat, shadow and blink make 8). */
  css: (p: string) => string
}

const INK = PALETTE.charcoal
const VB = 'transform-box:view-box;transform-origin:'
const FB = 'transform-box:fill-box;transform-origin:'

/** A small ghost silhouette 4.4 wide, top-left at (x, y): the conductor's echoes. */
function miniGhost(x: number, y: number): string {
  return (
    'M' + n1(x) + ' ' + n1(y + 2.4) + 'C' + n1(x) + ' ' + n1(y + 1) + ' ' + n1(x + 1) + ' ' + n1(y) + ' ' + n1(x + 2.2) + ' ' + n1(y) +
    'S' + n1(x + 4.4) + ' ' + n1(y + 1) + ' ' + n1(x + 4.4) + ' ' + n1(y + 2.4) + 'V' + n1(y + 4.6) + 'l-1.1-.8-1.1.8-1.1-.8-1.1.8Z'
  )
}

const ROLE_ART: Record<Role, RoleArt> = {
  // Read / Grep / Glob: a magnifier sweeps while the eyes follow it.
  scout: {
    hand: [20.6, 16.4],
    eyesClass: 'l',
    held: k =>
      '<g' + k.c('1') + '>' +
      "<path d='M21.3 15.6L23.5 13.1' stroke='" + INK + "' stroke-width='2.8' stroke-linecap='round'/>" +
      "<path d='M21.3 15.6L23.5 13.1' stroke='#9C7A30' stroke-width='1.3' stroke-linecap='round'/>" +
      "<circle cx='25.7' cy='10.7' r='3.3' fill='#F6E7B8' fill-opacity='.55' stroke='" + INK + "' stroke-width='2.1'/>" +
      "<circle cx='25.7' cy='10.7' r='3.3' fill='none' stroke='#C9A24A' stroke-width='.9'/>" +
      '<path' + k.c('2') + " d='M24.1 9.9Q24.6 8.8 25.8 8.5' fill='none' stroke='#FFFFFF' stroke-width='.8' stroke-linecap='round'/>" +
      '</g>',
    css: p =>
      '.' + p + '1{' + VB + '20.6px 16.4px;animation:' + p + 'S 2.4s steps(12) infinite alternate}' +
      '.' + p + '2{animation:' + p + 'G 1.2s steps(2) infinite alternate}' +
      '.' + p + 'l{animation:' + p + 'L 2.4s steps(12) infinite alternate}' +
      '@keyframes ' + p + 'S{from{transform:rotate(-16deg)}to{transform:rotate(12deg)}}' +
      '@keyframes ' + p + 'G{from{opacity:.35}to{opacity:1}}' +
      '@keyframes ' + p + 'L{from{transform:translateX(-.5px)}to{transform:translateX(.6px)}}',
  },
  // Edit / Write: a hammer taps, a spark flashes at the strike.
  builder: {
    hand: [20.8, 17.4],
    held: k =>
      '<g' + k.c('1') + '>' +
      "<path d='M20.8 17.2V9.8' stroke='" + INK + "' stroke-width='2.6' stroke-linecap='round'/>" +
      "<path d='M20.8 17.2V9.8' stroke='#9C7A30' stroke-width='1.2' stroke-linecap='round'/>" +
      "<rect x='18' y='8' width='5.6' height='3' rx='.8' fill='#C9A24A' stroke='" + INK + "' stroke-width='1.1'/>" +
      '</g>' +
      (k.live
        ? '<path' + k.c('2') + " d='" + star(29.2, 15.6, 2.2) + "' fill='#F6E7B8' stroke='" + INK + "' stroke-width='.4' stroke-linejoin='round' opacity='0'/>"
        : ''),
    css: p =>
      '.' + p + '1{' + VB + '20.8px 17.2px;animation:' + p + 'H 1.5s linear infinite}' +
      '.' + p + '2{' + FB + '50% 50%;animation:' + p + 'P 1.5s linear infinite}' +
      '@keyframes ' + p + 'H{0%,40%{transform:rotate(-12deg)}62%{transform:rotate(56deg)}70%{transform:rotate(44deg)}78%{transform:rotate(54deg)}100%{transform:rotate(-12deg)}}' +
      '@keyframes ' + p + 'P{0%,60%{opacity:0;transform:scale(.4)}64%{opacity:1;transform:scale(1)}82%,100%{opacity:0;transform:scale(.7)}}',
  },
  // Bash: a small terminal on the desk, a line types, the cursor blinks.
  operator: {
    hand: [20.4, 18.6],
    desk: k =>
      "<rect x='19.8' y='12.2' width='11.4' height='9.6' rx='1.8' fill='" + INK + "' stroke='#C9A24A' stroke-width='1.1'/>" +
      "<path d='M21.9 14.9l1.6 1.4-1.6 1.4' fill='none' stroke='#E6CB80' stroke-width='1' stroke-linecap='round' stroke-linejoin='round'/>" +
      '<rect' + k.c('1') + " x='24.4' y='15.8' width='3.6' height='1.1' fill='#D4B468'/>" +
      '<rect' + k.c('2') + " x='28.5' y='15.1' width='1.3' height='2.4' fill='#F6E7B8'/>" +
      "<rect x='21.9' y='19' width='6.6' height='.9' fill='#9C7A30'/>" +
      "<path d='M23.6 23H27.4' stroke='" + INK + "' stroke-width='1.2' stroke-linecap='round'/>",
    css: p =>
      '.' + p + '1{' + VB + '24.4px 0;animation:' + p + 'T 2.4s steps(1) infinite}' +
      '.' + p + '2{animation:' + p + 'C 1s steps(1) infinite}' +
      '@keyframes ' + p + 'T{0%{transform:scaleX(0)}20%{transform:scaleX(.3)}40%{transform:scaleX(.6)}60%,90%{transform:scaleX(1)}100%{transform:scaleX(0)}}' +
      '@keyframes ' + p + 'C{0%{opacity:1}50%{opacity:0}}',
  },
  // Test runs: a flask swirls, bubbles rise.
  tester: {
    hand: [20.6, 16.2],
    held: k =>
      '<g' + k.c('4') + '>' +
      "<path d='M22.3 16.8H28.3L29.6 19.4Q30.3 21.6 28.2 21.6H22.4Q20.3 21.6 21 19.4Z' fill='#E6CB80'/>" +
      "<path d='M24.1 9.4H26.5V12.9L29.6 19.4Q30.3 21.6 28.2 21.6H22.4Q20.3 21.6 21 19.4L24.1 12.9Z' fill='#F6E7B8' fill-opacity='.3' stroke='" + INK + "' stroke-width='1.2' stroke-linejoin='round'/>" +
      "<rect x='23.5' y='8.5' width='3.6' height='1.3' rx='.6' fill='#C9A24A' stroke='" + INK + "' stroke-width='.8'/>" +
      '<circle' + k.c('1') + " cx='25.1' cy='19.8' r='.8' fill='#FFF7E0'/>" +
      '<circle' + k.c('2') + " cx='26.7' cy='20.3' r='.6' fill='#FFF7E0'/>" +
      '<circle' + k.c('3') + " cx='24.2' cy='19' r='.55' fill='#FFF7E0'/>" +
      '</g>',
    css: p =>
      '.' + p + '1{animation:' + p + 'U 1.6s steps(8) infinite}' +
      '.' + p + '2{animation:' + p + 'V 2.1s steps(8) infinite;animation-delay:-.7s}' +
      '.' + p + '3{animation:' + p + 'V 1.4s steps(7) infinite;animation-delay:-1.1s}' +
      '.' + p + '4{' + VB + '25.3px 21.6px;animation:' + p + 'W 1.8s steps(9) infinite alternate}' +
      '@keyframes ' + p + 'U{0%{transform:translateY(0);opacity:0}25%{opacity:1}100%{transform:translateY(-9px);opacity:0}}' +
      '@keyframes ' + p + 'V{0%{transform:translateY(0);opacity:0}25%{opacity:1}100%{transform:translateY(-5.5px);opacity:0}}' +
      '@keyframes ' + p + 'W{from{transform:rotate(-5deg)}to{transform:rotate(5deg)}}',
  },
  // git push / commit / gh / deploy: a parcel hops in the hands.
  courier: {
    hand: [20.4, 16.6],
    held: k =>
      '<g' + k.c('1') + '>' +
      "<rect x='20.8' y='13.6' width='9' height='7.8' rx='1' fill='#C9A24A' stroke='" + INK + "' stroke-width='1.2'/>" +
      "<path d='M20.8 16.2H29.8' stroke='" + INK + "' stroke-width='.8'/>" +
      "<path d='M25.3 13.6V21.4' stroke='#F6E7B8' stroke-width='1.3'/>" +
      "<rect x='26.6' y='17.6' width='2.2' height='1.7' rx='.3' fill='#F3E3B0'/>" +
      '</g>' +
      (k.live
        ? '<path' + k.c('2') + " d='M23.2 11.4V9.6M27.4 11.4V9.6M25.3 10.6V8.4' stroke='#9C7A30' stroke-width='.9' stroke-linecap='round' opacity='0'/>"
        : ''),
    css: p =>
      '.' + p + '1{' + FB + '50% 100%;animation:' + p + 'J 1.4s linear infinite}' +
      '.' + p + '2{animation:' + p + 'M 1.4s linear infinite}' +
      '@keyframes ' + p + 'J{0%,100%{transform:translateY(0) scaleY(1)}12%{transform:translateY(0) scaleY(.9)}40%{transform:translateY(-3px) scaleY(1.04)}70%{transform:translateY(0) scaleY(1)}}' +
      '@keyframes ' + p + 'M{0%,15%,60%,100%{opacity:0}30%{opacity:.9}}',
  },
  // WebFetch / WebSearch / the browser: a compass needle swings and settles.
  navigator: {
    hand: [20.6, 18.2],
    held: k =>
      "<circle cx='25.6' cy='16.4' r='4.6' fill='#F6E7B8' stroke='" + INK + "' stroke-width='1.3'/>" +
      "<circle cx='25.6' cy='16.4' r='3.5' fill='none' stroke='#C9A24A' stroke-width='.8'/>" +
      '<g' + k.c('1') + '>' +
      "<path d='M25.6 12.9L26.7 16.4H24.5Z' fill='#A0694A'/>" +
      "<path d='M25.6 19.9L26.7 16.4H24.5Z' fill='" + INK + "'/>" +
      '</g>' +
      "<circle cx='25.6' cy='16.4' r='.65' fill='#F3E3B0' stroke='" + INK + "' stroke-width='.4'/>" +
      '<path' + k.c('2') + " d='M22.9 14.4Q23.6 13.1 24.9 12.7' fill='none' stroke='#FFFFFF' stroke-width='.7' stroke-linecap='round'/>",
    css: p =>
      '.' + p + '1{' + VB + '25.6px 16.4px;animation:' + p + 'N 2.8s ease-in-out infinite}' +
      '.' + p + '2{animation:' + p + 'G 1.4s steps(2) infinite alternate}' +
      '@keyframes ' + p + 'N{0%,100%{transform:rotate(-30deg)}24%{transform:rotate(22deg)}46%{transform:rotate(-12deg)}66%{transform:rotate(7deg)}84%{transform:rotate(-2deg)}}' +
      '@keyframes ' + p + 'G{from{opacity:.3}to{opacity:.95}}',
  },
  // Agent / Workflow: a baton waves and two mini ghosts echo the crew.
  conductor: {
    hand: [20.6, 15.8],
    held: k =>
      '<g' + k.c('1') + '>' +
      "<path d='M21.2 15.1L27.8 8.3' stroke='" + INK + "' stroke-width='1.8' stroke-linecap='round'/>" +
      "<path d='M21.2 15.1L27.8 8.3' stroke='#F6E7B8' stroke-width='.7' stroke-linecap='round'/>" +
      "<circle cx='28' cy='8.1' r='.9' fill='#E6CB80' stroke='" + INK + "' stroke-width='.5'/>" +
      '</g>',
    front: k =>
      '<path' + k.c('2') + " d='" + miniGhost(23.2, 20.6) + "' fill='#E6CB80' stroke='" + INK + "' stroke-width='.55' stroke-linejoin='round'" + (k.live ? '' : " opacity='.6'") + '/>' +
      '<path' + k.c('3') + " d='" + miniGhost(27.2, 15.2) + "' fill='#E6CB80' stroke='" + INK + "' stroke-width='.55' stroke-linejoin='round'" + (k.live ? '' : " opacity='.6'") + '/>',
    css: p =>
      '.' + p + '1{' + VB + '20.6px 15.8px;animation:' + p + 'C 1.6s steps(8) infinite alternate}' +
      '.' + p + '2,.' + p + '3{animation:' + p + 'F 2.4s steps(12) infinite}.' + p + '3{animation-delay:-1.2s}' +
      '@keyframes ' + p + 'C{from{transform:rotate(-22deg)}to{transform:rotate(18deg)}}' +
      '@keyframes ' + p + 'F{0%{transform:translateY(1.5px);opacity:0}30%{opacity:.95}70%{opacity:.8}100%{transform:translateY(-2px);opacity:0}}',
  },
  // Backup / memory / store: a lantern sways, its glow breathes, the flame flickers.
  keeper: {
    hand: [22.6, 11.4],
    defs: p =>
      "<radialGradient id='" + p + "k'><stop offset='0' stop-color='#FFF4D6' stop-opacity='.9'/><stop offset='.45' stop-color='#F6E7B8' stop-opacity='.45'/><stop offset='1' stop-color='#F6E7B8' stop-opacity='0'/></radialGradient>",
    held: k =>
      '<g' + k.c('1') + '>' +
      '<circle' + k.c('2') + " cx='24' cy='17.4' r='6.2' fill='url(#" + k.p + "k)'" + (k.live ? '' : " opacity='.8'") + '/>' +
      "<path d='M22.5 13.6Q24 10.6 25.5 13.6' fill='none' stroke='" + INK + "' stroke-width='.9'/>" +
      "<path d='M21.7 13.6H26.3L25.5 14.7H22.5Z' fill='#9C7A30' stroke='" + INK + "' stroke-width='.7' stroke-linejoin='round'/>" +
      "<rect x='22.1' y='14.7' width='3.8' height='5.4' rx='.9' fill='#F6E7B8' stroke='" + INK + "' stroke-width='.9'/>" +
      '<path' + k.c('3') + " d='M24 15.6C24.8 16.6 25.1 17.4 25.1 17.9A1.1 1.1 0 0 1 22.9 17.9C22.9 17.4 23.2 16.6 24 15.6Z' fill='#E6CB80' stroke='#C9A24A' stroke-width='.4'/>" +
      "<rect x='21.7' y='20.1' width='4.6' height='1.3' rx='.5' fill='#9C7A30' stroke='" + INK + "' stroke-width='.7'/>" +
      '</g>',
    css: p =>
      '.' + p + '1{' + VB + '23.6px 11.8px;animation:' + p + 'S 2.6s ease-in-out infinite alternate}' +
      '.' + p + '2{' + FB + '50% 50%;animation:' + p + 'H 1.8s steps(9) infinite alternate}' +
      '.' + p + '3{' + FB + '50% 100%;animation:' + p + 'F 1.2s steps(4) infinite alternate}' +
      '@keyframes ' + p + 'S{from{transform:rotate(-6deg)}to{transform:rotate(6deg)}}' +
      '@keyframes ' + p + 'H{from{transform:scale(.8);opacity:.5}to{transform:scale(1.08);opacity:1}}' +
      '@keyframes ' + p + 'F{from{transform:scaleY(.86)}to{transform:scaleY(1.06)}}',
  },
  // Anything else: a wave and two sparkles.
  generic: {
    hand: [20.4, 16.6],
    handClass: '1',
    front: k =>
      '<path' + k.c('2') + " d='" + star(26.8, 8.6, 2.8) + "' fill='#E9D49A' stroke='" + INK + "' stroke-width='.5' stroke-linejoin='round'/>" +
      '<path' + k.c('3') + " d='" + star(28.6, 18.2, 1.9) + "' fill='#E9D49A' stroke='" + INK + "' stroke-width='.5' stroke-linejoin='round'/>",
    css: p =>
      '.' + p + '1{' + FB + '0% 50%;animation:' + p + 'A 2.4s ease-in-out infinite}' +
      '.' + p + '2,.' + p + '3{' + FB + '50% 50%;animation:' + p + 'T 2s steps(10) infinite}.' + p + '3{animation-duration:2.6s;animation-delay:-1.1s}' +
      '@keyframes ' + p + 'A{0%,100%{transform:rotate(10deg)}50%{transform:rotate(-28deg)}}' +
      '@keyframes ' + p + 'T{0%,100%{transform:scale(.4);opacity:.3}50%{transform:scale(1);opacity:1}}',
  },
}

const BRASS_STOPS = "<stop offset='0' stop-color='#E6CB80'/><stop offset='.55' stop-color='#C9A24A'/><stop offset='1' stop-color='#9C7A30'/>"
const MUTED_STOPS = "<stop offset='0' stop-color='#DCCB9A'/><stop offset='.55' stop-color='#B49E6C'/><stop offset='1' stop-color='#8A7650'/>"

/** Seconds per body beat, matched to each role's own loop so prop and body move together. */
const ROLE_TEMPO: Record<Role, number> = {
  scout: 1.2,
  builder: 1.5,
  operator: 1.2,
  tester: 1.8,
  courier: 1.4,
  navigator: 1.4,
  conductor: 1.6,
  keeper: 2.6,
  generic: 2.4,
}

function shadow(cls: string): string {
  return '<ellipse' + cls + " cx='12' cy='29.3' rx='6.4' ry='1.1' fill='" + INK + "' opacity='.22'/>"
}
const LEFT_HAND = "<ellipse cx='3.9' cy='16.6' rx='1.8' ry='1.3' fill='#C9A24A' stroke='" + INK + "' stroke-width='1.1'/>"
const HIGHLIGHT = "<path d='M6.9 8.2C7.6 6.3 9 5.1 10.8 4.8' fill='none' stroke='#F6E7B8' stroke-width='1.1' stroke-linecap='round' opacity='.9'/>"
const VISOR = "<rect x='6.2' y='8' width='11.6' height='6.8' rx='3.3' fill='" + INK + "'/>"
const EYES_OPEN =
  "<rect x='8.3' y='9.3' width='2.7' height='3.5' rx='1.1' fill='#F3E3B0'/><rect x='13' y='9.3' width='2.7' height='3.5' rx='1.1' fill='#F3E3B0'/>" +
  "<rect x='8.8' y='9.8' width='.9' height='.9' fill='#FFFFFF'/><rect x='13.5' y='9.8' width='.9' height='.9' fill='#FFFFFF'/>"
const EYES_HAPPY = "<path d='M8.4 12.2Q9.65 10.4 10.9 12.2M13.1 12.2Q14.35 10.4 15.6 12.2' fill='none' stroke='#F3E3B0' stroke-width='1.2' stroke-linecap='round'/>"
const EYES_LOW =
  "<rect x='8.3' y='11.1' width='2.7' height='1.6' rx='.8' fill='#F3E3B0' opacity='.85'/><rect x='13' y='11.1' width='2.7' height='1.6' rx='.8' fill='#F3E3B0' opacity='.85'/>"
const SMILE = "<path d='M10.9 13.5Q12 14.3 13.1 13.5' fill='none' stroke='#E9D49A' stroke-width='.8' stroke-linecap='round'/>"
const FLAT_MOUTH = "<path d='M11 13.9H13' fill='none' stroke='#E9D49A' stroke-width='.8' stroke-linecap='round'/>"
const CHEEKS =
  "<ellipse cx='7.4' cy='16.8' rx='1.1' ry='.65' fill='#B5703F' opacity='.45'/><ellipse cx='16.6' cy='16.8' rx='1.1' ry='.65' fill='#B5703F' opacity='.45'/>"
const DONE_BADGE =
  "<circle cx='26.4' cy='25.8' r='4.4' fill='#C9A24A' stroke='" + INK + "' stroke-width='1.2'/>" +
  "<path d='M24.4 25.9l1.4 1.4 2.7-2.9' fill='none' stroke='" + INK + "' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/>"
const FAILED_BADGE =
  "<circle cx='26.4' cy='25.8' r='4.4' fill='#A0694A' stroke='" + INK + "' stroke-width='1.2'/>" +
  "<path d='M26.4 23.6V26.2' stroke='#F6E7B8' stroke-width='1.5' stroke-linecap='round'/><circle cx='26.4' cy='28.1' r='.8' fill='#F6E7B8'/>"

function body(p: string): string {
  return (
    "<path d='M4 13C4 7.6 7.6 3.6 12 3.6S20 7.6 20 13V22.4a2 2 0 0 1-4 0a2 2 0 0 1-4 0a2 2 0 0 1-4 0a2 2 0 0 1-4 0Z' fill='url(#" + p +
    "g)' stroke='" + INK + "' stroke-width='1.3' stroke-linejoin='round'/>"
  )
}

/**
 * One crew member: the brass lantern ghost with its role's prop. running
 * loops the role's motion over a squash-and-stretch beat at the role's tempo
 * (at most 8 animated elements, mostly stepped at about 10 fps, durations of
 * 1 s or more); done is a still pose with a gold check badge and happy eyes;
 * failed is a still, muted, slightly slumped pose with a copper badge.
 * Done, failed and still poses have no style and no class: draw them as images
 * (no isInteractive). About 1.8k (still) to 3.8k (running) characters.
 */
export function characterSvg(o: CharacterOptions): string {
  const role: Role = isRole(o.role) ? o.role : 'generic'
  const state: CharacterState = o.state === 'done' || o.state === 'failed' ? o.state : 'running'
  const live = state === 'running' && o.still !== true
  const size = Math.round(clamp(finite(o.size, 20), 16, 28))
  const p = 'gc' + ROLE_CODE[role] + (live ? 'r' : state === 'running' ? 's' : state.charAt(0))
  const c = (name: string) => (live ? " class='" + p + name + "'" : '')
  const kit: Kit = { c, live, p }
  const art = ROLE_ART[role]
  const eyes =
    state === 'done'
      ? EYES_HAPPY
      : state === 'failed'
        ? EYES_LOW
        : live
          ? (art.eyesClass ? '<g' + c(art.eyesClass) + '>' : '') + '<g' + c('e') + '>' + EYES_OPEN + '</g>' + (art.eyesClass ? '</g>' : '')
          : EYES_OPEN
  const out: string[] = [
    SVG_OPEN + "viewBox='0 0 32 32' width='" + size + "' height='" + size + "' role='img' aria-label='" + escapeXml(characterAlt(role, state)) + "'>",
    "<defs><linearGradient id='" + p + "g' x1='0' y1='0' x2='0' y2='1'>" + (state === 'failed' ? MUTED_STOPS : BRASS_STOPS) + '</linearGradient>' + (art.defs ? art.defs(p) : '') + '</defs>',
  ]
  if (live) {
    // Squash and stretch about the feet, the shadow breathing with it; about 10 fps (steps).
    const tempo = ROLE_TEMPO[role]
    const beat = ' ' + tempo + 's steps(' + Math.max(2, Math.round(tempo * 2.5)) + ') infinite}'
    out.push(
      '<style>.' + p + 'b{' + VB + '12px 29px;animation:' + p + 'B' + beat +
        '.' + p + 'w{' + FB + '50% 50%;animation:' + p + 'W' + beat +
        '.' + p + 'e{' + FB + '50% 50%;animation:' + p + 'E 4.2s linear infinite}' +
        '@keyframes ' + p + 'B{0%,100%{transform:translateY(0) scale(1,1)}20%{transform:translateY(0) scale(1.05,.95)}' +
        '50%{transform:translateY(-1.4px) scale(.97,1.04)}75%{transform:translateY(-.4px) scale(1.01,.99)}}' +
        '@keyframes ' + p + 'W{0%,100%{transform:scaleX(1);opacity:.22}50%{transform:scaleX(.8);opacity:.12}}' +
        '@keyframes ' + p + 'E{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.15)}}' +
        art.css(p) + REDUCED + '</style>',
    )
  }
  out.push(shadow(c('w')))
  if (art.desk) out.push(art.desk(kit))
  // A failed step slumps a little; a done one stands straight.
  const pose = state === 'failed' ? " transform='rotate(-5 12 28)'" : c('b')
  out.push('<g' + pose + '>', LEFT_HAND, body(p), HIGHLIGHT, VISOR, eyes, state === 'failed' ? FLAT_MOUTH : SMILE, CHEEKS)
  if (art.held) out.push(art.held(kit))
  out.push(
    '<ellipse' + (art.handClass ? c(art.handClass) : '') + " cx='" + art.hand[0] + "' cy='" + art.hand[1] +
      "' rx='2' ry='1.4' fill='#C9A24A' stroke='" + INK + "' stroke-width='1.1'/>",
    '</g>',
  )
  if (art.front) out.push(art.front(kit))
  if (state === 'done') out.push(DONE_BADGE)
  if (state === 'failed') out.push(FAILED_BADGE)
  out.push('</svg>')
  return out.join('')
}

/** The character of the running-step line: CSS px, the size of the app's own spinner. */
export const SPINNER_PX = 16
/** One grow of the loop, in seconds: from nothing to full size, a short rest, then again. */
export const SPINNER_GROW_S = 1.6

const spinnerSources = new Map<Role, string>()

/**
 * The role character for the desktop's running-step line, in the place of
 * the app's spinner: the role's still running pose, growing from 0% to 100%
 * of its size in a loop (transform only, one direction, never shrinking
 * back), about the middle of the drawing. The same bytes for a role every
 * time (kept, at most one per role), so the desktop loads the frame again
 * only when the role changes. Still at full size under reduced motion.
 */
export function spinnerSvg(role: Role): string {
  const r: Role = isRole(role) ? role : 'generic'
  const kept = spinnerSources.get(r)
  if (kept !== undefined) return kept
  const still = characterSvg({ role: r, state: 'running', size: SPINNER_PX, still: true })
  const cut = still.indexOf('</defs>') + '</defs>'.length
  const p = 'gs' + ROLE_CODE[r]
  const style =
    '<style>.' + p + '{' + VB + '16px 16px;animation:' + p + 'G ' + SPINNER_GROW_S + 's cubic-bezier(.22,.8,.3,1) infinite}' +
    '@keyframes ' + p + 'G{0%{transform:scale(0)}72%,100%{transform:scale(1)}}' + REDUCED + '</style>'
  const source = still.slice(0, cut) + style + "<g class='" + p + "'>" + still.slice(cut, still.length - '</svg>'.length) + '</g></svg>'
  spinnerSources.set(r, source)
  return source
}

/**
 * The terminal's one-cell mark (no Svg there): WGL4 glyphs outside every
 * emoji range, so terminal fonts carry them and the no-emoji test passes.
 */
export function roleGlyph(role: Role, state: CharacterState): string {
  if (state === 'done') return '\u{221A}'
  if (state === 'failed') return '\u{D7}'
  const glyph: Record<Role, string> = {
    scout: '\u{25CB}',
    builder: '\u{25A0}',
    operator: '\u{25BA}',
    tester: '\u{25CA}',
    courier: '\u{2191}',
    navigator: '\u{2192}',
    conductor: '\u{2261}',
    keeper: '\u{2302}',
    generic: '\u{2219}',
  }
  return glyph[isRole(role) ? role : 'generic']
}

// ------------------------------------------------------------------ roles

const CREW_TOOLS = new Set(['Agent', 'Task', 'Workflow', 'TeamCreate', 'TeamDelete'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor'])
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'ApplyPatch'])
const READ_TOOLS = new Set([
  'Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'ToolSearch', 'Skill', 'ListMcpResourcesTool',
  'ReadMcpResourceTool', 'ReadMcpResourceDirTool', 'BashOutput', 'TaskOutput', 'TaskGet', 'TaskList',
])
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch'])
const KEEP_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'CronCreate', 'ScheduleWakeup'])
const SEND_TOOLS = new Set(['SendMessage', 'SendUserFile', 'PushNotification', 'RemoteTrigger'])
const STOP_TOOLS = new Set(['TaskStop', 'KillShell', 'KillBash'])

/** Writes that keep things rather than build them: memory, archives, backups. */
const KEEPER_PATH = /([\\/]memory[\\/]|MEMORY\.md$|[\\/]_arsip[\\/]|[\\/]backups?[\\/]|\.bak$|\.backup$)/i

/** Shell commands, after quoted messages and heredocs are removed; first match wins. */
const SHELL_RULES: readonly (readonly [Role, RegExp])[] = [
  [
    'tester',
    /\b(pytest|py\.test|jest|vitest|mocha|tox|nox|nose2|phpunit|rspec|ctest|unittest|invoke-pester|karma|eslint|ruff|flake8|pylint|mypy|pyright|stylelint|shellcheck|typecheck|clippy)\b|\btsc\b[^|;&\n]*--noemit\b|\bgo\s+vet\b|\bnode\s+--check\b|\bpy_compile\b|\b(npm|pnpm|yarn|bun|deno)\s+(run\s+)?test\b|\b(go|dotnet)\s+test\b|\bcargo\s+(test|nextest)\b|\b(mvn|gradlew?)\b[^|;&\n]*\btest\b|\bmake\s+(test|check)\b|\bnode\s+--test\b|\bplugin\s+(test|validate)\b|\bplaywright\s+test\b|\bcypress\s+run\b|(^|[^a-z])(verify|validate|lint)([^a-z]|$)/,
  ],
  [
    'courier',
    /\bgit\s+(push|commit|tag|merge|rebase|pull|fetch|clone|cherry-pick|am)\b|\bgh\s+(pr|release|repo|workflow|run|issue|gist)\b|(^|[^a-z-])(deploy|publish|release|upload)|\b(scp|sftp|rsync)\b|\bdocker\s+push\b|\bkubectl\s+(apply|rollout)\b|\bterraform\s+apply\b|\bhelm\s+(install|upgrade)\b|\b(vercel|netlify|wrangler|firebase)\b/,
  ],
  ['builder', /\bbundle\s+(install|exec|update|add)\b/],
  [
    'keeper',
    /(^|[^a-z])(backup|bundle|mirror|archive|snapshot)|(^|[^a-z])bak([^a-z]|$)|\b(robocopy|xcopy|copy-item|pg_dump|mysqldump)\b|\bgit\s+stash\b|\b7z\s+a\b|\bzip\b|\btar\s+-?\w*c/,
  ],
  [
    'builder',
    /(^|[^a-z])(install|build|compile|rebuild)|\b(make|cmake|msbuild|gradle|mvn|tsc|webpack|vite|esbuild|rollup|pyinstaller|apply_patch|patch)\b|\bnpm\s+(i|ci)\b|\b(pnpm|yarn)\s+add\b|\bsed\s+-i\b/,
  ],
  ['navigator', /\b(curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm|xh|ping|tracert|traceroute|nslookup|dig)\b/],
  [
    'scout',
    /(^|[;&|(]\s*|\bcd\s+\S+\s*&&\s*)(ls|dir|cat|type|head|tail|less|grep|rg|ag|find|fd|tree|wc|stat|du|df|where|which|get-childitem|gci|get-content|select-string|findstr|jq)\b|\bgit\s+(status|log|diff|show|blame|grep|ls-files|branch|rev-parse|describe)\b/,
  ],
]

/** The command's description (written for the person), when the command said nothing. */
const DESC_RULES: readonly (readonly [Role, RegExp])[] = [
  ['tester', /\b(run|re-?run|execute)s?\b.*\b(tests?|specs?|suite)\b|\b(test suite|unit tests?|smoke test)\b|\b(verify|validate|lint|typecheck|type-check)/],
  ['courier', /\b(push|commit|deploy|publish|release|upload|send)\b/],
  ['keeper', /\b(back ?up|backup|bundle|mirror|archive|snapshot)\b/],
  ['builder', /\b(install|build|compile|rebuild)\b/],
  ['navigator', /\b(download|browse|curl)\b/],
  ['scout', /\b(list|show|read|search|find|count|inspect|look|check|view|print)\b/],
]

/** MCP tool names (server and tool), first match wins. */
const MCP_RULES: readonly (readonly [Role, RegExp])[] = [
  ['navigator', /browser|chrome|navigat|devtools|tabs?_|click|screenshot|web_?(fetch|search)|page/],
  ['courier', /send|publish|post_|upload|push|deploy|share|merge|create_pr|release|email|notif/],
  ['keeper', /backup|snapshot|archive|export|memory|store|save|bookmark|checkpoint/],
  ['tester', /test|verify|validat|lint|audit/],
  ['operator', /terminal|shell|run_in|exec|command|process/],
  ['builder', /write|edit|update|create|insert|append|set_|rename|patch|delete|trash|move|copy/],
  ['scout', /search|find|list|get|read|query|fetch|inspect|describe|status|info|show|lookup|view/],
]

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function firstMatch(rules: readonly (readonly [Role, RegExp])[], text: string): Role | undefined {
  for (const [role, re] of rules) if (re.test(text)) return role
  return undefined
}

/** Drops commit messages, echoed text and heredoc bodies, so words in them do not decide the role. */
function commandWords(command: string): string {
  return command
    .replace(/<<-?\s*['"]?([A-Za-z_][\w-]*)['"]?[^\n]*\n[\s\S]*?\n\s*\1\b/g, ' ')
    .replace(/(\s-m|\s--message[=\s]|\becho|\bprintf|\bwrite-host|\bwrite-output)\s*('[^']*'|"(?:[^"\\]|\\[\s\S])*")/gi, '$1 ""')
    .toLowerCase()
}

function shellRole(command: string, description: string): Role {
  // Bounded input: the classifier runs on every tool call and must stay cheap.
  return (
    firstMatch(SHELL_RULES, commandWords(command.slice(0, 4000))) ??
    firstMatch(DESC_RULES, description.slice(0, 400).toLowerCase()) ??
    'operator'
  )
}

function artifactRole(action: string): Role {
  if (action === '' || action === 'publish' || action === 'upload_asset' || action === 'pin') return 'courier'
  if (action === 'write_db') return 'keeper'
  if (action === 'delete_asset' || action === 'unpin') return 'builder'
  return 'scout'
}

/**
 * The crew role for one tool call, from its name and input (the tool.call
 * envelope or the ToolUse row's input; read defensively, never trusted).
 * Bash / PowerShell / Monitor: test runners are tester; git push / commit /
 * clone, gh, deploy / publish / release are courier; backup / bundle / mirror /
 * archive / robocopy are keeper; install / build / compile are builder; curl /
 * wget are navigator; ls / cat / grep / git status are scout; anything else is
 * operator. Agent and Workflow are conductor.
 */
export function classifyRole(tool: string, input?: unknown): Role {
  const name = String(tool ?? '')
  const o: Record<string, unknown> = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  if (CREW_TOOLS.has(name)) return 'conductor'
  if (SHELL_TOOLS.has(name)) {
    const role = shellRole(str(o['command']), str(o['description']))
    // A Monitor watches: its tail / grep is the operator's work, not a scout's.
    return name === 'Monitor' && role === 'scout' ? 'operator' : role
  }
  if (WRITE_TOOLS.has(name)) {
    return KEEPER_PATH.test(str(o['file_path']) || str(o['notebook_path']) || str(o['path'])) ? 'keeper' : 'builder'
  }
  if (READ_TOOLS.has(name)) return 'scout'
  if (WEB_TOOLS.has(name)) return 'navigator'
  if (KEEP_TOOLS.has(name)) return 'keeper'
  if (SEND_TOOLS.has(name)) return 'courier'
  if (STOP_TOOLS.has(name)) return 'operator'
  if (name === 'Artifact') return artifactRole(str(o['action']))
  if (name.startsWith('mcp__')) return firstMatch(MCP_RULES, name.toLowerCase()) ?? 'generic'
  return 'generic'
}

// ------------------------------------------------------------------ the crew pane
//
// The Ghost Crew pane mirrors the app's Background tasks list from Ghost's own
// tracker (event hooks write it, renders only read it). Opened by
// $.ui.open({ id: 'ghost-crew', title: 'Ghost Crew' }) from a band Button or a
// command, never unasked:
//
//   [24px idle ghost]  Ghost Crew          2 running, 14 finished    [Close]
//   Running (2)
//   [20px, animated]  Run unit tests               Bash      1m   running
//   [20px, animated]  Review the diff              Agent    <1m   running
//   Finished (14)
//   [20px, done]      hooks/art.ts                 Read     0.8s
//   [20px, failed]    Push branch to origin        Bash   2m 15s  failed
//   +2 more finished
//
// - A row is a Box (row, columnGap 1, alignItems center): the character Svg,
//   the label Text (flexGrow 1, wrap 'truncate-end'), the tool Text (dim), the
//   time Text (dim), and a status Text only when it is not "done" (failed in
//   the theme's error color, stopped dim). An Agent row is a Button keyed by its
//   id; its press calls $.ui.view({ agentId }).
// - Running, newest first: the first 6 animated (isInteractive), up to 6 more as
//   still images, then "+N more running". Finished, newest first: the last 20.
// - Widget seat (props.placement 'widget'): one line, at most 3 animated:
//   the lead character, then "2 running, last: Run unit tests 12s".
// - Every row keeps the same nesting (pane, section Box, row Box, Svg) so the
//   desktop keeps each frame across redraws; no hover Box around an animated
//   Svg; the Svg alt is characterAlt(role, pose), never the changing label.
// - Terminal: roleGlyph(role, pose) as a one-cell Text in place of the Svg.
//
// The running-step line (ui.render on Spinner, desktop): spinnerSvg(role), a
//   16px character in the place of the app's own mark, in front of the line's
//   words. One source per role, never per step, so the frame is loaded again
//   only when the role changes. No character is added to tool rows (2.5).
// - crewArt(role, pose, surface, px, still) says exactly what to draw on each
//   surface in the pane (an Svg source with its alt, size and isInteractive,
//   or a terminal glyph and its tone); stepLabel(tool, input) gives the label.
// - Every source here is byte-stable.

export type CrewStatus = 'running' | 'done' | 'failed' | 'interrupted' | 'killed'

/** One step as the tracker keeps it (written by event hooks, never by a render). */
export type CrewStep = {
  /** tool_use_id; for a background task, the call that launched it. */
  id: string
  tool: string
  /** What the app's Background tasks list says: Bash description, Agent description, workflow name, Monitor description. */
  label: string
  role: Role
  status: CrewStatus
  startedAt: number
  endedAt?: number
  agentId?: string
}

/** One drawn row of the Ghost Crew pane. */
export type CrewRow = {
  id: string
  role: Role
  /** The character to draw: characterSvg({ role, state: pose, still: !animated }). */
  pose: CharacterState
  /** Draw with isInteractive (animated); false draws the still image. */
  animated: boolean
  label: string
  tool: string
  /** Running: coarse ("<1m", "4m"), so the pane never redraws per second; finished: "0.8s", "12s", "1m 05s". */
  time: string
  /** "running", "done", "failed" or "stopped". */
  status: string
  agentId?: string
}

/** The layout numbers of the Ghost Crew pane and the transcript marks. */
export const CREW_SPEC = {
  paneId: 'ghost-crew',
  paneTitle: 'Ghost Crew',
  /** Running rows drawn animated; the rest of the running rows are still poses. */
  animatedRows: 6,
  /** In a desktop widget seat. */
  widgetAnimatedRows: 3,
  /** Still running rows before a "+N more running" line. */
  stillRunningRows: 6,
  /** Finished rows kept on screen (newest first). */
  finishedRows: 20,
  /** Character px: pane rows, pane header, transcript rows. */
  paneCharacterPx: 20,
  headerCharacterPx: 24,
  transcriptCharacterPx: 16,
  /** Crew-state writes are batched to at most this many per second. */
  writesPerSecond: 4,
  /** Running times are re-read on this coarse tick while the pane is shown and a step runs. */
  coarseTickMs: 15_000,
  /** Every animated Svg in view at once: pane + band + transcript. */
  maxAnimatedInView: 8,
  /** Characters in a row label (stepLabel). */
  labelMax: 80,
} as const

function pad2(v: number): string {
  return v < 10 ? '0' + v : String(v)
}

/** "0.8s", "12s", "1m 05s", "2h 03m"; coarse: "<1m", "4m", "2h 03m". */
export function formatElapsed(ms: number, coarse = false): string {
  const t = Math.max(0, finite(ms, 0))
  const s = Math.floor(t / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return h + 'h ' + pad2(m % 60) + 'm'
  if (coarse) return m === 0 ? '<1m' : m + 'm'
  if (m > 0) return m + 'm ' + pad2(s % 60) + 's'
  if (t < 10_000) return (Math.floor(t / 100) / 10).toFixed(1) + 's'
  return s + 's'
}

const STATUS_WORD: Record<CrewStatus, string> = {
  running: 'running',
  done: 'done',
  failed: 'failed',
  interrupted: 'stopped',
  killed: 'stopped',
}

/**
 * The Ghost Crew pane's two sections, newest first. Running rows past
 * opts.animated are still poses; running rows past animated + still, and
 * finished rows past opts.finished, are only counted (draw "+N more").
 */
export function crewSections(
  steps: readonly CrewStep[],
  now: number,
  opts: { animated?: number; finished?: number } = {},
): { running: CrewRow[]; finished: CrewRow[]; moreRunning: number; moreFinished: number } {
  const animatedCap = Math.max(0, finite(opts.animated, CREW_SPEC.animatedRows))
  const finishedCap = Math.max(0, finite(opts.finished, CREW_SPEC.finishedRows))
  const row = (s: CrewStep, animated: boolean): CrewRow => {
    const isRunning = s.status === 'running'
    const ms = isRunning ? now - s.startedAt : (s.endedAt ?? now) - s.startedAt
    const r: CrewRow = {
      id: s.id,
      role: isRole(s.role) ? s.role : 'generic',
      pose: isRunning ? 'running' : s.status === 'done' ? 'done' : 'failed',
      animated,
      label: cleanText(s.label) || s.tool,
      tool: s.tool,
      time: formatElapsed(ms, isRunning),
      status: STATUS_WORD[s.status] ?? 'done',
    }
    if (s.agentId !== undefined) r.agentId = s.agentId
    return r
  }
  const running = steps.filter(s => s.status === 'running').sort((a, b) => b.startedAt - a.startedAt)
  const finished = steps
    .filter(s => s.status !== 'running')
    .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
  const shownRunning = running.slice(0, animatedCap + CREW_SPEC.stillRunningRows)
  return {
    running: shownRunning.map((s, i) => row(s, i < animatedCap)),
    finished: finished.slice(0, finishedCap).map(s => row(s, false)),
    moreRunning: running.length - shownRunning.length,
    moreFinished: Math.max(0, finished.length - finishedCap),
  }
}

/**
 * A step's row label, worded as the app's Background tasks list words it:
 * the Bash, PowerShell or Monitor description (else the command), the Agent
 * description, the Workflow's meta.name, an MCP tool's own name, else the
 * tool and its target (the last two path segments, a pattern, a URL or a
 * query). One clean line of 80 characters at most.
 */
export function stepLabel(tool: string, input?: unknown): string {
  const name = String(tool ?? '')
  const o: Record<string, unknown> = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const pick = (key: string) => cleanText(str(o[key]))
  let label = ''
  if (SHELL_TOOLS.has(name)) label = pick('description') || pick('command')
  else if (name === 'Workflow') {
    const m = /\bmeta\s*=\s*\{[\s\S]*?\bname\s*:\s*(['"])([^'"\n]*)\1/.exec(str(o['script']).slice(0, 4000))
    label = cleanText(m?.[2] ?? '') || pick('name')
  } else if (CREW_TOOLS.has(name)) label = pick('description') || pick('name') || pick('subagent_type')
  else if (name.startsWith('mcp__')) label = cleanText((name.split('__').pop() ?? '').replace(/[_-]+/g, ' '))
  else {
    const path = str(o['file_path']) || str(o['notebook_path']) || str(o['path'])
    const target = cleanText(
      path.split(/[\\/]+/).filter(s => s !== '').slice(-2).join('/') || str(o['pattern']) || str(o['url']) || str(o['query']) || str(o['task_id']),
    )
    label = pick('description') || (target === '' ? '' : name + ' ' + target)
  }
  const chars = Array.from(label || cleanText(name) || 'Step')
  return chars.length > CREW_SPEC.labelMax ? chars.slice(0, CREW_SPEC.labelMax - 1).join('').trimEnd() + ELLIPSIS : chars.join('')
}

/** What to draw for one step on one surface (crewArt). */
export type CrewArt =
  | { kind: 'svg'; source: string; alt: string; width: number; height: number; isInteractive: boolean }
  | { kind: 'glyph'; text: string; alt: string; tone: 'brass' | 'dim' | 'copper' }

/**
 * The mark for one step on one surface. desktop: a running step is an
 * animated source in a frame (isInteractive) unless still is asked (off
 * screen, past the animated cap, a "still crew" setting); every other pose is
 * a still image. vscode always draws an image, where CSS can run. terminal
 * and mobile: one glyph cell (the terminal has no Svg; mobile shows a quiet
 * line), toned brass while running, dim when done, copper when failed.
 */
export function crewArt(role: Role, pose: CharacterState, surface: string, size: number = CREW_SPEC.transcriptCharacterPx, still = false): CrewArt {
  const r: Role = isRole(role) ? role : 'generic'
  const s: CharacterState = pose === 'done' || pose === 'failed' ? pose : 'running'
  const alt = characterAlt(r, s)
  if (surface !== 'desktop' && surface !== 'vscode') {
    return { kind: 'glyph', text: roleGlyph(r, s), alt, tone: s === 'running' ? 'brass' : s === 'done' ? 'dim' : 'copper' }
  }
  const px = Math.round(clamp(finite(size, CREW_SPEC.transcriptCharacterPx), 16, 28))
  const animate = s === 'running' && still !== true
  return {
    kind: 'svg',
    source: characterSvg({ role: r, state: s, size: px, still: !animate }),
    alt,
    width: px,
    height: px,
    isInteractive: animate && surface === 'desktop',
  }
}
