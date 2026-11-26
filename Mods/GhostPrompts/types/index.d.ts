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

export type GhostCrewRole =
  | 'scout'
  | 'builder'
  | 'operator'
  | 'tester'
  | 'courier'
  | 'navigator'
  | 'conductor'
  | 'keeper'
  | 'generic'

export type GhostCrewStatus = 'running' | 'done' | 'failed' | 'interrupted' | 'killed'

/** One step the Ghost Crew pane lists; session memory only, never on disk. */
export type GhostCrewStep = {
  /** The tool call's id (tool_use_id). */
  id: string
  tool: string
  /** A short description: the Bash or Agent description, a file name, a pattern. */
  label: string
  role: GhostCrewRole
  status: GhostCrewStatus
  startedAt: number
  endedAt?: number
  /** The loop the call ran in; absent on the main loop. */
  loop?: string
  /** Set while a background job the call launched still runs: shell or task id, or the agent's id. */
  taskId?: string
  kind?: 'shell' | 'agent' | 'workflow' | 'monitor'
}

/** The project tips the pill shows; the same list is cached in the mod's store per project folder. */
export type GhostTips = {
  /** The folder the tips are about. */
  cwd: string
  tips: string[]
  /** When they were written, in $.clock.now() milliseconds; 0 when none. */
  at: number
}

/**
 * The figure shown while a prompt is improved, as text inside the pill;
 * session memory only. Simulated: the engine reports no progress of a model request.
 */
export type GhostProgress = {
  /** 0 to 100; 100 only once the improved prompt is ready. */
  pct: number
  /** Which variant of each range's line this run shows. */
  pick: number
  /** The copy of the mod's code that wrote it: a figure from an earlier copy is not shown. */
  load: string
  /** When 100% was written, in $.clock.now() milliseconds. */
  at?: number
}

declare module 'claude-code' {
  interface PluginState {
    ghost: {
      view: Shaped<GhostView>
      crew: Shaped<GhostCrewStep[]>
      tips: Shaped<GhostTips>
      progress: GhostProgress | null
      /** How many picks the Ghost dropdown has taken: each one puts it back on its resting row; session memory only. */
      menu: number
    }
  }
}
