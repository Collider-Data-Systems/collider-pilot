# Testing the pilot

Five gates — `typecheck` and the four `smoke:*` scripts — all runnable from a clean checkout
with the Z440 primary kernel up. `build` appears in the sequence below but is a prerequisite,
not a gate: it produces the `dist/` that `smoke:worker` reads. Run them in this order; each is
fast and each catches a distinct class.

CI (`.github/workflows/build-test.yml`, the `build-test` check) runs the subset a GitHub
runner can honestly execute: `typecheck`, `build`, a dist sanity check, `smoke:llm`
(whose live-Ollama leg self-skips) and `smoke:lens`. `smoke:worker` and `smoke:live` need
the live Z440 kernel and stay local-only — CI green is therefore **not** a substitute for
the full gate sequence below.

```bash
npm run typecheck        # GATE  tsc --noEmit
npm run build            #       prerequisite -> dist/ (also the load-unpacked target)
npm run smoke:worker     # GATE  the SHIPPED dist/worker.js, driven headlessly
npm run smoke:live       # GATE  live MCP read + the access law + the slice axes
npm run smoke:llm        # GATE  the LLM seam (+ a live Ollama round-trip if reachable)
npm run smoke:lens       # GATE  the lens vocabulary invariant (pure, offline)
```

`smoke:worker` needs `npm run build` first — it loads `dist/worker.js`, not source.

## What each gate actually covers

**`smoke:worker`** loads the *compiled* worker into Node behind a minimal `chrome` stub,
captures the real `onMessage` listener, and drives real requests through the real
`withTrustedAccess` seam → `resolveTrustedAccess` → adapter → MCP transport → live kernel.
Only `chrome.*` is stubbed. It is the only automated check that exercises the **access trust
boundary as shipped**: a forged scope (`user:EVIL-INJECTED`, `workstation:attacker`, claiming
`trusted-storage` and `server-authoritative`) must have its user dropped, its workstation
dropped, its `identity_source` overwritten to anon and its tier left unpromoted; a stored
identity must resolve from storage alone; anon posture and `enabled:false` must both fail
closed. It also covers the surface-room handshake's tab safety (a user's own tab group must
survive, pinned tabs stay ungrouped, other windows are untouched, re-runs are idempotent) and
asserts that an unknown message type is *not* answered. It also carries the **A16
acceptance**: `GET_FRAME` with `surface:"menno"` must come back with
`provenance.engine === urn:moos:kernel:hp-z440.menno` (self-confirmed by the engine's
healthz `kernel_urn`), an invalid key must fall back to the default engine, and — when the
menno twin is not up — the surfaced case reports SKIP rather than silently passing.

**`smoke:live`** proves the slice law twice: on a synthetic chain (ports narrow relations;
hops expand only along retained ports) and on the **live fold** (the content lens loses no
node or relation the legacy default showed; `["*"]` reaches the whole fold; hops widen a real
focus monotonically). One assertion there earns its keep long-term: **every live relation
label must be present in the UI's port vocabulary** — it caught `guards` and `participates`
being unreachable, and it will fail the next time an ontology bump adds a port the UI cannot
select. It also exercises the **A16 surface→channel→engine resolution** with the code the
worker runs: candidate/alias mapping, the display_name engine-hint grammar, the local
transport table (twins answer MCP on :9001–:9003, not :8080), the live directory chain
against the t266 channel nodes, and — when the twin is up — that the resolved endpoint
self-reports the resolved `kernel_urn`.

Since t337 the port vocabulary that assertion checks against includes the eight WF12
knowledge ports of ontology 4.0.8. They are read from `src/ui/kb-vocab.json` through
`src/ui/kb-vocab.js` — the same module the drawer's `knowledge` port group and the
`knowledge` lens are built from — and are restated nowhere, so the check cannot agree only
with itself. The fleet is below 4.0.8 and carries none of those relations, so the lens is
also asserted on a synthetic knowledge graph (one relation per vocabulary port), the way
kinship is. A second pure block asserts the engine-identity rule below.

