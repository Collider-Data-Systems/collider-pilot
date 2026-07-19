# Phase 5 — high-rate data plane: deferred behind a measurement gate

> Status: **DEFERRED by decision, not by omission.** Per the ffs0#158 Steinberger review,
> WebTransport (and any second transport) is added **only** when a *measured* need exists
> that MCP Streamable HTTP + SSE cannot satisfy. This document is the gate; `scripts/bench-frame-read.mjs`
> is the instrument. No WebTransport code ships until the gate is crossed.

## The rule

The Pilot's control plane is **MCP Streamable HTTP** (Phase 2), reliable and sufficient for
request/response reads, tool calls, and frame projection. A **second, lossy** transport
(WebTransport datagrams over HTTP/3) is justified **only** for data where *freshness beats
completeness at a rate the reliable path cannot meet* — e.g. presence, cursor motion, or dense
incremental frame deltas. None of those exist in the Pilot today (it renders a purpose-selected
frame on demand, not a live stream), so **the need is unproven and the transport is not built.**

## What would justify building it (the gate)

Adopt WebTransport **iff all three** hold, evidenced by a benchmark, not a hunch:

1. **A real high-rate surface exists** — a feature that pushes updates at ≥ ~10 Hz (presence,
   live cursor, streaming frame deltas). The current on-demand frame read is ~0.03 Hz.
2. **The reliable path measurably can't keep up** — `bench-frame-read.mjs` shows the MCP read
   round-trip p95 exceeds the surface's frame budget (e.g. p95 > 100 ms for a 10 Hz need), OR
   head-of-line blocking on the reliable stream is demonstrated to drop frames.
3. **Lossy delivery is acceptable for that surface** — the data is freshness-over-completeness
   (a dropped cursor frame is fine; a dropped tool result is not — those stay on MCP).

If any one fails, the reliable path stays and this phase remains deferred. Durable tool/rewrite
semantics **never** move off MCP/the reliable engine path regardless.

## The instrument — `scripts/bench-frame-read.mjs`

Measures the current reliable read path against the live engine so the gate has a baseline:
the MCP `graph_state` round-trip + the client-side `fold → HgFrame` transform, over N iterations,
reporting p50 / p95 / max and the frame size. Run it before proposing WebTransport; if p95 already
sits comfortably inside a candidate surface's budget, the reliable path wins and WebTransport is
not warranted.

```
node scripts/bench-frame-read.mjs            # default 20 iterations against localhost:8080/:8000
node scripts/bench-frame-read.mjs --n 50
```

## Decision log

- **2026-07-19 (T=260):** Phase 5 opened and **deferred — now backed by a measurement.** No
  high-rate surface exists in the Pilot, and the baseline benchmark shows the reliable path is
  already fast enough that a second transport is unjustified:

  ```
  reliable-read baseline (MCP graph_state round-trip + parse), 20 iterations, live engine:
    nodes/read 286 · payload 409.9 KiB
    latency ms  mean=11.4  p50=11.0  p95=16.4  max=16.4
    gate readout: reliable path sustains ~61 Hz at p95.
  ```

  ~61 Hz at p95 for a full 286-node fetch exceeds any realistic UI update rate (10–30 Hz), so
  **gate condition 2 fails: the reliable path measurably keeps up.** WebTransport unbuilt.
  Re-measure with `scripts/bench-frame-read.mjs` if a genuine high-rate surface is ever added.
  Reference: ffs0#158 (Steinberger review, Phase 5 "measure a real need first").

## If/when the gate is crossed

The build, in order, still gated by measurements at each step:
1. A separate data-plane endpoint (NOT the MCP control plane) — WebTransport over HTTP/3.
2. Datagrams for lossy presence/cursor; reliable streams only where a lossy drop is unacceptable.
3. Keep tool calls + HG rewrites on MCP/reliable paths — the data plane carries render/presence
   deltas only.
4. Lift the benchmark traces into HG evidence before changing the transport doctrine.
