export type GhostPhase = 'idle' | 'working' | 'done' | 'error'

/** What the band and the Ghost pane show; session memory only, never on disk. */
export type GhostView = {
  phase: GhostPhase
  /** The exact draft Ghost started from, kept for Undo. */
  original?: string
  /** The improved prompt. */
  result?: string
  /** Ghost's short notes for the person (roles, placeholders, conflicts). */
  notes?: string
  /** True while the improved prompt is the one Ghost put in the prompt box. */
  placed?: boolean
  /** True after Undo put the original back. */
  undone?: boolean
  /** The last short status line. */
  message?: string
}

declare module 'claude-code' {
  interface PluginState {
    ghost: { view: Shaped<GhostView> }
  }
}
