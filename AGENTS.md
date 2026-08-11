# AGENTS.md — collider-pilot

> **Authored projection SOT for tools in this repo** — read natively by Copilot, Cursor, Codex,
> Gemini/Antigravity; Claude via `CLAUDE.md` `@import`. This is the always-loaded kernel: what a
> seat must know before touching anything. Depth lives in `README.md` (what the pilot is) and
> `TESTING.md` (the gate sequence, and what each gate actually covers) — do not restate them here.

## What this repo is

The **browser harness surface** for mo:os: a provider-neutral MV3 extension — side panel as the
persistent seat, Document Picture-in-Picture as an optional always-on-top mirror — that projects a
purpose-selected HG frame from an engine over MCP Streamable HTTP.

In the fleet it is the **surface**. `mtdc-lab` is the design authority (ruled t281), `ffs0` is the
operad of record + KB, `moos-kernel` is the oracle and production engine, `moos-router` is
federation.

## The rule (inherited, non-negotiable)

Four rewrites only: **ADD · LINK · MUTATE · UNLINK**. **Log is truth. State is derived.**
Nomenclature: node · relation · rewrite · property · operad · port · rewrite_category WF01..WF21 ·
`_urn`/`_urns`. Never: edge · wire · field · mutation · schema · association · binding · `_ref`.

**This repo owns no graph identity and is read-first.** It reads frames and lifts only
user-approved observations and tool intents back through the four rewrites. Every mutating act is
gated behind explicit approval. A change that widens what can be written without approval is not a
refactor — surface it.

## Gate

```bash
npm run typecheck        # GATE  tsc --noEmit
npm run build            #       prerequisite -> dist/ (also the load-unpacked target)
npm run smoke:worker     # GATE  the SHIPPED dist/worker.js, driven headlessly
npm run smoke:live       # GATE  live MCP read + the access law + the slice axes
npm run smoke:llm        # GATE  the LLM seam
npm run smoke:lens       # GATE  the lens vocabulary invariant below (pure, offline)
```

Order matters and each catches a distinct class — `TESTING.md` says what each covers.
`smoke:worker` reads `dist/`, not source, so `build` comes first.

**CI is a subset, not the gate.** `.github/workflows/build-test.yml` runs what a GitHub runner can
honestly execute: typecheck, build, a dist sanity check, `smoke:llm`, `smoke:lens`. `smoke:worker` and
`smoke:live` need a live Z440 kernel and stay local. **CI green is not a substitute.** If you are
in a sandbox that cannot reach the engine, say which gates you did not run — do not imply a full
pass.

## The Copilot gate, and the trap in it

`.github/workflows/copilot-gate.yml` requires a Copilot review that **covers the head commit** —
equal to it, or an ancestor of it. A rebase orphans the reviewed commit and fails; adding commits
on top passes.

**The trap:** it triggers on `opened, reopened, synchronize, ready_for_review`, but Copilot does
not auto-review **drafts**. A PR opened as a draft therefore burns the gate's full 10-minute poll
against zero reviews and fails, with nothing wrong in the diff. Mark ready for review and the
gate re-fires and passes. This has cost a red check at least once (`#42`).

## Invariants a change can silently break

- **Lens vocabulary is three lists that must agree.** `src/components/GraphControls.tsx` holds
  `LENSES`, `TYPE_GROUPS` and `PORT_GROUPS`. `ALL_TYPES`/`ALL_PORTS` are flattened from the two
  *groups*, so a type or port named in a lens but in no group is **invisible in the advanced
  drawer** and unreachable by `specTogglePort`'s expand-from-all base. Each lens's `types` must be
  a subset of `ALL_TYPES` and its `ports` a subset of `ALL_PORTS`. A lens tooltip that enumerates
  its slice must name every type and port the lens selects — a lens must never be wider than it
  says. **`npm run smoke:lens` enforces both** (`scripts/lens-smoke.mjs`), and it exists because
  prose did not: the `substrate` lens drifted in `#42`, and the check found a second, pre-existing
  drift in the `topology` tooltip on its first run.
- **Verify slices through the real shared transform.** `applyViewFilter` lives in
  `src/mcp/transform.js` and the access law in `src/mcp/access.js`; both are imported by the
  smokes so they exercise the shipped law, not a copy. A hand-rolled check against a fixture of
  your own shape proves nothing — fixtures use `source_urn`/`target_urn`, not `src`/`tgt`.
- **Vocabulary may be declared ahead of the data.** Ratified-but-unpopulated grammar belongs in
  the panel before the first instance exists — the pilot must never be the blocker. Say so in the
  tooltip when a lens will render empty.

## Capability is a script, not a skill

A capability lives as a **script in `scripts/` plus a pointer here**. Claude skills, Copilot
instructions and the like may *wrap* a script; none may be the only copy, because a capability
that exists only as a `SKILL.md` cannot be invoked by the Antigravity, VS Code or Codex seats.
If you add a capability, add the npm script and name it above.

## Boundaries

- Read-only by default; writes are explicit boundary acts, approved per act.
- Never commit secrets, tokens, or `.vscode/mcp.json`.
- `dist/` and build artifacts are gitignored — do not commit them.
- No writes to another repo's runtime. Findings that belong to the operad go to `mtdc-lab`
  as a proposal, not into this repo's docs.

## Commit trailer

```
authored-by: <agent-urn> / <session-urn> / <purpose-slug>
```

---
authored-by: agent:claude-code.remote / session:none-ungoverned-remote-s0 / t283-five-recommendations