The two rules that decide what the knowledge drawing is ASKED to draw are asserted on the
real code since t337 — `nestingParents` and `resolveGraphLayout`, exported by
`src/components/FrameGraph.tsx` and loaded the way `smoke:lens` loads `GraphControls.tsx`
(nothing is mounted or drawn). On a synthetic hierarchy: one box per node, a `domain_tag`
before a `program`, never a box of another type, a cycle cut, the result independent of the
order the engine returns relations in; `auto` is `nested` exactly when a box is drawn and a
picked layout is returned as picked. On the live fold, lens by lens: `auto` is `nested`
exactly when that lens frame has a box, and on a fold without the nesting relation — the
fleet today — every lens is `concentric`, as before t337.

The find box also matches inside text properties since t337, and that rank is asserted on
the REAL ranking: `src/ui/node-search.ts`, type-stripped in memory with
`ts.transpileModule` the way `smoke:lens` reads `GraphControls.tsx`. On a synthetic trio
and on the live fold: a word found only in a text property selects a node that carries it
and the hint says where; a urn / label match always outranks a text-only match; every
match is listed, best first; and the two answers the hand-copied mirror asserts (program
slug, exact urn tail) hold on the real code.

`PILOT_MCP_BASE_URL` / `PILOT_ENGINE_URL` point the whole script at another engine. It is
written for a fleet engine: its A16 block requires `/healthz` to carry `kernel_urn`.
Measured at t337 against the t336 scratch kernel (4.0.8, 447 nodes / 420 relations, started
without a kernel urn): the port-vocabulary assertion — which failed there before, on five
unreachable labels — passes, the `knowledge` lens renders 122 nodes / 178 relations, the
nesting block reads 80 of its 122 nodes in 19 boxes, and the run then stops at
`healthz carries kernel_urn`. That is the engine's statement about itself; the assertion
was not relaxed for it.

**`smoke:llm`** covers the ToolSpec→OpenAI mapping, both recovery paths (structured
`tool_calls` and strict content-JSON) with fenced/prose content *rejected*, the cloud-egress
access gate, the declared-type check, and the semantic urn gate (`{urn:"t263"}` and ghost urns
must reject; wrong-typed pins must reject).

**`smoke:lens`** is pure and offline. A-C are the lens invariant `AGENTS.md` states: every
lens is a subset of the drawer's type and port groups, an enumerating tooltip names all the
lens selects, ids are unique. D (t337) is the one-source rule of the knowledge vocabulary:
`src/ui/kb-vocab.json` has the size and sha256 `PROVENANCE.md` records (so a hand edit, or a
replaced file whose record was not updated, fails); only `src/ui/kb-vocab.js` imports it;
and none of its port names (both ends) or colours is a string literal in any code file
under `src/` or `scripts/`. The files are parsed, so a name in a comment or inside a
sentence is not a hit. `.gitattributes` keeps the JSON byte-identical on a Windows checkout.
E (t342) holds the opening view un-narrowed: `defaultSliceSpec()` is the `everything`
sentinel (all types, all ports, latest t, 1 hop) — the access posture is the only gate a
freshly opened panel applies. F (t342) holds the strip's counts honest on the real transform
and a synthetic fold: `provenance.fold_counts` counts what the access posture alone withheld
over the whole fold, and a narrower lens holds less without moving that number. G (t342)
holds the unlinked band to the nodes no relation of the CURRENT frame touches — a seat whose
only relation runs to a withheld seat is unlinked there — on the real `unlinkedUrns`, loaded
from `FrameGraph.tsx` the way `smoke:live` loads it.

