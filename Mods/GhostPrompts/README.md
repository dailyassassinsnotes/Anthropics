# GhostPrompts — Ghost Prompt Master for Claude Code

Plugin name: `ghost` · Version: 1.1.0 · Requires Claude Code 2.1.318+

Ghost turns a rough, incomplete, or unclear prompt into a precise, ready-to-send
prompt. Ghost **never sends anything**: you review the result and press Enter
yourself.

> Personal project. Not affiliated with, sponsored, or endorsed by Anthropic, PBC, and not an official Anthropic product.

## About the repository

This repository holds home-made mods (hooks plugins) for
[Claude Code](https://claude.com/claude-code). It currently contains one mod:
**GhostPrompts** (plugin `ghost`), which turns rough prompts into precise,
ready-to-send ones.

Each mod lives in `Mods/<ModName>/` as a complete Claude Code plugin
(manifest, hooks module, types, tests, documentation). The
`.claude-plugin/marketplace.json` file at the repository root makes the
repository a Claude Code *marketplace*, so mods can be installed straight from
it.

## Features

**GhostPrompts (`ghost`)**, with full details in [How Ghost works](#how-ghost-works) and the sections below:

- A gold **Ghost** button in the row directly above the prompt box (desktop and terminal), with an animated vector ghost and a gold hologram-grain effect while it works (desktop; still under reduced motion).
- The commands `/ghost <prompt>`, `/prompt-master <prompt>` (alias), and `/ghost-undo`.
- Up to 3 clarifying questions, each with suggested answers plus a free-text answer.
- Picks the relevant expert roles automatically and structures the prompt as Role, Context, Task, Inputs, Constraints, Format, Check.
- Keeps inputs exactly as given (quotes, numbers, URLs, code, paths); missing information is marked `[PLACEHOLDER]`.
- Never sends a prompt by itself; the original draft can be restored (Undo).
- Detected secrets (API keys, tokens, passwords) are hidden from the model and then put back.

## How Ghost works

For every draft, Ghost:

1. Classifies the task (software, servers, security, data/AI, research, writing,
   teaching, business, design, image/video, decisions, …).
2. Checks the objective, audience, context, requested deliverable, format,
   constraints, and success criteria. If a gap would really change the result,
   Ghost asks **at most three** short questions, each with answer options and a
   free-text "Other" field. If nothing is needed, Ghost asks nothing.
3. Picks the smallest set of expert roles that actually helps (for example
   software architect + full-stack engineer + UI/UX designer + security reviewer
   for a website) and, where relevant, the methods to apply (root-cause analysis,
   first-principles, trade-offs, edge-case analysis, …).
4. Rewrites the prompt using only the sections that help: Role, Context, Task,
   Inputs, Constraints, Format, Check.
5. Checks the result: intent preserved; every fact and literal input (quotes,
   names, numbers, URLs, code, paths) kept exactly; gaps marked `[PLACEHOLDER]`;
   no invented facts; no new contradictions; complexity that fits the task.

The full specification sent to the model is `GHOST_SYSTEM` in `hooks/core.ts`.
Model used: the `sonnet` alias, through Claude Code's own connection
(`$.model.complete`, with no tools).

## Requirements

- Claude Code **2.1.318 or later** (desktop app or terminal) with an active login.
- Git 2.x and Git Credential Manager or GitHub CLI (`gh`) for clone/push.
- No other dependencies (no npm/pip).

## Installation

**A. Straight from GitHub:**

```bash
claude plugin marketplace add dailyassassinsnotes/Anthropics
claude plugin install ghost@ghostprompts-mods
```

**B. From a local clone:**

```bash
git clone https://github.com/dailyassassinsnotes/Anthropics.git
claude plugin marketplace add ./Anthropics
claude plugin install ghost@ghostprompts-mods
```

In the desktop app (no `/plugin`): click **+** next to the prompt box → **Plugins** →
**Add marketplace** → `dailyassassinsnotes/Anthropics` → **Add plugin**.

Install from one source only. If `ghost` is already installed from another source
(for example `ghost@ghost-local`), remove the old one first:
`claude plugin uninstall ghost@ghost-local`.

## Usage

1. Type a draft prompt in the prompt box, then press **Ghost** above it. Or type `/ghost <prompt>`.
2. Answer the clarifying questions if any appear (max. 3), or close the dialog to use placeholders.
3. The improved prompt goes into the prompt box. Review it, edit it if needed, then press Enter yourself.
4. **Undo** or `/ghost-undo` restores the original draft; **Use improved** swaps it back.

Turn the mod off: `claude plugin disable ghost@ghostprompts-mods` (turn it back on with `enable`).
Remove it: `claude plugin uninstall ghost@ghostprompts-mods`, then
`claude plugin marketplace remove ghostprompts-mods`.

## Usage details

- **Button:** type a draft in the prompt box, then press **Ghost** in the row directly above it.
  Ghost replaces the draft with the improved prompt. **Undo** restores the original draft,
  **Use improved** swaps it again, **Show** opens the Ghost pane.
- **Commands:** `/ghost <rough prompt>` or `/prompt-master <rough prompt>`. The result goes
  into the prompt box, or into the output and the Ghost pane if the prompt box can't be
  written to. `/ghost-undo` restores the original draft.
- **Ghost pane:** shows the improved prompt, Ghost's notes, the original draft, the
  *Put in prompt box* / *Copy* / *Restore original* buttons, and a field for typing a
  prompt when the app doesn't share its prompt box.

While Ghost is working, the row above the prompt box and the status line show
`Ghost is improving your prompt...`. An empty draft shows
`Type a prompt first, then press Ghost.`

## Security and privacy

- Ghost never sends a prompt; no code does that (`$.prompt.submit` is not used).
- The draft is replaced only if the prompt box still holds exactly the original text. If you
  type while Ghost is working, the result goes to the pane and your text stays intact.
- The original draft is kept in session memory for Undo. Nothing is written to disk or logged.
- The draft is sent only to the model your Claude Code session already uses, never to a third party.
  The model call has no tools, so nothing in the draft can run anything.
- Detected secrets (API keys, tokens, private keys, `password: …` values) are replaced with
  placeholders on your computer before the model call and put back afterwards; Ghost then
  reminds you to remove them if they aren't needed. Detection is *best effort*, not a guarantee.
- The draft is treated as data: instructions inside it ("ignore previous instructions…")
  are rewritten as prompt content, not followed.
- If a Ghost command reaches the normal prompt path, Ghost answers it and drops it,
  so it is never sent to the model as a request.

## File structure

| File | Contents |
| --- | --- |
| `.claude-plugin/plugin.json` | Manifest: name `ghost`, version, type contract |
| `hooks/hooks.json` | Points to the hooks module `register.tsx` |
| `hooks/register.tsx` | Button above the prompt box, Ghost pane, commands, `prompt.submit` / `ui.press` / `ui.input` hooks |
| `hooks/art.ts` | Vector art: idle ghost and hologram-grain effect (CSS animation, reduced-motion aware), gold palette |
| `hooks/core.ts` | Ghost specification (`GHOST_SYSTEM`), secret hider, reply parser, pipeline |
| `types/index.d.ts` | State contract `ghost.view` (session memory only) |
| `tests/ghost.test.tsx` | 19 automated tests (terminal and desktop surfaces) |

## Repository structure

```text
Anthropics/                         ← repository root
├── .claude-plugin/
│   └── marketplace.json            ← mod list for Claude Code
├── .gitignore
├── CHANGELOG.md
├── LICENSE                         ← MIT
├── README.md                       ← front page
└── Mods/
    ├── README.md                   ← mod index
    └── GhostPrompts/               ← plugin "ghost"
        ├── .claude-plugin/plugin.json
        ├── hooks/
        │   ├── hooks.json          ← points to the hooks module
        │   ├── register.tsx        ← button, pane, commands, hooks
        │   ├── art.ts              ← ghost art and gold palette
        │   └── core.ts             ← Ghost specification and pipeline
        ├── types/index.d.ts        ← state contract
        ├── tests/ghost.test.tsx    ← 19 automated tests
        └── README.md               ← this document (mod documentation)
```

## Development and testing

Run from the repository root:

```bash
claude plugin validate ./Mods/GhostPrompts
claude plugin test ./Mods/GhostPrompts
```

End-to-end test with the real model (headless, no prompt box; the result shows in the output):

```bash
MSYS_NO_PATHCONV=1 claude -p --plugin-dir ./Mods/GhostPrompts "/ghost write a cover letter for a job application"
```

In Git Bash, `MSYS_NO_PATHCONV=1` is required: without it, `/ghost …` is turned into a Windows path.

## Turning it off

- Disable: `claude plugin disable ghost@<marketplace>`
- Enable again: `claude plugin enable ghost@<marketplace>`
- Remove: `claude plugin uninstall ghost@<marketplace>`

`<marketplace>` is `ghostprompts-mods` if you installed from this repository.

## Limitations

- The button and draft replacement depend on the app sharing its prompt box with
  plugins. If it doesn't, use the field in the Ghost pane or `/ghost <prompt>` and copy the result.
- In a headless run (`claude -p`) there is nobody to ask: Ghost fills gaps with
  placeholders and lists the questions it would have asked.
- If Ghost is disabled or fails to load, `/ghost …` is no longer a Ghost command.
- Undo history only lasts for the current session.

## Contributing

1. Create a new branch from `main`: `git switch -c feature/<name>`.
2. Each mod stays in `Mods/<ModName>/` and must have its own `README.md`; register it in
   `.claude-plugin/marketplace.json` and `Mods/README.md`.
3. Before committing, run (from the repository root):
   ```bash
   claude plugin validate ./Mods/<ModName>
   claude plugin test ./Mods/<ModName>
   ```
4. Never commit secrets (`.env`, tokens, private keys); `.gitignore` already blocks common patterns.
5. Record changes in `CHANGELOG.md`, bump `version` in `plugin.json`, then open a pull request.

## Contact and license

- Contact: [CONTACT]
- License: **MIT**. See [`LICENSE`](../../LICENSE) at the repository root. The license covers only
  the contents of this repository; Claude Code itself is not included and is subject to Anthropic's terms.

## Remaining placeholders

| Placeholder | Meaning |
| --- | --- |
| `[CONTACT]` | Contact for the repository owner/maintainer (not set yet) |
