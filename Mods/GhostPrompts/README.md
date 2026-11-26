# Ghost — Prompt Master for Claude Code

Ghost turns a rough, incomplete or unclear prompt into a precise, ready-to-send
prompt. It never sends anything: you review the result and press Enter yourself.

## Installation

```bash
claude plugin marketplace add dailyassassinsnotes/Anthropics
claude plugin install ghost@ghostprompts-mods
```

Requires Claude Code with mod (hooks-module plugin) support. Restart the app, or open a new session, after installing.

## New in 2.5.1

- **The tips run as a ticker, right to left.** The tips are one line that moves from right to left at a steady 45 px a second and comes around again with no jump and no gap (the line is drawn twice, one strip apart, and moves by exactly one strip), with a small gold dot between tips and a soft fade at both ends. One short tip that fits stands still. A done or error line that is longer than the pill runs the same way. Under reduced motion nothing moves and the first tip stands readable at the start.
- **The sparkles stream left to right again.** Gold glints cross the ticker from left to right, fading in and out, in a layout seeded by the tips (so it looks random and never changes between redraws). With no tips the pill shows the glints alone.
- **Still no blink at the press.** The ticker is one drawing inside the native pill, and its bytes depend on the tips and the pill's width only, so it is not loaded again while Ghost is idle. While Ghost works it is not drawn: the label and the percentage are native text as in 2.5, and the small sparkle strip at the pill's left is the same bytes in every phase, so nothing is loaded from the press to 100%. When a run ends or is stopped the ticker is loaded once and comes in with a 160 ms fade.
- **The dropdown stands directly right of the pill**, on the same line, and the word `Ghost` in front of it is gone. On the desktop the row no longer wraps: where the window is too narrow the pill gives way, so the dropdown cannot fall under it.
- **No page timer.** The 5 second timer that turned the pages of a tip is removed; the band has no timer of its own while Ghost is idle.

## New in 2.5

- **No blink at all.** The pill is no longer a drawing. It is a native box (round gold rim, dark fill) with native text in it: the label, a thin divider, then the tip, the progress figure or a message. Native text changes without loading anything, so pressing Ghost, a question, 100%, Stop and an error change the words and nothing else. The only drawings left in the row are the ghost and one small sparkle inside the pill, and both are the same bytes in every phase.
- **The percentage counts 1% at a time** (0%, 1%, 2% ...) as text, with the same fun lines, and stands still while a question is open. It is still a simulated figure.
- **Tips and long messages are shown a page at a time** (until 2.5.1, which runs them as a ticker; see above). A tip or a message longer than the pill is split between words (nothing is cut, no ellipsis) and the pill shows one page for about 5 seconds, then the next, in reading order, then the first again. It never runs back and forth. One slow timer does this, only while there is more than one page and the row is drawn; it does not run while Ghost works.
- **The Ghost button is a dropdown on the desktop.** It read `Ghost` in front (removed in 2.5.1) and opens two choices: **Ghost** (improve the draft, the same as the old button) and **Show** (open the Ghost pane). After a choice it goes back to its resting row (`Menu`), which the app's dropdown needs: a dropdown always has one row selected, and choosing the selected row again does nothing. While Ghost works a **Stop** button stands in its place. The terminal keeps the Ghost button.
- **The Crew button is gone from the row.** `/ghost-crew` opens the Ghost Crew pane.
- **The role character stands in the app's running-step line (desktop)**, in the place of the app's own spinner, about the spinner's size (16 px), growing from 0% to 100% in a loop. No character is drawn beside tool rows any more. The price: on that line the app draws its own elapsed time only for its own spinner, so the time is not shown there while Ghost's character is. The small icons of the app's task list and the Background tasks panel cannot be changed by a mod, so they are the app's own.
- The line `Ghost could not improve the prompt: Ghost could not read the model reply. Your draft is unchanged.` no longer has two periods.

## New in 2.4

