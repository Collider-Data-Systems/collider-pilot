# collider-pilot

The Collider Pilot is the browser **harness** surface for mo:os — a thin,
provider-neutral MV3 extension (side panel as the persistent seat, Document PiP as an
optional always-on-top mirror) that projects a purpose-selected, timestamped HG frame
from an engine over MCP Streamable HTTP, and lifts only user-approved observations and
tool intents back through the four rewrites; it is not an engine, owns no graph
identity, and the append-only rewrite log remains the sole source of truth. Revival per
[ffs0#158](https://github.com/Collider-Data-Systems/ffs0/issues/158) (Steinberger
readback T=260, decisions D1-D6 approved).

**Status: Phase 0-3 merged to `main`; Phase 4 built on `feat/phase4-tools`** — provenance
preserved, sources pinned, secret-scanned, legacy builds attempted (see
[PROVENANCE.md](PROVENANCE.md)); on top of that, a clean read-only MV3 side-panel shell
(narrow manifest, Cytoscape inspector); the **live MCP read path** — a
`StreamableHttpMcpAdapter` that reads a live, purpose-selected HG frame from the Z440
primary engine over MCP Streamable HTTP (read-only); the **Document Picture-in-Picture
mirror** — an always-on-top compact mirror opened from an explicit button, sharing ONE
state store, feature-detected, degrading gracefully; and now **controlled tools + model
targets** — the FIRST apply capability, where every mutating act is gated behind a
confirmation UI, tool calls are structured (never text-parsed), and HG rewrites produce a
REVIEW-ONLY program preview that is **never posted** (no live HG write exists). Legacy
lineage lives on `legacy/pilot-2026-01` and `legacy/sidepanel-2026-01`; `main` stays clean.

## Phase plan (from #158)

- **Phase 0** — preserve and prove provenance (this repo, done)
- **Phase 1** — side-panel shell: narrow MV3 manifest, persisted state across worker restarts, mock MCP adapter, Cytoscape inspector on a fixed typed frame; no model, no writes
- **Phase 2** — live read path (**this branch**): MCP Streamable HTTP to the Z440 primary engine, read-only frame/node/relation tools, retry/reconnect; the extension defaults to the live adapter
- **Phase 3** — Document PiP mirror (**this branch**): opened from an explicit side-panel button, same shared state store, feature-detected, graceful degradation
- **Phase 4** — controlled tools and model targets: MCP affordance discovery, structured tool calls only, confirmation UI for every mutating act, provider-neutral model adapter
- **Phase 5** — optional high-rate data plane (WebTransport) only behind measured need

## Phase 1 — read-only side-panel shell

A clean MV3 extension that opens a side-panel "seat", asks a **mock** MCP adapter for a
fixed typed HG **frame**, and renders it: a provenance header, a Cytoscape graph, and a
textual node inspector. No model, no network, no page access, no writes.

### Build

```bash
npm ci
npm run build     # -> dist/  (load-unpacked target)
npm run typecheck # optional: tsc --noEmit
```

Then, in Chrome/Edge: `chrome://extensions` → Developer mode → **Load unpacked** →
select `dist/`. Click the toolbar action to open the side panel.

### Layout

