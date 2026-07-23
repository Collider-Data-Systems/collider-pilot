# Testing the pilot

Four gates, all runnable from a clean checkout with the Z440 primary kernel up. Run them in
this order; each is fast and each catches a distinct class.

```bash
npm run typecheck        # tsc --noEmit
npm run build            # -> dist/ (also the load-unpacked target)
npm run smoke:worker     # the SHIPPED dist/worker.js, driven headlessly
npm run smoke:live       # live MCP read + the access law + the slice axes
npm run smoke:llm        # the LLM seam (+ a live Ollama round-trip if reachable)
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
asserts that an unknown message type is *not* answered.

**`smoke:live`** proves the slice law twice: on a synthetic chain (ports narrow relations;
hops expand only along retained ports) and on the **live fold** (the default lens loses no
node or relation the legacy default showed; `["*"]` reaches the whole fold; hops widen a real
focus monotonically). One assertion there earns its keep long-term: **every live relation
label must be present in the UI's port vocabulary** — it caught `guards` and `participates`
being unreachable, and it will fail the next time an ontology bump adds a port the UI cannot
select.

**`smoke:llm`** covers the ToolSpec→OpenAI mapping, both recovery paths (structured
`tool_calls` and strict content-JSON) with fenced/prose content *rejected*, the cloud-egress
access gate, the declared-type check, and the semantic urn gate (`{urn:"t263"}` and ghost urns
must reject; wrong-typed pins must reject).

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

Two things have burned real time here:

1. **The dev server can serve a stale transform.** A verified-correct fix once appeared
   completely broken because the served module was missing two of three call sites. When a
   harness result contradicts the source you just wrote, check what the server serves before
   touching code — `fetch('/src/preview-live.tsx').then(r => r.text())` — and restart the
   server if it disagrees.
2. **Harness prop drift hides features.** Twice a harness passed something the panel does not
   (`dirty={false}`, no `collapsible`), making the feature untestable outside the extension.
   Keep harness prop wiring identical to `sidepanel.tsx`.

Note also that a **viewport** media query (the log feed drops the actor column below 430px)
cannot fire inside the 380px frame — a docked side panel *is* its own viewport, so test that
class by sizing the viewport, not the frame.

## What no automated check can reach

- whether a real click's clipboard write lands on the OS clipboard (the blocked path is
  proven graceful: `{ok:false, "clipboard write was blocked by the browser"}`)
- the Document-PiP open path, which requires a user gesture
- scratch mirroring between two *real* windows (the channel logic is asserted; the two-window
  case is not)
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