- No blink when you press Ghost. The ghost character is its own drawing that never changes, so it never goes away. The pill keeps one width while Ghost is idle, counts and shows 100%, so the row does not shift. When the pill's content changes, the old pill stays for about a third of a second while the new one loads in the same spot, and each new pill fades in softly (no fade with reduced motion).
- The ghost breathes a little while it floats.
- A model reply whose tags come inside a Markdown code fence, or with spaces inside the tag brackets, is now read. A reply without the tags is still an error: plain text is never taken for the prompt.

## New in 2.3.1

- The percentage in the pill counts 1% at a time (1%, 2%, 3% ...), never down, and the pill no longer flickers: the count runs inside the drawing, so the pill is not redrawn per percent (only when a question opens or is answered, and at 100%).

## New in 2.3

- No ellipsis in the tips ticker. A long tip is still cut into pages at word boundaries, but no mark is drawn in place of text, and the next part of the same tip follows close behind (12 px) so it reads as one sentence. The pause between two different tips is unchanged.
- While Ghost works, the Ghost button is a **Stop** button. Stop cancels the run: the model call is aborted, nothing is put in the prompt box, your draft stays as it was, and one line says `Ghost stopped. Your draft is unchanged.` It works the same for `/ghost <text>` and the Ghost pane. A clarifying question that is open when you press Stop stays on screen until you close it (a mod cannot close it); its answer is not used.
- The progress line (`45% untangling spaghetti`) is drawn inside the pill, where the tips are when Ghost is idle. In the pill the percentage moves in steps of 5% (and 100% at the end), so the pill's animation is not restarted on every percent. A terminal shows `Stop` and the line as text, every percent.

## New in 2.2

- The pill is back to the 2.0 look: the label "Improve the draft below", a thin divider, then project tips shown one at a time, each pausing so it can be read; long tips are paged at word boundaries.
- On desktop the Ghost button is the app's own button, the same element as Crew, so both have the same height, padding and type. It turns gold (#AA8231, ink #17130C) while the pointer is on it; a desktop does not paint a mod's colour on a button at rest.
- Kept from 2.1: the 0% to 100% progress with fun lines in the Ghost button, the Crew panel redraw fix.

## What Ghost is

Ghost is an adaptive prompt-engineering system. For each draft it:

1. Classifies the task (software, servers, security, data/AI, research, writing,
   teaching, business, design, image/video, decisions, …).
2. Checks objective, audience, context, deliverable, format, constraints and
   success criteria. If a gap would materially change the result it asks up to
   **three** short questions, each with suggested answers and a free-text
   "Other". Otherwise it asks nothing.
3. Picks the smallest set of expert roles that add real value (for example
   software architect + full-stack engineer + UI/UX designer + security reviewer
   for a website) and, where useful, the methods to apply (root-cause analysis,
   first-principles reasoning, trade-off and edge-case analysis, …).
4. Rewrites the prompt with only the sections that help: Role, Context, Task,
   Inputs, Constraints, Format, Check.
5. Checks the result: intent kept, every fact and literal input (quotes, names,
   numbers, URLs, code, paths) preserved exactly, gaps marked as `[PLACEHOLDERS]`,
   no invented facts, no contradictions, complexity matched to the task.

The full specification Ghost sends to the model is `GHOST_SYSTEM` in
`hooks/core.ts`.

## How to use it

- **Button:** type a draft in the prompt box, then, in the row directly above
  the prompt box, open the **Ghost** dropdown and choose **Ghost** (desktop), or
  press the gold **Ghost** button (terminal). Ghost replaces the draft with the
  improved prompt. Press **Undo** to get your original back, **Use improved** to
  swap again; **Show** (in the dropdown on the desktop) opens the Ghost pane.
- **Commands:** `/ghost <your rough prompt>` or `/prompt-master <your rough prompt>`.
  The result goes into the prompt box (or into the output and the Ghost pane
  where the box cannot be written). `/ghost-undo` puts your original draft back.
- **Ghost pane:** shows the improved prompt, Ghost's notes, your original draft,
  buttons to put the prompt in the box, copy it or restore the original, and a
  field to type a prompt when the app does not share its prompt box with Ghost.