```
sidepanel.html                     side-panel entry (React root)
src/sidepanel.tsx                  the seat: fetch frame, restore scratch, compose UI
src/sidepanel.css                  dark theme
src/worker.ts                      MV3 service worker (opens panel; serves frame via factory)
src/mcp/types.ts                   HgFrame / HgNode / HgRelation / provenance + McpAdapter (the seam)
src/mcp/fixture.ts                 the fixed typed frame (real seat model, t259/t260 nodes)
src/mcp/mock-adapter.ts            MockMcpAdapter — returns the fixture, no I/O
src/mcp/transform.js               SHARED pure fold -> HgFrame transform + view_filter (Phase 2)
src/mcp/streamable-http-client.js  SHARED read-only MCP/REST transport (Phase 2)
src/mcp/streamable-http-adapter.ts StreamableHttpMcpAdapter — live read (Phase 2)
src/mcp/adapter-factory.ts         mode switch: 'mock' | 'live' (extension defaults live)
src/state/scratch.ts               chrome.storage.session helpers (selection + frame cache; onChanged subscription — Phase 3 shared store)
src/components/                    ProvenanceHeader · FrameGraph (Cytoscape) · NodeInspector · ActionsPanel + ConfirmActionModal (Phase 4)
src/tools/types.ts                 controlled-tools contract: ToolKind/ToolChannel, ToolSpec, AffordancePack, ToolCall, PendingAction (Phase 4)
src/tools/tool-call.ts             structured ToolCall validator (args_schema JSON-shape check; NO text parsing) (Phase 4)
src/tools/affordance.ts            affordance-pack projection: tools/list classify + curated acts + mock fallback (Phase 4)
src/tools/browser-acts.ts          the clipboard browser act executor (local; runs on Confirm) (Phase 4)
src/tools/hg-program-preview.ts    REVIEW-ONLY WF19 pins-urn apply_program preview builder (stringifies; NEVER posts) (Phase 4)
src/tools/model-providers.ts       provider-neutral model registry + WebGPU capability stub (seam; no calls, no keys) (Phase 4)
src/pip/document-pip.d.ts          ambient Document PiP types (not yet in lib.dom.d.ts) (Phase 3)
src/pip/pip-content.tsx            PipContent — pure compact frame view (reused by the PiP window + the pip-preview harness) (Phase 3)
src/pip/pip-window.tsx             Document PiP controller: gesture open, shared-scratch sync, style adoption, teardown (Phase 3)
preview.html / src/preview.tsx     dev harness on the MOCK adapter
preview-live.html / preview-live.tsx  dev harness on the LIVE adapter (CORS-blocked from a served page)
pip-preview.html / src/pip-preview.tsx  dev harness rendering the PiP content view standalone (served-page testable) (Phase 3)
scripts/live-smoke.mjs             headless live-read proof (Node; no CORS)
public/manifest.json               narrow MV3 manifest
public/icons/                      toolbar icons (from legacy/sidepanel-2026-01)
```

### What is mocked / stubbed in Phase 1

- **Everything past the `McpAdapter` boundary.** `MockMcpAdapter.getFrame()` returns a
  fixed fixture (`src/mcp/fixture.ts`). There is no MCP client, no transport, no session,
  no engine connection, no `Origin` handshake, no auth — none of it exists yet.
- **The frame is data, not a live read.** `provenance.mock === true` and `folded_at` is a
  fixed timestamp. The urns/log_seq/t_day are realistic (engine `hp-z440.primary`, session
  `sam.z440-cowork-workspace`, purpose `sam.cowork-workspace-curation`, the t259 access-law
  / symmetries derivations held at gate 2) but nothing is fetched.
- **No model, no writes, no page access.** No provider/LLM, no rewrite/apply path, no
  content script, no `<all_urls>`. The four rewrites (ADD/LINK/MUTATE/UNLINK) are not
  reachable from this build.
- **`view_filter` is advertised, not applied.** Phase 1 returns one fixed frame; the
  request's filter is ignored (the provenance still states the filter the fixture stands
  for).

### What is real in Phase 1

- Narrow MV3 manifest (`sidePanel`, `storage`, `activeTab`; host_permissions limited to
  `http://localhost:8080/*` + `http://localhost:8000/*`; no popup so `action.onClicked`
  opens the panel).
- Service worker holds **no correctness-critical globals**; selection + frame cache live
  in `chrome.storage.session`, so a forced worker termination is survivable (reopen
  restores instantly; the `⟳` button re-asks the worker, which re-answers identically).
- Cytoscape inspector with URNs as stable node ids, relations (never "edges") on arrows,
  layout/selection kept in browser scratch, not node data.
