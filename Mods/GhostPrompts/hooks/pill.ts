// The band's pill since 2.5: a native Box with native Text in it.
//
// Why native. A desktop draws an <Svg isInteractive> in a sandboxed frame and
// loads that frame again whenever its source changes: the drawing is gone for
// an instant (a blink). Up to 2.4.1 the pill was such a drawing and its source
// changed at the press, at a question, at 100% and at the end. Native text
// changes with no frame at all, so everything that changes while Ghost works
// (the label, the figure at every percent) is Text.
//
// Since 2.5.1 the tips and a done / error line run in a ticker, a drawing of
// its own inside the pill (ticker.ts): its source depends on the tips and the
// pill's width only, it is not drawn while Ghost works, and no timer turns a
// page any more.
//
// What this file holds: the pill's layout in character columns (pure).

/** The pill's colours: the charcoal glass, its gold rim, the champagne text. */
export const PILL_INK = { fill: '#1F1B16', rim: '#C9A24A', text: '#F6E7B8' } as const

/** The pill's label when the room is too small for the full one. */
export const SHORT_LABEL = 'Ghost'
/** The thin divider between the label and what follows it. */
export const DIVIDER = '|'

/**
 * The pill's size in character columns (a desktop draws a Box's `width` in
 * `ch`). `beside`: what the ghost, the Ghost control and one more button take
 * of the band. `chrome`: the pill's own padding, rim, sparkle strip, divider and
 * gaps, with 2 columns to spare (the app's font is proportional). `figure`:
 * the longest progress figure ("100% polishing magic words" is 26).
 */
export const PILL_COLS = { min: 46, max: 92, beside: 36, chrome: 12, figure: 28 } as const

/** The pill's one width for a band of `bodyColumns` columns: the same in every phase, so the row never shifts. */
export function pillCols(bodyColumns: number): number {
  const room = Number.isFinite(bodyColumns) ? Math.floor(bodyColumns) - PILL_COLS.beside : PILL_COLS.min
  return Math.max(PILL_COLS.min, Math.min(PILL_COLS.max, room))
}

/**
 * The label the pill shows and the room (characters) left after it for the
 * figure or the ticker: the full label where it leaves at least `need`
 * characters, the short one otherwise.
 */
export function pillWords(cols: number, label: string, need: number = PILL_COLS.figure): { label: string; room: number } {
  const roomAfter = (text: string) => cols - PILL_COLS.chrome - text.length
  const words = label.trim()
  if (words !== '' && roomAfter(words) >= need) return { label: words, room: roomAfter(words) }
  return { label: SHORT_LABEL, room: Math.max(12, roomAfter(SHORT_LABEL)) }
}

/** The least room (characters) the tips' ticker needs beside the full label; with less, the label is the short one. */
export const TIP_ROOM = 24