## New in 2.1

- **One tight row.** The row above the prompt is the ghost, the pill, the gold
  **Ghost** button and the other buttons directly beside it, from the left;
  nothing is pushed to the far edge and the pill has a smaller cap. What did
  not change: the row is still in the band above the prompt box, and that
  band's box (full width, the app's own fill) is drawn by the app. In the Code
  tab of desktop 5.11492.5.0 the app asks a mod for no drawing below the prompt
  box (read from the app's files: the hint line under the prompt is drawn in
  the Cowork composer only, one text line high), so Ghost cannot sit beside the
  model picker there. The buttons stay beside the pill because of how that
  desktop version lays a row out, not because of a rule the plugin API states;
  a desktop update may change it. Not yet looked at in the running app.
- **Running text.** Text that fits the pill stands still, centred. Longer text
  (a long message, the project tips) runs right to left at 45 px/s and comes
  in again from the right: two copies a gap apart, so the loop has no jump and
  never runs backwards, fading at both ends of its window. Under reduced
  motion nothing moves and the text is shown still, cut to the pill.
- **Sparkles.** Gold glints stream left to right across the pill, each on its
  own height, size, strength and pace, from a layout seeded by the pill's text
  (the same text gives the same drawing). Fewer and slower while idle, more
  and faster while Ghost works; 24 animated elements at most. The Ghost pane's
  working art shows the same stream.
- **Gold Ghost button on the desktop.** A desktop draws its own native button
  and the label in the app's own text colour; a mod cannot colour that label
  at rest. Solid gold under it would be too weak to read in the dark theme
  (3.5:1 at best), so at rest the button is a gold rim around a gold glass
  (gold at a quarter strength: the label reads in the dark and the light
  theme), and solid gold with the dark ink label while the pointer is on it.
  Presses and the keyboard work as before. This is built from the plugin API
  and the desktop's own drawing rules and has not yet been looked at in the
  running app. The terminal shows the ink-on-gold label as before.
- **Progress in the button.** While Ghost improves a prompt (button, `/ghost`
  or the pane field) the Ghost button reads a percentage and a short line, for
  example `42% mixing the potion`, from 0% to 100%, then `Ghost` again. The
  figure is simulated: the app reports no progress of a model request. It eases
  toward 91%, stands still while a question is open (a run below 50% steps up
  to 50% when its first question opens: the first of two model requests is
  back), and reaches 100% only when the improved prompt is ready and shown; a
  failed run never shows 100%. A second press while Ghost works starts
  nothing. Where the app gives a mod no clock, the button shows 0% and then
  `Ghost` again, with no 100%.

## New in 2.0

- **Project tips in the pill.** While Ghost is idle, the pill above the prompt
  shows `Improve the draft below` and then a slow ticker of 4 to 6 short tips
  about the project in the session's folder (not about Ghost). Since 2.1 the
  tips run right to left without a rest; under the system's reduced-motion
  setting nothing moves and the first tip is shown, cut to its window.
  Working, done and error messages still take the whole pill. The terminal
  has no pill and shows no tips.
- **Ghost Crew pane.** `/ghost-crew` (until 2.4.1 also a **Crew** button in
  the row above the prompt) opens a pane that lists the session's steps (tool calls,
  subagents, workflows, background shells) under **Running** and **Finished**,
  each with a small role character (scout, builder, operator, tester, courier,
  navigator, conductor, keeper), a short description, its time and status. A
  running step's character moves (at most six at once), a finished one stands
  still with a gold check, a failed one with a copper mark. Ghost only watches
  tool calls: it never blocks, denies or changes one. The list holds the last
  60 steps, in session memory only.
- **Role characters in the transcript (desktop), 2.0 to 2.4.1.** Each tool row
  had the same small character on its left. Since 2.5 the character stands in
  the running-step line instead (see New in 2.5) and tool rows are the app's own.
- `/ghost-tips off` turns the project tips off, `/ghost-tips on` turns them on
  again. The choice is remembered.