- Provenance header showing engine, log_seq · t_day, workspace, purpose, and view_filter.
- Textual inspector: selected node's urn / type_id / properties + incident relations.

## Phase 2 — live MCP read path (this branch)

The live read plugs into the **`McpAdapter` seam** in [`src/mcp/types.ts`](src/mcp/types.ts)
with **no signature change** — the worker still calls `adapter.getFrame(request)` and
forwards the typed frame; the side panel, the `GET_FRAME`/`FRAME` envelope, and the
component tree are untouched. The one type change is `FrameProvenance.mock` widened from
the literal `true` to `boolean`, so a live frame can state `mock: false` (the header now
renders a green **LIVE** badge instead of the amber **MOCK** one).

### What it reads (read-only, no writes)

The extension now defaults to the **live** adapter (`src/mcp/adapter-factory.ts`). It calls
only these engine reads:

| Surface | Endpoint | Tool / route | Used for |
|---|---|---|---|
| MCP Streamable HTTP | `POST http://localhost:8080/sse` | `initialize` | handshake (JSON-RPC 2.0, protocol `2024-11-05`; server is stateless per request, no `mcp-session-id`) |
| MCP Streamable HTTP | `POST http://localhost:8080/sse` | `tools/call` → `graph_state` | the whole current fold `{nodes, relations}` |
| MCP Streamable HTTP | `POST http://localhost:8080/sse` | `tools/call` → `node_lookup` | single node by urn (helper) |
| REST | `GET http://localhost:8000/healthz` | — | `log_len`, `t_day`, `ontology_version` for provenance |
| REST | `GET http://localhost:8000/state/relations/src/{urn}` | — | outgoing-relation helper |

There is **NO apply path**. `graph_state` / `node_lookup` are the only tools invoked, gated
by a positive read-only allowlist in `streamable-http-client.js`; the engine's
`apply_rewrite` / `apply_program` tools are never named or called. The four rewrites
(ADD/LINK/MUTATE/UNLINK) are unreachable from this build. No model, no credential, no
`Origin`-bypassing config is wired.

### How the transform works

`graph_state` returns the fold as stringified JSON inside `result.content[0].text`, with
each property wrapped as `{value, mutability, authority_scope, stratum_origin}`. The pure
transform ([`src/mcp/transform.js`](src/mcp/transform.js)) unwraps `.value`, maps nodes →
`HgNode` and relations → `HgRelation` (`type_id` = `rewrite_category`/WFxx, `label` = the
relation-kind port, e.g. `provides-kb`), then applies the client-side `view_filter` (`L_p`):
by default it keeps types `[knowledge_item, derivation, purpose, session]` scoped to the
live Cowork seat `session:sam.z440-cowork-workspace` plus its 1-hop neighbourhood — the
same shape as the Phase 1 mock, so the UI stays continuous. Provenance is stamped from
`/healthz`. A `FrameRequest.view_filter` (`{purpose?, scope_urns?, types?, t?}`) overrides
the defaults.

`transform.js` and `streamable-http-client.js` are authored in JS + JSDoc precisely so the
**same real code** runs in the service worker (via the `.ts` adapter) and in the Node smoke
test — the smoke test is not a re-implementation.

### Live browser testing & the CORS caveat

A **served** page (the `vite` dev server, `preview-live.html` opened over `http://…`)
**cannot** reach the engine: the browser applies CORS to the cross-origin `POST` to
`http://localhost:8080/sse` and forbids overriding `Origin`, so the request is blocked and
`preview-live` shows a transport error. **That is expected.** The live path renders in the
browser only from a **CORS-exempt context** — i.e. the actual **unpacked extension**, whose
`host_permissions` for `:8080`/`:8000` grant the cross-origin reads (or a browser started
with web security disabled). `preview.html` deliberately stays on the mock adapter for
served-page use.

The headless, CORS-free proof is the Node smoke test:

```bash
node scripts/live-smoke.mjs
```