**`selftest.html`** (open it from the extension: `chrome-extension://<id>/selftest.html`) is
the one surface that can exercise what the harnesses fake — the worker seam with real
`chrome.storage`, the real trust-strip, the live axes, and the scratch/pref round-trips
including the panel⇄PiP mirror channel. Chrome forbids one extension from scripting another's
pages, so it reports itself: a large PASS/FAIL headline plus one row per check, legible in a
screenshot. Served from the dev harness it reports extension-only checks as SKIP, not FAIL.

## The dev harnesses, and their two traps

`npm run dev:preview` serves `preview.html` (mock adapter), `preview-live.html` (live REST
read + a `chrome.storage` shim) and `pip-preview.html`. `preview-live.html` deliberately
frames the app in a **380px `#panel`** so it renders at a realistic side-panel width.

`preview-live.html?engine=<REST base URL>` (t337) points every read the live harness
makes — `/fold`, `/healthz`, the fold stream, the log feed — at that origin instead of
`:8000`, so the built `dist/preview-live.html` can be served from any origin and read any
CORS-open engine. Without the parameter nothing changes. The Settings engine picker does
not steer the harness: it writes the shimmed `pilot.engine`, which only the extension's
worker reads.

Two things have burned real time here:

1. **The dev server can serve a stale transform.** A verified-correct fix once appeared
   completely broken because the served module was missing two of three call sites. When a
   harness result contradicts the source you just wrote, check what the server serves before
   touching code — `fetch('/src/preview-live.tsx').then(r => r.text())` — and restart the
   server if it disagrees.
2. **Harness prop drift hides features.** Twice a harness passed something the panel does not
   (`dirty={false}`, no `collapsible`), making the feature untestable outside the extension.
   Keep the harness props identical to `sidepanel.tsx`. Since t342 that includes the
   strip's `requestedMode` and the opening posture: `preview-live.html` opens under the posture saved in the shimmed
   `pilot.accessPosture`, as the panel does, and saves the toggle — it used to open anon
   (1 node on the scratch-kb fold) whatever "Bring me in" had saved. The posture is never
   read from the URL.

Note also that a **viewport** media query (the log feed drops the actor column below 430px)
cannot fire inside the 380px frame — a docked side panel *is* its own viewport, so test that
class by sizing the viewport, not the frame.

## Reading an engine outside the fleet (t337)

**Settings → engine → custom engine…** takes an engine REST URL, an MCP base URL and an
optional urn label, and stores them under the existing `pilot.engine` key. Three things
must hold before a frame appears:

- the MCP origin is in `public/manifest.json` `host_permissions`. The kernel's MCP endpoint
  answers a CORS preflight with 405, so an unlisted origin fails with `Failed to fetch`.
  Listed at t337: `localhost` and `127.0.0.1` on `:8898` / `:8899` — the pairs the
  measured runs used. A tailnet route to that kernel is not listed: its `:8086` origin
  served only `/` and `/state`, not `/fold`, `/healthz`, `/log`, `/fold/stream` or `/sse`,
  so the permission could not be exercised, and this repo is public;
- an identity is stored and the posture is "Bring me in" — anon shows public nodes only;
- the lens includes what you want to see.

The **`knowledge`** lens is type `claim` × the eight knowledge ports; the relation closure
brings in what those relations point at. Measured on the t336 scratch fold, identified:
122 nodes / 178 relations (claim 64, knowledge_item 38, domain_tag 18,
classification_scheme 1, program 1), against 444 / 416 under `everything`. On an engine
below 4.0.8 it shows only that engine's claim nodes (the Z440 primary: 1 node, 0
relations). The five older lenses select what they did before — same counts on both folds.

