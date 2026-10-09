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
menno twin is not up — the surfaced case reports SKIP rather than silently passing. Since
t342 (P1/P6) it also asserts that the shipped adapter stamps the engine's grammar into
provenance — `status: "engine"` with the engine's own `ontology_version`, or `"absent"` with
its reason — and the permitted fold's vocabulary (`fold_vocab`), which the drawer reads; and,
where the twin (B2) or the Z440 primary (B3) answers, that a surfaced or overridden frame
carries the grammar of ITS engine, never the default engine's (the cache is per engine).

**`smoke:live`** proves the slice law twice: on a synthetic chain (ports narrow relations;
hops expand only along retained ports) and on the **live fold** (the content lens loses no
node or relation the legacy default showed; `["*"]` reaches the whole fold; hops widen a real
focus monotonically). Until t342 one assertion there earned its keep long-term: **every live
relation label must be reachable in the drawer** — it caught `guards` and `participates`
being unreachable. Since t342 (P6) the drawer's vocabulary is no hand copy in the script (that
copy missed ten labels on hp-laptop's kernel, the whole substrate group among them): it is the
real `drawerVocab` of `GraphControls.tsx` over the engine's own grammar — the static lens
lists, then the types and source ports the engine declares on `/operad/node-types` and
`/operad/rewrite-categories` (additional pairs included), then the permitted fold's own
labels, which is how a label no operad declares stays reachable. That last group makes the
reachability asserts hold by construction: they now guard `drawerVocab` itself, not the
lists, and the gap they used to catch — a live label no list names — is a measured line
instead (`live labels … reachable only because the fold carries them N [names]`). The same
block asserts (d) every live type and every type the engine declares reachable, (h) every port a lens names
declared — by the connected engine, by the knowledge vocabulary, or on the commented legacy
list `LEGACY_PORTS` (`realizes`, `cites`, `curates`: in no operad and no live fold at t342) —
and (i) the port colours of the live fold as FrameGraph DRAWS them — its real `toElements`,
`STYLE` and `applyPalette` in headless Cytoscape: in port colour no relation in the
relation-kind palette and each in its κ hue, two tones, glyphs and marker; switched to relation
kind, none left in port colour (see "Port colours and the engine's grammar"). It
also exercises the **A16 surface→channel→engine resolution** with the code the
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