It imports the same shared `streamable-http-client` + `transform` modules, runs
`initialize → graph_state → /healthz → selectFrame → node_lookup`, prints the resulting
`HgFrame` summary (node count by type, relation count, provenance header), and exits
non-zero unless a live frame with non-zero nodes was read.

### Phase 1 exit criteria (from #158) — met

- [x] Clean MV3 manifest with narrow permissions (`sidePanel`, `storage`, `activeTab`;
      localhost `:8080`/`:8000` hosts only; no `<all_urls>`, history, bookmarks, downloads,
      or content script).
- [x] Side panel opens from the toolbar action (`chrome.action.onClicked` →
      `chrome.sidePanel.open`; no `default_popup`, so no onClicked conflict).
- [x] Persisted state survives forced service-worker termination (`chrome.storage.session`;
      no correctness-critical worker globals).
- [x] Mock MCP adapter returns a fixed typed frame.
- [x] Frame metadata visibly includes source engine, log sequence/time, workspace, purpose,
      and view filter (the provenance header).
- [x] Cytoscape inspector renders the mock frame plus a textual inspector.

### Phase 2 exit criteria (from #158) — met

- [x] `StreamableHttpMcpAdapter implements McpAdapter` (no seam signature change).
- [x] MCP Streamable HTTP `initialize` handshake + `tools/call graph_state`; REST
      `/healthz` for provenance.
- [x] Wrapped-property unwrap + fold → `HgFrame` transform, shared by adapter and smoke test.
- [x] Client-side `view_filter` selection (default = live Cowork-seat slice; honors request).
- [x] Retry/backoff on transport failure; errors surfaced (not thrown uncaught).
- [x] Read-only helpers (health, `node_lookup`, relation neighborhood); **no apply**.
- [x] Runtime adapter switch; extension defaults to live, mock still available.
- [x] `node scripts/live-smoke.mjs` reads a real non-zero frame from the running kernel.

## Phase 3 — Document Picture-in-Picture mirror (this branch)

A **Pop out ⧉** button in the side-panel header opens a Document Picture-in-Picture window
that mirrors the panel: the SAME frame, the SAME selection, kept in lock-step through ONE
shared state store. It is a pure read/UI surface — no new engine capability, no adapter
call, no model, no writes. The four rewrites (ADD/LINK/MUTATE/UNLINK) stay unreachable; the
write path (controlled tool calls + confirmation UI) remains gated to **Phase 4**.

### How it works

- **Explicit, gesture-driven open.** The panel header shows a visible **Pop out ⧉** button.
  Document PiP's `requestWindow()` REQUIRES a user activation, so the click handler calls
  [`openPipMirror()`](src/pip/pip-window.tsx) which invokes `requestWindow({width, height})`
  **synchronously** — no `await` runs before it, so the gesture is still valid. Clicking
  again while a mirror is open just **focuses** the existing window (never a second one).
- **One shared store (`chrome.storage.session`, key `pilot.scratch.v1`).** The panel and the
  PiP mirror read and write the same [scratch store](src/state/scratch.ts). Sync is
  **event-driven** via `chrome.storage.onChanged` (plus a re-read when the PiP window regains
  focus) — **no polling loop**. The **frame** flows one-way (panel authors it → scratch →
  mirror); the **selection** flows **both ways** (`saveSelectedUrn` preserves the
  panel-authored frame while flipping the shared selection). Selecting a node in either
  surface reflects in the other. The mirror renders the identical `HgFrame` the panel holds
  (passed through scratch, **not** re-fetched — guaranteeing frame identity, criterion 3).
- **The PiP React tree runs in the opener's JS realm.** `createRoot(pipWindow.document.body)`
  targets the PiP document's DOM, but the component code, hooks, and `chrome.storage` access
  all execute in the side panel's realm — so the extension APIs are always available
  regardless of the PiP window's own realm.
