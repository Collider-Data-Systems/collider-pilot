# CLAUDE.md

@AGENTS.md

> **Mirror of `AGENTS.md`** (this repo's SOT) · manual · don't edit except emergency de-rot.
> This file = Claude-Code-specific deltas only.

The pilot is the **surface** — read-first, owns no graph identity. Read `AGENTS.md` for the gate,
the Copilot draft trap, and the lens invariant; `TESTING.md` for what each gate covers.

## Deltas

- **CI green is not the gate.** `smoke:worker` and `smoke:live` need a live Z440 kernel and do not
  run on a GitHub runner or in a cloud sandbox. If you could not reach the engine, name the gates
  you did not run rather than reporting a pass.
- **Open PRs ready, not draft.** `copilot-review-present` polls 10 minutes for a Copilot review
  covering the head, and Copilot does not review drafts — a draft PR fails the gate with a clean
  diff. This is the one repo where the standing "open as draft" habit is actively wrong.
- **Claims about a slice are exercised through `src/mcp/transform.js`**, never through a
  hand-rolled filter. Fixture relations are `source_urn`/`target_urn`.
- **A capability is a script in `scripts/` plus a pointer in `AGENTS.md`.** A skill may wrap it;
  a skill must not be the only copy — the AG, VS Code and Codex seats cannot invoke one.

## Safety

Read-only by default. Writes, pushes and merges are explicit boundary acts — surface before doing.
Never commit secrets, tokens, or `.vscode/mcp.json`.