A custom engine with no label is stamped with the `kernel_urn` it reports on `/healthz`;
when it reports none, the audit drawer's `engine` reads `unidentified engine at
<host:port>` — never the default engine's urn. `pilot.engine` is one key per install: it
moves every surfaceless window (docked panel, pop-out, PiP) until "This box" is picked
again.

## Drawing the knowledge graph (t337)

No gate renders Cytoscape, so the drawing was looked at, not asserted: the built `dist/`
in a throwaway headless Chromium 145 — the harness with `?engine=`, the unpacked
extension (the side panel page with the inline graph on, the full-tab and popup mirror
pages), and `FrameGraph` mounted alone over frames built by `selectFrame`.

Measured on the t336 scratch fold, `knowledge` lens, identified (122 nodes / 178
relations), with no layout stored:

- it comes up `nested`: 19 boxes; 80 of the 82 nesting relations are shown as boxes and
  98 relations as lines; 38 sources stand in the column; 0 overlapping labels (leaf labels,
  box titles, titles against leaf labels);
- fit zoom by surface: side panel inline graph (380 x 155 canvas) 0.11, popup mirror
  (400 x 465) 0.23, full-tab mirror at 1600 x 900 (1600 x 393) 0.39. At fit the labels are
  1 to 3.5 px: the fitted picture is an overview (t342: below zoom 0.5 they are no longer
  drawn — see "Drawing the whole fold"). Reading is one act away: a find hit or
  an inspector relation row centres the node at zoom 1 (9 px labels), a double-click on a
  box brings that box into view, and the bar's `+` reaches zoom 1 in 6 clicks from the
  panel's fit, 4 from the pop-out's, 3 from the tab's (it was 77 / 51 / 32 wheel notches);
- zoomed in to read, 8 of 8 mouse drags that start on a box or a relation line pan the
  view (0 of 8 before: they moved a box with everything in it, or did nothing). A drag on
  a node still moves that node;
- the canvas changing size refits the picture when the view is still the fitted one: the
  legend opened in the pop-out (canvas 465 -> 364 px) left 13 nodes outside the view
  before, 0 now; the full tab resized from 1600 x 900 to 1200 x 700 left 73, 0 now. A view
  the user zoomed or panned is left alone;
- three frame re-reads, `GET /fold` returning the nodes in another order each time: zoom,
  pan and all 122 positions unchanged. The f1c192b build went back to fit on a re-read;
- unticking a legend row or pressing `re-layout` makes no engine request, and the unticked
  rows stay hidden across a frame re-read;
- a node kind unticked, then a layout run without it (a lens change, a layout picked,
  `re-layout`), then ticked back: the layout runs again and its nodes get their place —
  38 sources in the column, 0 labels overlapping (before: all 38 on one point, or 12
  labels overlapping). Two presses of `re-layout` give the same positions in every legend
  state. On a lens without the unticked kind the bar still reads `1 hidden`, with
  `show all` beside it.

On the Z440 primary (4.0.7, no knowledge relations), `content` (168 / 78) and `everything`
(320 / 238), old build (f1c192b) against this one in the unpacked extension: no box, every
relation in the default style with its port label, and every node position equal to the
old build's after one common shift of 12 model px (residual 0; t342: no longer on a frame
with unlinked nodes — ring, tree and grid now lay out the linked part and put those in a band) — the canvas is 24 px
shorter by the bar under it. The legend starts closed there (no knowledge relation), so it
takes no canvas height. Two node colours changed: `claim` and `classification_scheme` were
the default grey.

What does differ on the primary is the fit, on purpose. The old build clamped a fit at
zoom 0.2 and cut off what did not fit; `fit` now shows everything, at whatever zoom that
takes:

| surface, lens | f1c192b | now |
|---|---|---|
| side panel 380 px, `content` | zoom 0.2, 52 of 168 nodes outside the view | zoom 0.095, 0 outside |
| side panel 380 px, `everything` | zoom 0.2, 239 of 320 outside | zoom 0.056, 0 outside |
| full tab 1600 x 900, `content` | zoom 0.327, 0 outside | zoom 0.308, 0 outside |
| full tab 1600 x 900, `everything` | zoom 0.2, 0 outside | zoom 0.182, 0 outside |

In the narrow panel that is a smaller, whole picture where the old one was a larger,
cropped one; two clicks on `+` (three on `everything`) give the old zoom back.

Limits, deliberately not hidden: `nested` on a frame with several hundred un-nested nodes
is a plain grid above the boxes (t342: only the linked ones now — the unlinked go to the band
under the drawing) — and `auto` picks `nested` as soon as ONE node sits in a
box, so on the scratch fold `content` (17 nodes in 3 boxes, of 231) and `everything` (80
in 19 boxes, of 447) come up that way too (counts from `smoke:live`, which reads without
an access gate). The panel's inspector pane grows for a node with text, not the mirrors';
the full tab still stacks the inspector under the canvas rather than beside it.

## Drawing the whole fold (t342)

Sam's ruling at t342 — "I need the view not narrowed at opening" — opens every surface on
`everything`: 444 nodes / 416 relations on the scratch-kb fold, identified as
`urn:moos:user:sam`. Four things keep that first picture readable. Only the unlinked rule is
asserted (`smoke:lens` G); the rest was looked at.

- **Label cut.** Node and relation labels are not drawn below a zoom step. Cytoscape's
  `min-zoomed-font-size` compares the font with the texture scale
  2^ceil(log2(zoom × devicePixelRatio)), so a cut can only fall at 2^k / devicePixelRatio;
  `LABEL_ZOOM` (0.9) picks the last step at or below it. Labels draw above zoom 0.5 at 100 %
  and 200 % display scaling, 0.8 at 125 %, 0.67 at 150 %. Box titles draw at every zoom.
- **Exempt labels.** The selection, `find` matches and the hovered node keep their label
  below the cut, enlarged with the zoom to stay 9 to 13 px on screen (half-octave steps, so
  a zoom gesture restyles a few times, not every frame). Layout, fit and the box
  double-click measure every label at its plain size, so an enlarged label moves nothing;
  while labels are enlarged a box is sized around its nodes without their labels, so an
  enlarged label does not swell its box. Above the cut every label is drawn at its plain
  size. The hover is cleared when the pointer leaves the canvas.
- **Unlinked band.** The nodes no relation of the frame touches (141 under sam's urn, 156
  under a bare "sam") are left out of the packing and laid on one grid under the linked
  drawing, at least as wide as it, by type and then urn — under `nested`, and under ring,
  tree and grid, which now lay out the linked part only. Node ids stay urns; no box is made.
- **The `unlinked N` chip** in the bar hides or shows the band. It rides the legend's hidden
  kinds under the key `(unlinked)`: while the band is hidden the legend toggle reads
  `1 hidden`, `show all` brings it back, and showing it runs the layout again. It is not
  saved.

**The strip.** `sam · all permitted · 444/447 · access −3 · hp-z440.scratch-kb · seq 1012 ·
T=342 · 4.0.8`. `444/447` is what is in the frame, not on the canvas — the legend and the
chip can hide more, and the tooltip says so. Where the badges leave the summary less than
240 px (the 380 px panel) it takes its own line; inside it the counts never shrink and the
tail after them is cut first. The audit drawer has a counts row: nodes and relations in the
frame of the whole fold, withheld by access, left out by the lens, focus or t. Anon reads
`anon · public only · 1/447 · Bring me in`; "Bring me in" on with no identity stored reads
`· no identity — Settings`. The side panel calls a frame restored from session scratch
CACHED until the opening read lands, and the STALE / CACHED titles and the failed-refresh
banner name the lens the frame was read under — the lens row may already name another.

Looked at, not asserted: the built `dist/preview-live.html` served from `127.0.0.1` with
`?engine=` set to the scratch kernel (GET only), in the desktop app's browser pane, 380 px
panel, devicePixelRatio 1, the identity in the harness shim:

- `urn:moos:user:sam`, `everything`: the summary on its own line, 306 px; who/where (104 px)
  and the counts (121 px) whole, the tail cut (80 of 264 px). A bare "sam":
  `431/447 · access −16` whole, who/where cut. Anon: `1/447 · Bring me in`. "Bring me in"
  pressed with no identity: `1/447 · no identity — Settings`. `content`: `228/447 · access −3`;
- the inline graph (380 x 155, fit zoom 0.052 to 0.058): an ordinary label not drawn (it
  would be 0.47 px); the selected claim drawn at 10.6 px, a hovered node at 11.7 px; at zoom
  0.3 10.8 px, at 0.49 12.5 px; from 0.51 every label at its plain size (4.6 px);
- `re-layout` twice: 0 of 444 positions differ; with a hovered box, a hovered node and 5
  `find` matches: 0 differ. A selection moves 59 positions under `re-layout`, with the
  enlargement and without it alike — the selected node's 3 px border (t337) enters its
  measured label box;
- a pointer leaving the canvas from a node clears its hover; a move onto the canvas's own
  layer keeps it;
- a failed read (the page's fetch rejected) after `content` → `everything`: STALE, and the
  banner reads `(seq 1012, content lens)`;
- Settings with a custom workstation `hp-z440`: Save disabled and the note
  `not a workstation urn — write urn:moos:workstation:<name>, or pick none`. The stored bare
  "sam" alert names public workspaces and unattributed nodes, every other seat hidden.

Not looked at: the side panel's CACHED badge (it needs the extension) and `selftest.html`.

## Finding and inspecting in the knowledge graph (t337)

**Find** ranks urn and label as before (0-4, unchanged) and then, one rank below, the
text of `label` / `title` / `name` / `text` / `pointer`. The best hit is selected, every
node that did not match fades with the relations touching it — the boxes a match sits in
stay lit — and an empty box clears the fade. A set of matches that names no node of the
drawn frame fades nothing (a mirror gets frame and matches through two store keys).
Measured on the t336 scratch fold (447 nodes): of the 544 distinct words of 7+
letters in the 64 claim texts, 352 were in no urn and no label — "no match" before; each
now reaches a claim (`CRDT` -> `2 matches · showing claim · in text`).

**Inspector**: a node's `text` is a paragraph above the property table and no longer a
row in it; an incoming relation is named by its converse port (`← has-part`,
`← source-of`; from `tgt_port` for every other relation, e.g. `← composed-by` on the
primary); a knowledge port carries its vocabulary colour; a click on a relation row selects
the other node, centres the graph on it and scrolls the inspector back to its top. In the
380 px side panel the pane was 120 px for every node — 0 of a claim's text lines on
screen; for a node that carries a text it is now 45 % of the panel height (405 px at
900): the 5 lines of the median claim (284 characters) are inside the pane without
scrolling it, and the longest (1122 characters, 18 lines) shows 11. A node without a text
keeps the 120 px. In the full tab the paragraph is capped at 80 characters a line (518 px
wide instead of 1572).

**Mirrors** (full tab, pop-out, Document PiP) draw the layout stored by Settings and follow
a change while open. The panel's search fade and the centre request of an inspector row
reach them through a second session-store key, `pilot.scratchView.v1[.<scope>]`, one-way.
A find hit centres the panel's inline graph only: a mirror keeps its view, so the lit
matches stay in sight. Legend ticks stay local to each graph. A centre request for a node
the legend hides in that graph is ignored (it used to move the view to the model origin).

Looked at, not asserted — the built `dist/` in a throwaway headless Chromium 145: the
unpacked extension set to the scratch kernel through Settings -> custom engine, its
mirrors opened with the panel's own `Full tab` and `Pop out` buttons, and the harness with
`?engine=`. `knowledge` lens, identified, 122 nodes / 178 relations on every surface:

- `polynomial` in the panel: `5 matches · showing claim`; 5 lit / 117 faded in the panel,
  the full tab and the pop-out; the mirrors' zoom and pan unchanged;
- a legend untick (81 relations hidden), the fade and `re-layout` hold together, and a
  frame re-read keeps the fade and the selection;
- a relation row clicked in the panel centres the node in the panel's graph and in both
  mirrors (0 px from the canvas centre) at zoom 1; one that leads to a box shows the whole
  box; one clicked in the full tab's own inspector centres there and the panel follows
  the selection;
- `CRDT` in the panel: the hit is centred at zoom 1 (9 px labels; it was a 3 px dot), with
  the 3 boxes it sits in lit;
- Settings layout concentric / grid / nested / Auto: panel and open mirror drew the same
  each time (0 boxes and 178 lines, or 19 boxes and 98 lines);
- on the Z440 primary: `mvp-delivery` still selects the program and centres it at the
  zoom it had (no boxes, so no zoom-in); no box; an incoming `composes` row reads
  `← composed-by`; the review-only pin preview builds with the kernel urn as actor. On
  the scratch kernel (an unidentified engine) it is refused with a message that says why.

The Document-PiP mount (`PipMirrorApp`) takes the same props and was not opened: in the
extension `Pop out` always takes the popup-window path.

**The shared session store at these sizes.** The `knowledge` frame is about 142 KB of
JSON and takes about 304 KB of the store; the scratch fold's `everything` frame
(444 nodes / 416 relations) is about 445 KB and takes about 900 KB — 8.6 % of the
10 485 760-byte `chrome.storage.session` quota. Both reached both mirrors. The quota is per
extension, shared by every surface scope, and a write that does not fit is dropped without
a word (`saveScratch` is best-effort): with the store filled to 300 000 bytes free the panel
showed the 444-node frame, the mirror stayed on the previous 122, and nothing on screen
said so.

`selftest.html` gained one row for the scratch-view channel (PASS). Two older rows —
`view_filter.ports narrows relations` and `types ['*'] widens beyond the default slice` —
FAIL in this build and identically in the f1c192b build: they request frames with no
access posture, which is anon, 1 node.

## What no automated check can reach

- whether a real click's clipboard write lands on the OS clipboard (the blocked path is
  proven graceful: `{ ok: false, message: "clipboard write was blocked by the browser" }`)
- the Document-PiP open path, which requires a user gesture
- scratch mirroring between two *real* windows (the channel logic is asserted; the two-window
  case is not)
- the Settings custom-engine form and the manifest's host permissions — no gate drives
  them. They were exercised once at t337 in a throwaway Chromium with the unpacked `dist/`
  (type the pair, apply, reload, read the audit drawer); `smoke:worker` covers the stored
  `pilot.engine` override only for a fleet engine
- the graph drawing itself — boxes, relation styles, legend ticks, the kept zoom and
  pan, the refit, the drag that pans. Cytoscape needs a browser; "Drawing the knowledge
  graph" and "Drawing the whole fold" say what was looked at. What is asserted is what
  it is asked to draw: which
  node sits in which box and which layout `auto` picks (`smoke:live`)
- a mirror drawing what the panel asks for — the layout choice, the search fade, the
  centring on a relation row. `selftest.html` asserts that the scratch-view channel
  delivers; that a mirror then draws it was looked at ("Finding and inspecting…")
- whether the UX is any good

## Known-honest limits, deliberately not hidden

- `ACCESS: PRESENTATION` is not enforcement: the full fold crosses the wire and access only
  changes what is rendered.
- The log feed shows the **whole engine log**; workspace-level access presentation does not
  narrow it. Server-side slice filtering is the ruled follow-up.
- `t_day ≤` filters only nodes that carry a `t_day` property — 7 of 288 on the live fold — so
  it is not a fold-at-t projection. A real one exists on the kernel (`GET /fold?to=<log_seq>`)
  but on the log-sequence axis, and the MCP read path (`graph_state`) has no equivalent
  parameter.