- **Styles are adopted, not inherited.** A PiP document inherits none of the opener's CSS, so
  [`copyStyles()`](src/pip/pip-window.tsx) reconstructs every same-origin sheet as an inline
  `<style>` in the PiP head (falling back to a linked `href` for any unreadable sheet). The
  Pop-out button and the compact `.pip-*` styles live in the same `sidepanel.css` that gets
  adopted, so the mirror looks like a compact side panel.
- **Graceful degradation.** `pagehide` on the PiP window tears down the mirror (unmount React,
  drop handles) and notifies the panel so the button re-enables; the side panel keeps working
  throughout. A `pagehide` on the opener proactively closes the PiP first. The PiP window
  **never outlives its opener** (browser-enforced) — we handle that cleanly, no dangling root.
- **No placement control.** Only `width`/`height` are passed; window position is UA-owned.
  Software remembers content/state, never placement (criterion 5).
- **Feature-detected.** [`isDocumentPipSupported()`](src/pip/pip-window.tsx) checks for
  `window.documentPictureInPicture`. When absent (mobile / unsupported browsers) the button is
  **disabled** with the tooltip *"Document PiP not supported in this browser"* and the side
  panel remains fully functional. (The Document PiP API isn't yet in TypeScript's
  `lib.dom.d.ts`, so [`src/pip/document-pip.d.ts`](src/pip/document-pip.d.ts) declares the
  minimal typed surface.)

### Served-page testing (`pip-preview.html`)

A real PiP window needs a user gesture **and** a loaded extension, so it can't be driven from
a served page. `pip-preview.html` renders the **PiP CONTENT** component
([`PipContent`](src/pip/pip-content.tsx)) standalone — fed a frame from the MOCK adapter, with
selection in local React state (exactly what the shared-scratch sync supplies inside a real
extension). Same pattern as `preview.html`. Because `PipContent` is a pure presentational
component, this harness pulls in **no** `chrome.*` / Document-PiP code — verified in the build,
where `documentPictureInPicture` lands only in the side-panel entry chunk, not the shared or
`pip-preview` chunks. It is a fifth vite entry (`pip-preview`), built for local/CI UI checks
and never loaded by the extension.

```bash
npm ci
npm run typecheck            # tsc --noEmit
npm run build                # -> dist/ (worker.js stays unhashed; pip-preview.html emitted)
npm run dev:preview          # then open /pip-preview.html on an allowed dev port
```

### Manual test (needs the loaded extension + the user gesture)

1. `npm run build`, then load `dist/` unpacked (`chrome://extensions` → Load unpacked).
2. Click the toolbar action → the side panel opens.
3. Click **Pop out ⧉** → a Document PiP window opens mirroring the panel (same provenance
   header, same graph, same selection).
4. Select a node in the panel → it highlights in the PiP mirror; select a node in the PiP →
   it highlights in the panel. (Selection is the shared, bidirectional state.)
5. Close the PiP window → the button re-enables and the side panel keeps working. Close/reload
   the panel → the browser closes the PiP with it.

### Phase 4 — now built (see the Phase 4 section below)

Phase 4 is **controlled tools and model targets** and is implemented on `feat/phase4-tools`.
It is the first phase that mounts an apply capability — nothing before it (Phases 0-3) could
reach ADD/LINK/MUTATE/UNLINK. Crucially, Phase 4 still performs **no live HG write**: the
apply capability is a REVIEW-ONLY preview, and every mutating act is gated behind a
confirmation UI. The full write-up and exit-criteria checklist are in the Phase 4 section
at the end of this document.

### Phase 3 exit criteria (from #158) — met

- [x] PiP opens from an EXPLICIT side-panel button (**Pop out ⧉** in the header);
      `requestWindow()` is called synchronously in the click handler (no `await` before it).
- [x] The PiP window shows the SAME frame + selection as the side panel via ONE shared store
      (`chrome.storage.session` scratch `pilot.scratch.v1`); selection mirrors both ways,
      event-driven on `storage.onChanged` (+ focus re-read), no polling loop.
