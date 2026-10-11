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

**A measure, not a gate (t342 P2):** `npm run bench:frame -- --layout [--user <urn>]`
(`scripts/bench-frame-read.mjs`) times the road to the first drawing on the panel's own code —
the read, `selectFrame`, FrameGraph's `drawingPlan` and `runLayout` (headless) — and exits 1
when the pilot's share of it (the main thread's CPU time of transform + plan + layout, p95;
headless, so no text measuring and no canvas paint) is over `FIRST_PAINT_BUDGET_MS`. The read is
the engine's and the network's share: reported, not budgeted. Without `--layout` it is the
Phase 5 read baseline. `TESTING.md` "First paint" has the budget's definition and the measured
numbers.

**A second measure, not a gate (t342 hand-off C):** `npm run probe:ui -- [--engine <REST base>]
[--user <urn>]` (`scripts/ui-probe.mjs`) loads the BUILT `dist/preview-live.html` in headless
Chrome over the DevTools protocol — it serves `dist/` itself and seeds one identity in the
harness's storage shim — and reads the hand-off C done-whens from the rendered DOM and the page's
own Cytoscape: the opening zoom against the label cut and the identity's node inside the canvas
(PIL-5), WCAG 1.4.3 contrast over every text item (PIL-6), a `find` hit's relations lit and in
view, from the opening view and from `fit` (PIL-7), the strip's words and what is cut at 380 px (PIL-8), the legend's tooltips against
the insider terms and whether it grows (PIL-9), the `<button>` tags with a `data-testid` (PIL-10)
and a re-layout with a selection (PIL-12). GET only; the numbers are in `TESTING.md` "Hand-off C".

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
- **The engine's grammar is read, never written here (t342).** The drawer adds, at run time,
  the types and source ports the connected engine declares (`/operad/*`, through
  `src/mcp/engine-grammar.js`) and the fold's undeclared labels — `drawerVocab` in
  `GraphControls.tsx`; relation ends are coloured by the engine's port colours
  (`src/ui/port-colour.js`). Never add operad data, a port-colour map or an mtdc-only port or
  type name to this public repo by hand. A port a lens names must be declared by the
  connected engine or the knowledge vocabulary, or sit on the commented `LEGACY_PORTS` list:
  `npm run smoke:live` (h) enforces it, `smoke:lens` H and I hold the rules offline.
- **The nested drawing is laid out by component, never by one `cose` (t342 P2, P3).** Outside
  the boxes each connected component is placed breadth-first and a large one refined by a
  bounded `cose` (`src/ui/component-layout.js`; one budget per frame, run on a detached
  instance so the canvas size never reshapes a component) — a cose over the whole frame took
  about 7 s. A knowledge source is drawn inside the box that cites it: a presentation-only
  parent, node ids stay urns, nothing is written back. `smoke:lens` J holds both on a synthetic
  frame; `bench:frame` holds the pilot's CPU share of the first paint to its budget.
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
