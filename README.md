# collider-pilot

The Collider Pilot is the browser **harness** surface for mo:os — a thin,
provider-neutral MV3 extension (side panel as the persistent seat, Document PiP as an
optional always-on-top mirror) that projects a purpose-selected, timestamped HG frame
from an engine over MCP Streamable HTTP, and lifts only user-approved observations and
tool intents back through the four rewrites; it is not an engine, owns no graph
identity, and the append-only rewrite log remains the sole source of truth. Revival per
[ffs0#158](https://github.com/Collider-Data-Systems/ffs0/issues/158) (Steinberger
readback T=260, decisions D1-D6 approved).

**Status: Phase 0 + Phase 1 complete; Phase 2 built on `feat/phase2-live-read`** —
provenance preserved, sources pinned, secret-scanned, legacy builds attempted (see
[PROVENANCE.md](PROVENANCE.md)); on top of that, a clean read-only MV3 side-panel shell
(narrow manifest, Cytoscape inspector); and now the **live MCP read path** — a
`StreamableHttpMcpAdapter` that reads a live, purpose-selected HG frame from the Z440
primary engine over MCP Streamable HTTP (read-only; no model, no writes). Legacy lineage
lives on `legacy/pilot-2026-01` and `legacy/sidepanel-2026-01`; `main` stays clean.

## Phase plan (from #158)

- **Phase 0** — preserve and prove provenance (this repo, done)
- **Phase 1** — side-panel shell: narrow MV3 manifest, persisted state across worker restarts, mock MCP adapter, Cytoscape inspector on a fixed typed frame; no model, no writes
- **Phase 2** — live read path (**this branch**): MCP Streamable HTTP to the Z440 primary engine, read-only frame/node/relation tools, retry/reconnect; the extension defaults to the live adapter
- **Phase 3** — Document PiP mirror: opened from a side-panel button, same state store, graceful degradation
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
src/state/scratch.ts               chrome.storage.session helpers (selection + frame cache)
src/components/                    ProvenanceHeader · FrameGraph (Cytoscape) · NodeInspector
preview.html / src/preview.tsx     dev harness on the MOCK adapter
preview-live.html / preview-live.tsx  dev harness on the LIVE adapter (CORS-blocked from a served page)
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

### Phase 3 seam (next)

Phase 3 is the **Document PiP mirror**: opened from a side-panel button, sharing the same
`chrome.storage.session` scratch store, with graceful degradation when PiP is unavailable.
It is a pure read/UI surface over the exact same `McpAdapter` — no new engine capability.
The write path (controlled tool calls with a confirmation UI) remains gated to **Phase 4**;
nothing before then mounts any apply capability. The `relationNeighborhood()` /
`node_lookup` helpers and the `view_filter` request shape already present here are the
hooks a PiP node-browser will lean on.

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
