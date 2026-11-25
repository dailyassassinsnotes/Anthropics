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
