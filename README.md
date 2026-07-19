# collider-pilot

The Collider Pilot is the browser **harness** surface for mo:os — a thin,
provider-neutral MV3 extension (side panel as the persistent seat, Document PiP as an
optional always-on-top mirror) that projects a purpose-selected, timestamped HG frame
from an engine over MCP Streamable HTTP, and lifts only user-approved observations and
tool intents back through the four rewrites; it is not an engine, owns no graph
identity, and the append-only rewrite log remains the sole source of truth. Revival per
[ffs0#158](https://github.com/Collider-Data-Systems/ffs0/issues/158) (Steinberger
readback T=260, decisions D1-D6 approved).

**Status: Phase 0 complete** — provenance preserved, sources pinned, secret-scanned,
legacy builds attempted. See [PROVENANCE.md](PROVENANCE.md). Legacy lineage lives on
`legacy/pilot-2026-01` and `legacy/sidepanel-2026-01`; `main` stays clean.

## Phase plan (from #158)

- **Phase 0** — preserve and prove provenance (this repo, done)
- **Phase 1** — side-panel shell: narrow MV3 manifest, persisted state across worker restarts, mock MCP adapter, Cytoscape inspector on a fixed typed frame; no model, no writes
- **Phase 2** — live read path: MCP Streamable HTTP to the Z440 primary engine, read-only frame/node/relation/session tools, resume/reconnect
- **Phase 3** — Document PiP mirror: opened from a side-panel button, same state store, graceful degradation
- **Phase 4** — controlled tools and model targets: MCP affordance discovery, structured tool calls only, confirmation UI for every mutating act, provider-neutral model adapter
- **Phase 5** — optional high-rate data plane (WebTransport) only behind measured need