Measured at t342 (hand-off A) on two engines. The scratch kernel through its `:8086` proxy
(both variables set to that origin; mtdc-2.1.0, log 1019, now reporting its `kernel_urn`):
the whole run passes — 25 live labels and 31 live types reachable (all 25 labels in the static
lists, 0 reachable only through the fold), all 56 declared types reachable, every lens port
declared by the engine (36 names, `realizes` on the legacy list), 0 of 416 drawn relations in
the relation-kind palette in port-colour mode, 0 left in port colour after the switch.
hp-laptop's kernel (default env, 4.0.7, 597 relations, 597 drawn in κ, 0 after the switch):
passes too — 7 live labels are the source port of no declared pair
(`depends-on`, `focus`, `produces`, `scheduled-after`, `steers`, `summarizes`, `tagged`), the
three of them the static lists lack form the drawer's `undeclared pair` group, and the eight
knowledge ports are declared by the knowledge vocabulary, not by 4.0.7. Four access lines name
what only the Z440 primary's fold holds — the seats `sam.kernel-proper` and `sam.moos-diary`
and a member-of chain from `user:sam` to `group:sam` / `group:moos`. Where the fold holds no
such seat or chain (the laptop kernel) that line reports SKIP instead of failing; on scratch
all four still run and pass.

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
over the whole fold, and a narrower lens holds less without moving that number; and
`provenance.fold_vocab`, the names the drawer offers from the fold, lists no type of a withheld
node and no label of a relation touching one, for anon and identified, whatever the lens. G (t342)
holds the unlinked band to the nodes no relation of the CURRENT frame touches — a seat whose
only relation runs to a withheld seat is unlinked there — on the real `unlinkedUrns`, loaded
from `FrameGraph.tsx` the way `smoke:live` loads it. H (t342 P1) is the port-colour fixture:
a SYNTHETIC grammar (synthetic port names and colour families — no operad data enters this
repo) through the real `engine-grammar.js` and `port-colour.js` gives one hue for a relation
whose ends share a family, two tones for one whose ends do not, and each of the three states
its own glyph on a neutral grey, never a hue — exempt (`⊣` / `▸⊣`), uncoloured (`○` / `○▸`),
undeclared pair (dotted, `◇` midway); a family keeps its hue whatever order the engine lists
its ports in; a frame without a grammar draws every relation by relation kind; what FrameGraph
DRAWS — its real `toElements`, `STYLE` and `applyPalette` in headless Cytoscape — matches:
every relation in its κ (hue or two tones, end glyphs, the undeclared marker, a grey end always
with its state's glyph) and, switched, every one back in relation kind (a knowledge relation in
its vocabulary colour); the node fills (types and claim kinds) share no colour with the eight
hues, none of them nor the state grey is within OKLab ΔE 3 of a fill, and no close pair exists
beyond those listed under "Limits" below (a new one fails); and no code under `src/` names
`src_color` or `tgt_color`. I (t342 P6) runs the real `drawerVocab` on a synthetic grammar:
the static groups first and unchanged, then one group of the types and source ports the
engine declares, then the fold's undeclared labels (no target-only name, no `{placeholder}`
the fold does not carry — one it carries on a declared pair is an engine port, not an
undeclared one); an untick expands from all of it and ticking back returns to the sentinel;
without a grammar the static lists stand alone and the note says so; the legacy list is one
group of its own.
H also holds the read itself on an injected fetch (offline): `color_rule` / `color_source` are
read when the engine states them (K1) and "not stated" when it does not (today's
`{matrix, port_colors}`); a body carrying only `matrix` colours nothing; a relation carrying an
empty `src_color` / `tgt_color` paints, through the real `selectFrame`, exactly as one without
them (0 exempt ends); three GETs per (engine, `ontology_version`), then the cache; a 404 on
the node types is `absent` and cached; a 404 on the port colours alone keeps the engine's
pairs and types (the drawer's engine groups stand) and draws relation kind; a route that does
not answer is cut at the timeout — `absent`, marked unreachable, kept for the back-off only —
and the check races a test deadline, so a timeout that stops cutting fails instead of hanging.
J (t342 P2/P3) holds the `nested` drawing outside the boxes and the sources inside them, on a
SYNTHETIC frame whose urns and types interleave its five loose components (36, 6, 5, 2 and 1
nodes), three boxes (one inside another) and seven sources, through the real
`src/ui/component-layout.js` and FrameGraph's real `drawingPlan`, `runLayout` and STYLE in
headless Cytoscape (which measures no text: labels count as zero-size there). Pure rules first:
the components; the breadth-first layers, exactly — the chain n03 / n02, n04 / n01 / n00 and the
star's hub over its five leaves; the cose bound (none at 30 nodes or at 2000, at most 100
iterations, each anneal ending at its floor) and ONE budget of 1.5 M pair-steps per frame,
largest component first (ten components of 170 nodes: 100 iterations for the first, none for the
rest; 287 / 158 / 40 / 31 nodes: 36 / 0 / 0 / 48); and `separateLabels` taking 24 label boxes
dropped on one point from 276 overlapping pairs to 0. Then the drawing: every linked node outside
a box gets its position from exactly its own component; the components and the top-level boxes
occupy disjoint rectangles while urn order and type order change component 21 times — so no urn
or type grid between components — and each component of 30 nodes or fewer is drawn layer by
layer, every layer strictly above the next (the chain one row per layer) — so none inside one;
only the 36-node component is cose-refined (100 iterations), its related nodes closer than its
average pair; each source sits in the box that cites it most (a tie to the first by urn, a
box's own citation counted, the inner box first) and the other citing box carries `elsewhere` 2
(`↗2`); every node id is a frame urn and every line a frame relation; with the nesting relation
unticked every source is in a component, the components' rectangles are disjoint there too (a
source moved out to a column would stretch its component's rectangle over the others) and the
small ones are drawn layer by layer; the frame read in reverse order draws the same 66
positions; laid out again at a 380 × 155 and a 1600 × 393 canvas, no node moves inside its
component, and a second run on the same instance moves none; and a frame of four 110-node
components gets 100, 100 and 50 iterations, the fourth breadth-first. J was run once at t342
against deliberately broken copies of the layout, and each copy fails it: one urn grid over all
the loose nodes (five checks), one urn-sorted layer per component, components placed without
their relations, the small components on one urn row, the sources moved to a column when no
box is drawn, cose on the panel's own canvas (the 36-node component moved by up to 131 px),
label boxes off their grid (a second run moved all 66 nodes), and a cose budget per component
(in the helper, or FrameGraph ignoring the frame's).

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
  measured runs used. A tailnet route to the scratch kernel is not listed: this repo is
  public (a local manifest overlay is work order P5). Since t342 that kernel's `:8086`
  read-only proxy serves `GET /healthz`, `/fold`, `/fold/stream`, `/log` and `/state/*`, the
  MCP endpoint `/sse` (the read tools `smoke:live` calls), and exactly three operad routes —
  `/operad/node-types`, `/operad/rewrite-categories`, `/operad/port-colors`; any other
  `/operad/*` path answers 404. That is enough for `smoke:live` with both variables set to
  that origin and for the live harness with `?engine=`;
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
  98 relations as lines; 38 sources drawn inside the box of the node that cites them (t342 P3;
  a source cited by several boxes goes to the box with the most knowledge relations to it, and
  the other boxes show ↗N — see "Components and sources in their box"); 0 overlapping labels (leaf labels,
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
  38 sources inside the boxes that cite them (t342 P3), 0 labels overlapping (before: all 38
  on one point, or 12 labels overlapping). Two presses of `re-layout` give the same positions in every legend
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
was a plain grid above the boxes (t342: the unlinked go to the band under the drawing, and
since P2 each connected component of the linked ones is laid out on its own — "Components and
sources in their box") — and `auto` picks `nested` as soon as ONE node sits in a
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

## Port colours and the engine's grammar (t342, work orders P1 and P6)

**The grammar is read, not written.** At frame load the worker's adapter (and the live
harness, and `smoke:live`) reads `GET /healthz` and the three operad routes —
`/operad/node-types`, `/operad/rewrite-categories`, `/operad/port-colors` — through
`src/mcp/engine-grammar.js`, once per (engine, `ontology_version`) — in the adapter and the
live harness as soon as `/healthz` answers, beside `graph_state` / `/fold` — and stamps the
result into `provenance.grammar`, so the mirrors draw from the same grammar through the session
store. Each GET is bounded (`GRAMMAR_TIMEOUT_MS`, 8 s), so a frame waits for its grammar 8 s at
most; a route that does not answer gives `absent` marked unreachable (the legend, the drawer
note and the audit drawer say "did not answer", not "serves no /operad/*"), and that answer is
kept for `GRAMMAR_RETRY_MS` (60 s) — a hung route delays one frame per minute, not every
fold-stream re-read.
Read: the declared pairs (main and additional), the declared types, `port_colors`, and
`color_rule` / `color_source` when the engine states them (K1 builds). Never read: `matrix`,
a relation's `src_color` / `tgt_color` (empty on every relation today: read, they would make
every end "exempt"), and the kernel's type law — the pilot checks pairs only; the workbench's
check 8 rules on admission. An engine without the routes stamps `absent` with its reason; the
frame still lands, the drawer offers its static lists and the graph draws relation kinds, and
both say so. An engine that serves node types and rewrite categories but no port colours keeps
both in the drawer and only the graph falls back to relation kind. No operad data, no colour
map and no mtdc-only name is written into the repo; the measured counts below are by hue slot,
not by the engine's family names.

**The drawing** (decision 2: port colour by default). Every relation end is drawn in κ(port):
one hue when both ends share a colour family, two tones split at the middle when they do not.
Three states are not colours and get a glyph on a neutral grey, never a hue: exempt (`κ = ""`,
only on 98f2ccc kernels with 4.0.x — one port on hp-laptop's kernel; a tee at the source
end, a tee behind the arrow at the target end), uncoloured (the port is not in the map; a
hollow circle / a circle before the arrow) and undeclared pair (dotted, a hollow diamond
midway). Never by rewrite_category. The eight hues are the dark steps of the dataviz reference
categorical palette, validated on the canvas colour `#0f0f12` for NEIGHBOURING slots
(lightness band, chroma, CVD ΔE 8.4, normal-vision ΔE 19.3, contrast ≥ 3:1), assigned to the
family names the engine reports in sorted order (slot n = the n-th name). A graph is not a
stack: any two families can meet, and over all 28 slot pairs no ordering of eight hues clears
those floors — the reference palette's own series cap — so a family is never told by hue
alone: the port name rides on every port-colour line (held to the label cut) and the legend
names each family with its count. Node fills stay the type palette and share no colour with
them (`smoke:lens` H, which also holds the close pairs under "Limits" below). The legend's
**colour by: port colour | relation kind** switch brings back the relation-kind palette — the
knowledge vocabulary's colours and dashes, the default line for every other port — labelled
as such. Like the legend ticks it is not saved. The inspector's relation rows follow the
same switch: in port colour a row takes κ of the port named from the selected node's end (a
state end the grey), in relation kind the vocabulary's colour, and the row's tooltip says which.

**The drawer** (P6) offers the static groups, then `engine <ontology_version>`: the types and
source ports the engine declares that no static group names, then `undeclared pair`: the
permitted fold's labels the engine declares as no source port. A note above the groups says
which. An untick expands from all of it (`specToggleType` / `specTogglePort` take the base).
The audit drawer shows `grammar` (the engine operad version, its pair and type counts),
`κ source` (where the port colours came from, with the rule and source the engine states)
and `kb-vocab` (the relation-kind palette's vocabulary and its ontology).

Measured at t342 by `smoke:live` (i), whole fold, port-colour palette (relation ends per hue
slot — slot n is the n-th of the eight family names the engine reports, sorted, and draws in
`KAPPA_HUES[n-1]`; both engines report the same eight names — then the three states, and the
relations FrameGraph draws in the relation-kind palette):

| engine | relations | slot 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | exempt ends | uncoloured ends | undeclared pairs | two-tone | drawn in relation kind |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| scratch, mtdc-2.1.0 | 416 | 50 | 0 | 0 | 374 | 66 | 60 | 86 | 196 | 0 | 0 | 0 | 0 | 0 |
| hp-laptop, 4.0.7 | 597 | 20 | 0 | 0 | 0 | 233 | 128 | 70 | 741 | 2 | 0 | 56 | 3 | 0 |

Drawer on mtdc-2.1.0: +19 types and 8 ports from the engine, all 56 types reachable; on
4.0.7: +19 types and 7 ports, and `steers`, `summarizes`, `tagged` under `undeclared pair`.

Looked at, not asserted — the built `dist/preview-live.html` served from `127.0.0.1`, in the
desktop app's browser pane, 380 px panel, identified as `urn:moos:user:sam`, `everything`:

- scratch (`?engine=` the `:8086` origin): all 332 drawn lines (412 relations in the frame,
  80 of them boxes) carry the port-colour style, none the relation-kind one; switched to
  relation kind, none does, `part-of` / `derived-from` are back in their vocabulary colour
  (the latter dashed) without port text, `routes-to` the default line with its name;
- hp-laptop's kernel: 579 lines in port colour; 3 two-tone (a gradient split at 50 %), 56
  dotted with the diamond midway, the one exempt line grey on its source half with the tee
  there and in its target family's hue on the other half; the drawer note reads `+19 types and
  7 ports the engine declares (ontology 4.0.7) · 3 labels on no declared pair`; the audit
  drawer reads `engine operad 4.0.7 · 35 port pairs · 56 types` and the `κ source` line.

Limits, not hidden: hues follow the sorted family names, so an engine reporting another set
of families would give some of them other hues (the legend names each, with its count); a
ninth family would get no hue of its own (drawn grey, "no hue left"). Close colours, OKLab
ΔE ×100 (the dataviz metric; `smoke:lens` H fails on any pair not listed here). κ against κ,
under 15 over all slot pairs (the neighbouring-slot floor is 19.3): slots 2/8 7.1, 5/8 7.8,
1/7 9.8, 2/4 10.6, 2/5 11.6, 3/6 11.9, 4/8 13.0 — on hp-laptop's kernel slots 5 and 8 are
the two largest families (233 and 741 ends), told apart by the port name on the line and the
legend, not by hue. κ against a node fill, under 10: slot 7 / `conjecture` claim kind 3.2,
slot 5 / `claim` 5.7, slot 8 / `agent` 6.5, slot 5 / `agent` 7.2, slot 1 / `workstation`
8.0, slot 3 / `standing` claim kind 8.6, slot 2 / `user` 8.7, slot 8 / `user` 8.8, slot 1 /
`knowledge_item` 8.9, slot 4 / `user` 9.2, slot 2 / `agent` 9.3, slot 3 / `kernel` 9.3, slot
7 / `grammar_fragment` 9.9 — kept apart by the mark (a line, not a disc) only. The state grey
sits at 3.6 from the `superseded` claim kind and 4.4 from `domain_tag` (it marks a line end
that also carries a glyph). The eight κ hues are the reference palette's documented steps
and the fills the type palette of #45; with 26 fills around the hue circle no documented
step clears ΔE 10 from all of them. A `{placeholder}` port (a template name in braces)
is never offered from the engine; a fold that carries one as a label on its declared
pair gets it in the drawer's engine group, as the graph draws it (declared) — neither fold
carries one at t342.

## Phase-1 open points (t342, decision 4)

Sam's three picks, kept as they shipped in #45 and recorded here: the label cut falls at a
zoom step (labelFloor / `LABEL_ZOOM`, 0.5 at 100 % display scaling — see "Drawing the whole
fold"); relation labels follow the same cut, the port names a port-colour line carries
included; and the `unlinked N` chip's state is not saved — neither are the legend ticks nor
the new `colour by` switch. Nothing of the three changed in hand-off A, nor in hand-off B.

## Components and sources in their box (t342, work orders P2 and P3)

**Before.** Under `nested` the linked nodes no box holds stood on one grid above the boxes,
sorted by urn — 179 of them on the scratch fold under `urn:moos:user:sam`, lens
`everything` — and the 38 knowledge sources the boxes cite stood in a column right of the
drawing.

**Components (P2).** The linked nodes outside every box are split into connected components —
over every relation of the frame between two of them, ticked in the legend or not, so unticking
a port does not rearrange the drawing — and each is laid out on its own
(`src/ui/component-layout.js`):

- breadth-first: the root is the node with the most neighbours (ties: the smaller urn), each
  further layer the nodes one relation further out, in the order their parent was placed and
  then by urn; a layer longer than about twice the square root of the component's size wraps;
  every cell is as wide as the component's widest label box, so no two labels overlap;
- a component of more than 30 nodes is then refined by Cytoscape's `cose` over that component
  alone, seeded from the breadth-first placement; its iterations are bounded so that node pairs
  × iterations stay at or under 1.5 million for the WHOLE FRAME — the components draw on that one
  budget largest first, at most 100 iterations each and at least 30 (a component left fewer
  stays breadth-first and spends nothing, so one above 316 nodes always does) — and it anneals
  to its floor within them. (Until the t342 review the bound was per component, and ten
  components of 170 nodes took 4.9 s of CPU in `runLayout`; with one budget per frame they take
  1.3 s.) Label boxes it leaves
  overlapping are then pushed apart (`separateLabels`: sweeps that move each overlapping pair
  half the overlap apart, and, where a crowd remains, a 5 % spread from its centre between
  rounds; the layout report counts what is left). There is never a cose over the whole frame
  (see "First paint" for what one costs);
- the components and the top-level boxes share the shelf rows, tallest first; the unlinked band
  stays under everything, as before.

The same frame always draws the same picture: components, layers and cose's input are taken in
urn order (cose draws a random number only for two nodes on one point, which a breadth-first
seed never has), and cose runs on a detached headless Cytoscape of its own, never on the
panel's instance. It pulls toward the middle of its canvas and, with these options, it is
chaotic — one seed coordinate moved by 1e-12 px moved nodes by up to 390 px (a 36- and a
158-node ring with chords; the same seed twice gives the same picture) — so until the t342 review
the panel's canvas reshaped the large component: 380 × 227 at the first paint, 380 × 155 once
the legend settled, 1600 × 393 in a tab, each a different shape (the review measured up to
147 px on the scratch fold in the browser; J's frame headless, up to 131 px), and the first
re-layout after the canvas settled rearranged it. Now each node is a box of its measured label box on an instance whose
size never changes, and label boxes are measured on a 1/4096 px grid (a bounding box carries
rounding from where the node stands, which a second run used to amplify) — so a component's
shape depends on the frame alone: the same in the panel, the popup and the tab, and on every
run. `smoke:lens` J reads a frame in reverse order and gets every position back, lays it out
again at two canvas sizes and twice on one instance.

**Sources in their box (P3).** A `knowledge_item` no box holds is drawn inside the box that
cites it — the box of a node one of its knowledge relations reaches, or that node itself when it
is a box, so of two nested boxes the inner one wins. Cited by several boxes, it goes into the
FIRST: the box with the most knowledge relations to it, then the smaller urn. Each other citing
box shows `↗N` after its title — N of the sources it cites are drawn in another box — and the
relation lines still run there. Inside a box the sources form their own grid under the box's own
nodes, as smaller discs with a quieter label. The box is a presentation-only parent: node ids
stay urns, no relation is added, nothing is written back, and the inspector lists a source's
relations as before. With the legend open, the nodes group says how many sources sit in a box
and what the marker means. With the nesting relation unticked (no boxes since a36b0b3) every
source lays out with its component. No layout draws the column any more.

**The other layouts.** `concentric` (rings by type rank), `breadthfirst` (a tree by depth) and
`grid` (picked to be a grid) never put the linked part on a urn grid and are unchanged; ring,
tree and grid keep the unlinked band of t342. `auto` is `nested` exactly when a box is drawn —
the scratch fold — and `concentric` otherwise — hp-laptop's kernel (4.0.7) — as before, so the
laptop's panel opens as it did; `nested` picked there lays its components out the new way.

**First paint (`npm run bench:frame -- --layout --user urn:moos:user:sam`).** Each iteration is
the road to the first drawing on the panel's own code: the `graph_state` read and parse, the
real `selectFrame` (lens `everything`, identified as that urn), FrameGraph's real `drawingPlan`
and its real `runLayout` with the real STYLE in headless Cytoscape — which measures no text, so
labels count as zero-size and the canvas paint itself is not in it. Every step is reported in
wall time, in the process's CPU time and in the main thread's (`process.threadCpuUsage`, in
recent Node releases; Node 24 here). The budget, `FIRST_PAINT_BUDGET_MS` = **3000 ms**, holds
the pilot's share — the main thread's CPU time of transform + plan + layout, p95 over the
iterations (10 here; the first, cold one is the p95) — and the script exits 1 above it; a Node
without `threadCpuUsage` holds it against the process's CPU time, which is higher, and says so.
The read is the engine's and the network's share and is reported, not budgeted. CPU time rather
than wall: other sessions kept this seat busy, and while it was saturated (load 100 %) the wall
clock ran three to four times the CPU time without the code changing. The main thread rather
than the whole process (hand-off B verification): the process's CPU time also counts V8's
background compiler and garbage-collector threads, which do not hold the paint — at the cold
first iteration it was 1.5 to 2.3 times the main thread's in every run below — and with the seat
saturated it put two of the nine "after" runs below over 3000 ms (3 390 on scratch, 4 094 on
hp-laptop `nested`; the main thread spent 1 984 and 2 250 ms), and one earlier scratch run at
3 266, with the code unchanged. "Before" is d7a21f9's FrameGraph with `runLayout` exported and
nothing else changed (`--framegraph`), the same bench, run back to back with "after", 10
iterations each, the order alternating; three pairs per row, the seat at 11 to 100 % load. Each
cell is the range over the three runs, in ms:

| engine, layout | build | read wall p50 | layout main p50 / p95 | pilot's share main p50 / p95 | pilot's share process p95 |
|---|---|---|---|---|---|
| scratch, mtdc-2.1.0, 445 nodes · `auto` → `nested` (19 boxes) | before | 493–788 | 422–921 / 703–1 047 | 453–1 000 / 751–1 203 | 1 421–2 142 |
| | after (8 components, 158 the largest, 100 iterations) | 538–836 | 579–1 235 / 1 328–1 766 | 610–1 329 / 1 500–1 984 | 2 390–3 390 |
| hp-laptop, 4.0.7, 524 nodes · `auto` → `concentric` | before | 46–127 | 250–672 / 406–1 063 | 297–812 / 578–1 328 | 1 297–2 500 |
| | after | 46–159 | 328–734 / 453–1 156 | 375–828 / 562–1 297 | 1 218–2 485 |
| hp-laptop · `nested` picked (no box: 10 components, 287 the largest, 36 iterations) | before | 39–68 | 312–593 / 531–860 | 359–655 / 656–1 078 | 1 515–2 015 |
| | after | 35–97 | 562–1 078 / 984–1 984 | 594–1 156 / 1 109–2 250 | 2 173–4 094 |

Every one of the 18 runs stayed within the budget on the main thread — the largest pilot's share
p95 2 250 ms (hp-laptop `nested`, after, the seat at 97 %), 1 984 ms on scratch. `auto` on
hp-laptop's kernel draws the same `concentric` before and after, so those two rows differ by
noise alone; read differences between before and after under that spread as noise too. Before
this pass seven scratch pairs and six hp-laptop pairs had been taken on the process's CPU time,
and every one of those runs stayed within the budget (largest p95 2 860 ms, hp-laptop `nested`,
after).

The layout's CPU is mostly Cytoscape applying the stylesheet to every element the first time
(half or more of it in a CPU profile, before and after alike). In this pass, on the main thread,
the layout's p50 grew by 94 to 453 ms on scratch and by 250 to 485 ms with `nested` picked on
hp-laptop's kernel (three pairs each). In the earlier pairs, in process CPU: on scratch — the
frame that opens `nested` — the layout's CPU at p50 grew by 30 to 490 ms across its seven
pairs: the bounded cose (158 nodes, 100 iterations) adds work and the packer sheds some — it
now reads each box's shown children and title once per run instead of once per candidate shape,
and no longer builds the source column. With `nested` picked on hp-laptop's kernel, where the
old drawing was one grid, the cose of its 287-node component (36 iterations) adds 0.2 to 0.65 s
of CPU (six pairs); `auto` there is `concentric`, unchanged. The review round's changes — cose
on a detached instance, label boxes on a grid, one budget per frame — cost nothing measurable:
alternating 14 runs each in one process on one frame read once, `runLayout`'s CPU p50 was
1 157 ms before them and 1 110 ms after on scratch, 1 110 and 1 204 ms on hp-laptop `nested` (a
busier seat by then). The label pass is nearly free headless (labels have no size there); with
label-sized boxes it took about 150 ms on that 287-node component (measured offline, 301
overlapping pairs to 0). A cose over the whole frame, for comparison (headless, Cytoscape's
default options, styles already applied): 7.2 s of CPU on the scratch fold without boxes,
11.4 s with them, 13.1 s on hp-laptop's kernel (process CPU, a busy seat); on the main thread
in this pass, the seat at 29 % load, 3.6, 4.9 and 6.7 s — each above the budget on its own,
before any style or fit, which is the regression the budget is there to catch.

**Looked at, not asserted** — the built `dist/preview-live.html` served from `127.0.0.1`,
`?engine=` the scratch proxy (GET only), identified as `urn:moos:user:sam`, `everything`, the
380 px panel (canvas 380 × 227 at the first paint, 380 × 155 once the panel settles), real label
sizes, in headless Chrome; every layout run recorded from the page's Cytoscape instance and
rendered with its `png()` — taken again after the review round:

- 445 nodes, 19 boxes; 38 sources inside 12 boxes; 17 boxes carry a `↗N` marker (30 citations
  of a source drawn elsewhere); 0 nodes in a column; 145 in the unlinked band;
- outside the boxes 8 components (158, 6, 5, 3, 3, 2, 2, 1), the 158-node one cose-refined
  (100 iterations); 0 overlapping label boxes among the 180 nodes outside a box once the label
  pass has run;
- every run kept every component's shape. In two sessions (a 1366 × 900 and a 1600 × 1100
  window): the first paint (380 × 227 / 380 × 338), re-layouts at the settled panel (380 × 155 /
  380 × 262), at the first paint's size again, and on a tab-wide canvas (1366 × 176 / 1600 × 288)
  — 0 px change inside any component across all of them (before this round the review measured
  the 158-node component changing by up to 147 px between the first two). Runs at one canvas
  size give the same 445 positions whatever ran in between (`re-layout` twice: 0 differ);
- the first paint's drawing is 5072 × 2716 model px, fitted at zoom 0.045 once the panel settles;
  a re-layout there packs it for that canvas, 6301 × 2613 at 0.047 (the grid drawing of t342:
  0.052 to 0.058): the components spread wider than the grid they replace. On a 1600 × 288 tab
  canvas the two wider shelves added for P2 put the large component and the largest boxes on one
  row: 6771 × 2313, fit zoom 0.11;
- the legend's nodes group ends `38 sources drawn in the box that cites them · ↗N on 17 boxes:
  N cited sources drawn in another box`, its tooltip giving the order rule;
- the nesting relation unticked: 0 boxes, 0 sources in a box, 0 in a column; the 300 linked
  nodes in 8 components (158, 121, 6, 5, 3, 3, 2, 2), the two largest cose-refined with 100 and
  35 iterations — the frame's one budget —, all 72 linked sources among them, 0 overlapping
  label boxes, a re-layout moving none; ticked again, the 19 boxes and 38 placed sources return,
  every component in its shape;
- looked at again in the hand-off B verification pass, on the scratch fold at seq 1030, at the
  380 px panel and with the app widened to a 1600 px tab (canvas 1600 × 288), nesting on, off and
  on again: the same counts as above; of the linked sources outside a box (34 with nesting on,
  72 with it off) none is a component of its own and none stands right of every other linked
  node; no console error.

Not looked at: hp-laptop's kernel in the harness (`auto` draws `concentric` there, the code path
unchanged; `nested` picked is timed above and covered by `smoke:lens` J) and the extension's
side panel itself.

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
  pan, the refit, the drag that pans, and (t342) the port-colour gradient and glyphs. Cytoscape needs a browser; "Drawing the knowledge
  graph" and "Drawing the whole fold" say what was looked at. What is asserted is what
  it is asked to draw: which
  node sits in which box and which layout `auto` picks (`smoke:live`), and (t342 P2/P3) where
  `nested` places the nodes outside a box and the sources — headless, so without label sizes
  (`smoke:lens` J)
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