- [x] Same conversation/frame id — the PiP renders the identical `HgFrame` the panel holds,
      passed through the shared scratch (not re-fetched), guaranteeing identity.
- [x] Closing/navigating the opener degrades GRACEFULLY back to the side panel: `pagehide`
      tears down PiP state; the panel keeps working; the PiP never outlives its opener.
- [x] No programmatic screen placement assumed (only width/height passed; UA owns position).
- [x] Feature-detected: when `documentPictureInPicture` is unavailable the button is disabled
      with a tooltip and the side panel stays fully functional (mobile/unsupported fallback).
- [x] Still READ-ONLY: no adapter/engine call in the PiP path, no apply tool anywhere
      (`apply_rewrite` / `apply_program` / `POST /programs` appear only in read-only-guarantee
      comments); typecheck + build pass, `pip-preview` is a self-contained served page.

## Phase 4 — controlled tools + confirmation UI (this branch)

Phase 4 mounts the FIRST apply capability — and does so **without ever writing to the HG**.
The controlling idea: an act is a typed object that must survive a confirmation gate, and an
HG rewrite only ever becomes a **review-only preview**, never a live post.

### The safety invariant (non-negotiable)

- **No live HG write exists.** There is zero executable call to `apply_rewrite` /
  `apply_program`, and zero `POST /programs` or `POST /rewrites`, anywhere in the build. The
  HG act builds a preview envelope and *stringifies* it — that is the only thing that happens.
- **Every mutating act is confirmation-gated.** A `mutate` tool cannot act until the user
  clicks Confirm in `ConfirmActionModal`, which shows tool / target / args / actor / workspace
  / purpose / expected effect. Cancel (and Escape) is a strict no-op.
- **Structured calls only.** An act is a `ToolCall {name, args}` validated against the tool's
  `args_schema` (a flat JSON-shape check in `src/tools/tool-call.ts`) before the modal opens
  and again before Confirm resolves. There is **no** text/regex/fenced-block parser — the
  legacy scaffold's ad-hoc `` ```tool `` `` reader was deleted in Phase 0 and never returns.
- **Confirm's meaning is fixed by the tool's `channel`:** `browser` → run a local browser act
  (no engine); `hg` → build/reveal the review-only preview (never post).

### The affordance pack (criterion 1)

`src/tools/affordance.ts` projects the tools reachable for the current frame's
**actor / workspace / purpose**, modelling the SHAPE of the mo:os session-affordance map
(`{actor, workspace, purpose, tools:[{name, kind, description, args_schema}]}`). It prefers
the LIVE MCP `tools/list` catalog (fetched read-only through the worker — *listing is not
calling*), classifies each tool read-vs-mutate by name (unknown ⇒ `mutate`, i.e. gated), and
down-projects each `inputSchema` to a flat `args_schema`. Offline / against the mock adapter
it falls back to a **labelled MOCK pack**. Discovered MCP tools are catalogued for
transparency but are **not actionable** — no executable path exists for them, so the write
invariant stays airtight regardless of what the server advertises.

### The two curated acts (criterion 4)

1. **`copy_urn_to_clipboard`** — a harmless BROWSER act: copies the selected node's urn to the
   clipboard on Confirm. No engine, no HG. Still gated (it touches state outside the panel).
2. **`pin_ki_to_workspace`** — a REVIEW-ONLY HG rewrite: Confirm builds a WF19 `pins-urn` LINK
   `apply_program` envelope (kernel actor, `pins-urn` / `pinned-by-session` ports — the
   canonical WF19 pin form) and displays it with a download button. It is **never posted**;
   the panel shows *"Not posted. Applying is a separate, out-of-band, human step."*

### The model-provider seam (criteria 5 + 6)

`src/tools/model-providers.ts` is a provider-neutral registry modelling the shape of
`model-providers.json` — a `ModelProvider {id, label, endpoint?, kind}` interface, selectable
in the UI, defaulting to **`none-manual`** (no model). It is a SEAM only: **no model is
invoked, no endpoint is called, no API key is requested or stored.** The **Local WebLLM**
option is gated behind a WebGPU capability **stub** (`navigator.gpu` presence) — absent ⇒ the
option is disabled; WebLLM is not bundled.

