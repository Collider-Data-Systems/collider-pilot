# collider-pilot

The Collider Pilot is the browser **harness** surface for mo:os — a thin,
provider-neutral MV3 extension (side panel as the persistent seat, Document PiP as an
optional always-on-top mirror) that projects a purpose-selected, timestamped HG frame
from an engine over MCP Streamable HTTP, and lifts only user-approved observations and
tool intents back through the four rewrites; it is not an engine, owns no graph
identity, and the append-only rewrite log remains the sole source of truth. Revival per
[ffs0#158](https://github.com/Collider-Data-Systems/ffs0/issues/158) (Steinberger
readback T=260, decisions D1-D6 approved).

**Status: Phase 0 complete; Phase 1 built on `feat/phase1-sidepanel-shell`** —
provenance preserved, sources pinned, secret-scanned, legacy builds attempted (see
[PROVENANCE.md](PROVENANCE.md)); on top of that, a clean read-only MV3 side-panel shell
(narrow manifest, mock MCP frame, Cytoscape inspector). Legacy lineage lives on
`legacy/pilot-2026-01` and `legacy/sidepanel-2026-01`; `main` stays clean.

## Phase plan (from #158)

- **Phase 0** — preserve and prove provenance (this repo, done)
- **Phase 1** — side-panel shell: narrow MV3 manifest, persisted state across worker restarts, mock MCP adapter, Cytoscape inspector on a fixed typed frame; no model, no writes
- **Phase 2** — live read path: MCP Streamable HTTP to the Z440 primary engine, read-only frame/node/relation/session tools, resume/reconnect
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
sidepanel.html            side-panel entry (React root)
src/sidepanel.tsx         the seat: fetch frame, restore scratch, compose UI
src/sidepanel.css         dark theme
src/worker.ts             MV3 service worker (opens panel; serves mock frame)
src/mcp/types.ts          HgFrame / HgNode / HgRelation / provenance + McpAdapter (the seam)
src/mcp/fixture.ts        the fixed typed frame (real seat model, t259/t260 nodes)
src/mcp/mock-adapter.ts   MockMcpAdapter — returns the fixture, no I/O
src/state/scratch.ts      chrome.storage.session helpers (selection + frame cache)
src/components/           ProvenanceHeader · FrameGraph (Cytoscape) · NodeInspector
public/manifest.json      narrow MV3 manifest
public/icons/             toolbar icons (from legacy/sidepanel-2026-01)
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

### Phase 2 seam (where the real MCP client plugs in)

The single seam is the **`McpAdapter` interface** in [`src/mcp/types.ts`](src/mcp/types.ts).
Phase 1 wires `MockMcpAdapter` into the service worker (`src/worker.ts`):

```ts
// src/worker.ts (Phase 1)
const adapter = new MockMcpAdapter();
// Phase 2:
// const adapter = new StreamableHttpMcpAdapter({ endpoint: "http://localhost:8080", ... });
```

Phase 2 replaces `MockMcpAdapter` with a `StreamableHttpMcpAdapter` (same interface) that:

- speaks **MCP Streamable HTTP** to the Z440 primary engine (`:8080` MCP), validates
  `Origin` (DNS-rebinding guard), and keeps the session id in `chrome.storage.session`;
- exposes read-only tools (health, selected frame, node, relation neighborhood, session
  context) behind the same `getFrame()`-shaped contract;
- honors the `view_filter` in the request.

Nothing in the side panel, the message envelope (`GET_FRAME` / `FRAME`), or the component
tree needs to change: the worker keeps calling `adapter.getFrame(request)` and forwarding
the typed frame. The host_permissions for `:8080`/`:8000` are already declared for that
day; no HG apply capability is mounted until Phase 4.

### Phase 1 exit criteria (from #158)

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
