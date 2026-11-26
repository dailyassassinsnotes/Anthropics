# Anthropics — Claude Code Mods by dailyassassinsnotes

This repository is a collection of mods and skills for [Claude Code](https://claude.com/claude-code),
all made by the repository owner, **dailyassassinsnotes**.

> Personal project. Not affiliated with, sponsored, or endorsed by Anthropic, PBC, and not an official Anthropic product.

## Mods

| Mod | Plugin | Version | What it does |
| --- | --- | --- | --- |
| [GhostPrompts](https://github.com/dailyassassinsnotes/Anthropics/tree/main/Mods/GhostPrompts) | `ghost` | 2.5.1 | Turns a rough prompt into a precise, ready-to-send one: a gold **Ghost** button with an animated ghost above the prompt box, plus `/ghost`, `/prompt-master` and `/ghost-undo`. Never sends a prompt by itself. |

Full documentation, installation and usage: [GhostPrompts](https://github.com/dailyassassinsnotes/Anthropics/tree/main/Mods/GhostPrompts).

## Quick install

```bash
claude plugin marketplace add dailyassassinsnotes/Anthropics
claude plugin install ghost@ghostprompts-mods
```

Requires Claude Code 2.1.318 or later.

## Repository layout

- [`Mods/`](Mods/README.md): one folder per mod, each a complete Claude Code plugin with its own `README.md`.
- [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json): makes this repository a Claude Code marketplace.
- [`CHANGELOG.md`](CHANGELOG.md): changes per release.

## License

MIT. See [`LICENSE`](LICENSE).