### Where it runs

The **Actions** section is wired into the side panel only (`ActionsPanel`, each surface
ErrorBoundary-wrapped and defensively rendered). The PiP mirror deliberately does **not**
mount it — it stays a read/observe surface; a note in the panel states so.

### Manual test (loaded extension, live adapter)

1. `npm ci && npm run build`, load `dist/` unpacked, click the toolbar action.
2. In the Actions section, confirm the **affordance pack** shows the frame's actor/workspace/
   purpose and a `LIVE` badge (or `MOCK` if the engine is unreachable — it degrades cleanly).
3. Select a node → **Copy urn to clipboard** → the confirmation modal shows the structured
   call → **Confirm & run** → the urn is on your clipboard. Cancel/Escape ⇒ nothing happens.
4. Select a `knowledge_item` → **Preview: pin KI to workspace** → the modal shows the WF19
   intent → **Reveal review-only preview** → inspect (and optionally download) the
   `apply_program` envelope. Nothing is posted; `/healthz` `log_len` is unchanged.
5. The model-provider selector defaults to **Manual**; **Local WebLLM** is disabled unless the
   browser reports WebGPU. Choosing any provider changes nothing but UI state.

### Served-page testing (`preview.html`)

`preview.html` renders the real `ActionsPanel` on the MOCK adapter (`liveTools=null` ⇒ the
labelled mock pack), so the whole confirmation flow, the review-only preview, and the provider
seam are browser-testable without the extension.

### Phase 4 exit criteria (from #158) — met

- [x] **MCP affordance discovery filtered by actor/workspace/purpose** — `deriveAffordancePack`
      projects the frame's actor (session occupant) / workspace / purpose; prefers the live
      `tools/list` catalog (read-only), classifies read-vs-mutate, falls back to a labelled
      MOCK pack.
- [x] **Structured tool calls only** — a typed `ToolCall {name, args}` validated against
      `args_schema` (`validateToolCall`) before the modal and before Confirm. No text parsing
      anywhere.
- [x] **Confirmation UI for every mutating act** — `ConfirmActionModal` shows tool / target /
      args / actor / workspace / purpose / expected effect with Confirm / Cancel; Cancel and
      Escape are strict no-ops.
- [x] **One harmless browser act + one review-only HG preview** — `copy_urn_to_clipboard`
      (executes on Confirm) and `pin_ki_to_workspace` (builds a WF19 `pins-urn` preview on
      Confirm; never posts).
- [x] **Provider-neutral model adapter** — `ModelProvider` registry defaulting to `none-manual`;
      a seam with no real invocation and no credential.
- [x] **Local WebLLM only after a capability check** — the WebLLM provider is gated behind the
      `hasWebGpu()` stub (`navigator.gpu`); not bundled.
- [x] **No live HG write** — zero executable `apply_rewrite` / `apply_program` calls; zero
      `POST /programs` or `POST /rewrites`. Those strings appear only in comments, UI labels,
      the mock catalog, and the preview builder that stringifies (never posts) an envelope.
      typecheck + build pass; `preview.html` is a self-contained served page.

## Phase 5 — high-rate data plane (deferred behind a measurement gate)

WebTransport / a second transport is **deferred by decision**: the reliable MCP path already
sustains ~61 Hz at p95 for a full graph read (measured — see `docs/phase5-data-plane.md`), which
exceeds any realistic UI update rate. No high-rate surface exists in the Pilot to justify a lossy
data plane. The gate + instrument:

- Decision + criteria: `docs/phase5-data-plane.md`
- Baseline benchmark (run before ever proposing WebTransport): `node scripts/bench-frame-read.mjs`

Durable tool/rewrite semantics never leave the reliable MCP path regardless.