While Ghost works, the row above the prompt and the status line show
`Ghost is improving your prompt...`, the pill shows the percentage, and a
Stop button stands in the Ghost control's place (2.3).
An empty draft shows `Type a prompt first, then press Ghost.`

## Safety and privacy

- Ghost never submits a prompt. It has no code that sends one.
- Ghost replaces your draft only if the prompt box still holds exactly what it
  started from. If you typed meanwhile, the result goes to the Ghost pane and
  your text stays.
- The original draft is kept in session memory for Undo. Nothing is written to
  disk and nothing is logged.
- The draft goes only to the model your Claude Code session already uses
  (Claude Sonnet, through Claude Code's own connection), never to a third party.
  The model call has no tools, so nothing in a draft can run.
- Likely secrets (API keys, tokens, private keys, `password: …` values) are
  replaced with placeholders on your computer before the model call and put
  back afterwards; Ghost then reminds you to remove them if the AI does not
  need them. This detection is best effort, not a guarantee.
- The draft is treated as data: instructions inside it ("ignore previous
  instructions…") are rewritten as prompt content, not obeyed.
- If a Ghost command ever reaches the normal prompt path, Ghost answers it and
  drops it, so it is not sent to the model as a request.

### Project tips: what is read and where it goes

- When a session with a person at the prompt starts (never in `claude -p`),
  Ghost reads from the top level of the session's folder only: the list of
  file and folder names, a README, and `package.json`, `pyproject.toml`,
  `requirements.txt`, `Cargo.toml`, `go.mod`, `CLAUDE.md` and `AGENTS.md` when
  they exist (a few thousand characters of each at most, 12,000 in all). It
  never reads or lists `.env*` files, key or certificate files, files named
  like secrets, tokens or credentials, links, binaries or large files, and it
  skips `.git`, `node_modules` and build folders. It runs no command.
- That sample, the short descriptions of the last few steps and the first 200
  characters of your latest prompt go through the same secret filter as a
  draft, then in one small request to the model service your Claude Code
  session already uses (Claude Haiku, no tools). Nothing goes to a third party.
- The reply is treated as text only: tips with links, risky commands or
  anything about Ghost are dropped. File content is marked as untrusted data
  for the model.
- Only the finished tips are kept: per project folder, in the mod's own store
  file under your Claude Code configuration folder, and reused for 24 hours.
  New tips are made at most once per 5 finished turns and 10 minutes.
- If anything fails (no file access, a model error, an unreadable reply) there
  are simply no tips; Ghost shows no error for it.
- Turn it off with `/ghost-tips off`: Ghost then reads no project files and
  makes no tips request.

## Turn it off

- Disable (keep installed): `claude plugin disable ghost@ghostprompts-mods`
- Enable again: `claude plugin enable ghost@ghostprompts-mods`
- Uninstall: `claude plugin uninstall ghost@ghostprompts-mods`, then
  `claude plugin marketplace remove ghostprompts-mods`

Changes apply to new sessions, or after `/reload-plugins` in a terminal session.

## Limits

- The button and the draft replacement depend on the app sharing its prompt box
  with plugins. Where it does not, use the Ghost pane field or `/ghost <prompt>`
  and copy the result.
- In a headless run (`claude -p`) no questions can be asked: Ghost fills gaps
  with placeholders and lists what it would have asked.
- If Ghost is disabled or fails to load, `/ghost …` is not a Ghost command any
  more; do not rely on it then.
- Undo history lasts for the current session only.
- The Crew pane is Ghost's own record of the calls it saw, not the app's
  Background tasks list itself: a step that started before Ghost loaded is
  missing, and a background shell or workflow is marked finished when the
  turn that follows its end stops.
- The project tips and the role characters use model-written and generated
  text and art: a tip can be wrong. Check it against the project.

## License

**MIT**. See [`LICENSE`](../../LICENSE) at the repository root. The license covers only
the contents of this repository; Claude Code itself is not included and is subject to Anthropic's terms.
