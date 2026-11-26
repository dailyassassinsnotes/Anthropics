// Test helper (2.5.1): reads the band's ghost and its native pill out of the
// drawn tree.
//
// The row's first child is the ghost (an Svg whose source never changes), the
// second the pill: a bordered Box with the sparkle strip (an Svg whose source
// never changes), Text children (the label, then a divider, the percent and
// the line while a figure shows) and, while no figure shows, the ticker: a Box
// holding one Svg whose alt is the text that runs in it.

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const node = (value: unknown): Node => (typeof value === 'object' && value !== null ? (value as Node) : {})
const kidsOf = (n: Node): Node[] => (n.children ?? []).map(node)

/** The text a node draws: its string children, joined. */
export const flat = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : Array.isArray(value)
      ? value.map(flat).join('')
      : typeof value === 'object' && value !== null
        ? flat((value as Node).children ?? (value as Node).props?.['children'] ?? '')
        : ''

/** Every element of a drawn tree, the root first. */
export function allNodes(tree: unknown): Node[] {
  const out: Node[] = []
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk)
    if (typeof value !== 'object' || value === null) return
    const n = value as Node
    if (typeof n.type === 'string') out.push(n)
    walk(n.children)
    walk(n.props?.['children'])
  }
  walk(tree)
  return out
}

export type PillNow = {
  /** True when the band has a pill (false in a terminal). */
  has: boolean
  /** The row's children as `Type:key`. */
  row: string[]
  /** The pill Box's props. */
  box: Record<string, unknown>
  /** The pill's children as their types, in order. */
  kinds: string[]
  /** The pill's Text children, in order. */
  texts: string[]
  label: string
  /** "42%", or '' when no figure shows. */
  percent: string
  /** What follows the label: the figure's line as Text, or the text the ticker runs (its alt); '' when nothing. */
  line: string
  /** "42% mixing the potion" while a figure shows, else ''. */
  figure: string
  /** The source of every Svg of the whole band, in drawing order. */
  sources: string[]
  /** The ghost's Svg node and the sparkle strip's. */
  ghost: Node | undefined
  spark: Node | undefined
  /** The ticker's source, or '' while a figure shows. */
  ticker: string
  /** The ticker's Svg node and the Box around it. */
  tickerSvg: Node | undefined
  tickerBox: Node | undefined
}

export function pillOf(tree: unknown): PillNow {
  const root = node(tree)
  const kids = kidsOf(root)
  const row = kids.map(k => `${k.type}:${String(k.props?.['key'] ?? '')}`)
  const sources = allNodes(tree)
    .filter(n => n.type === 'Svg')
    .map(n => String(n.props?.['source'] ?? ''))
  const ghost = kids[0]?.type === 'Svg' ? kids[0] : undefined
  const box = kids[1]?.type === 'Box' ? kids[1] : undefined
  if (ghost === undefined || box === undefined) {
    return { has: false, row, box: {}, kinds: [], texts: [], label: '', percent: '', line: '', figure: '', sources, ghost: undefined, spark: undefined, ticker: '', tickerSvg: undefined, tickerBox: undefined }
  }
  const parts = kidsOf(box)
  const texts = parts.filter(p => p.type === 'Text').map(flat)
  const label = texts[0] ?? ''
  const after = texts[1] === '|' ? texts.slice(2) : []
  const percent = /^\d+%$/.test(after[0] ?? '') ? (after[0] ?? '') : ''
  const tickerBox = parts.find(p => p.type === 'Box')
  const tickerSvg = tickerBox === undefined ? undefined : kidsOf(tickerBox).find(p => p.type === 'Svg')
  const said = String(tickerSvg?.props?.['alt'] ?? '')
  const line = percent !== '' ? (after[1] ?? '') : said === 'Ghost sparkles' ? '' : said
  return {
    has: true,
    row,
    box: box.props ?? {},
    kinds: parts.map(p => String(p.type ?? '')),
    texts,
    label,
    percent,
    line,
    figure: percent === '' ? '' : `${percent} ${line}`,
    sources,
    ghost,
    spark: parts.find(p => p.type === 'Svg'),
    ticker: String(tickerSvg?.props?.['source'] ?? ''),
    tickerSvg,
    tickerBox,
  }
}

/** The band's pill now. */
export async function pillNow(ui: { drawn: () => Promise<unknown> }): Promise<PillNow> {
  return pillOf(await ui.drawn())
}

type Ui = {
  drawn: () => Promise<unknown>
  find: (query: { type: string; key?: string }) => Promise<{ props: Record<string, unknown> } | undefined>
  press: (query: { key: string }) => Promise<unknown>
  select: (pick: { key: string; value: string }) => Promise<unknown>
}

/** Runs Ghost from the band: the dropdown's Ghost row on a desktop, the Ghost button elsewhere. */
export async function go(ui: Ui): Promise<unknown> {
  const menu = await ui.find({ type: 'Select', key: 'ghost-menu' })
  return menu === undefined ? ui.press({ key: 'ghost' }) : ui.select({ key: 'ghost-menu', value: 'ghost' })
}

/** How many Ghost controls the band has: the dropdown or the button (0 while Stop stands there). */
export async function hasGhost(ui: Ui): Promise<number> {
  return ((await ui.find({ type: 'Select', key: 'ghost-menu' })) === undefined ? 0 : 1) + ((await ui.find({ type: 'Button', key: 'ghost' })) === undefined ? 0 : 1)
}

/**
 * The Ghost control's name: the Ghost button's label, or the label of the
 * dropdown's Ghost row (2.5.1: the dropdown has no caption of its own);
 * undefined when the band has neither.
 */
export async function ghostLabel(ui: Ui): Promise<unknown> {
  const menu = await ui.find({ type: 'Select', key: 'ghost-menu' })
  if (menu === undefined) return (await ui.find({ type: 'Button', key: 'ghost' }))?.props['label']
  const rows = (menu.props['options'] ?? []) as { value?: string; label?: string }[]
  return rows.find(row => row.value === 'ghost')?.label
}

/** The caption a desktop draws left of the dropdown: its `label` prop; undefined when it has none. */
export async function menuCaption(ui: Ui): Promise<unknown> {
  return (await ui.find({ type: 'Select', key: 'ghost-menu' }))?.props['label']
}

/** The test clock, counting the time it was moved on. */
export function timed<T extends { advance: (ms: number) => Promise<unknown>; settle: () => Promise<unknown> }>(
  clock: T,
): { advance: (ms: number) => Promise<unknown>; settle: () => Promise<unknown>; elapsed: () => number } {
  let total = 0
  return {
    advance: (ms: number) => {
      total += ms
      return clock.advance(ms)
    },
    settle: () => clock.settle(),
    elapsed: () => total,
  }
}
