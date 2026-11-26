# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/lang/id/).

## Repository

### [Unreleased]
#### Added
- MIT license (`LICENSE`), the `license` field in `plugin.json`, and a license section in the README.
- New front-page `README.md` at the repository root.

#### Changed
- All documentation translated into English.
- The previous root `README.md` was merged into `Mods/GhostPrompts/README.md`, with its links updated.

## GhostPrompts (`ghost`)

### [2.5.1] — 2026-11-27
#### Changed
- Versions 2.0 to 2.5.1 in one update; see the "New in" sections of `Mods/GhostPrompts/README.md`.
- Project tips run right to left in the pill as a seamless marquee, with gold glints moving left to right; reduced motion shows the first tip still.
- The band row is the ghost, the pill, then a dropdown (Ghost / Show) directly right of the pill, with no caption; a Stop button stands in its place while Ghost works.
- The percentage counts 1% at a time as native text, so nothing reloads between the press and 100%.
#### Added
- AI project tips, the Ghost Crew pane (`/ghost-crew`), role characters, `/ghost-tips on|off`.

### [1.1.0] — 2026-11-26
#### Changed
- New look: an animated vector ghost beside a gold Ghost button, and a gold hologram-grain effect while Ghost works (desktop). Animations are CSS-only and stop under reduced motion.
- No emoji anywhere in the interface or command output.

### [1.0.1] — 2026-11-26
#### Fixed
- The Ghost button exceeded the 10-second per-hook limit while the model was working. The long
  work of the button and the pane field now runs in its own `ui.press` / `ui.input` hooks.
- Tests build the fake API key example at runtime, so there is no key-shaped string in the repository.

### [1.0.0] — 2026-11-25
#### Added
- First release: button above the prompt box, `/ghost`, `/prompt-master`, `/ghost-undo`, Ghost pane.
- Max. 3 clarifying questions, automatic expert-role selection, placeholders for missing information.
- Secret hiding before the model call, Undo / Use improved, a guard so Ghost commands are never
  sent to the model as a normal prompt.
