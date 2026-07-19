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

- **2026-07-19 (T=260) — P9 SPIKE (feat/phase9-webtransport):** a **feature-flagged,
  OFF-by-default** WebTransport datagram CLIENT was built to **prove the pipe**, paired with the
  merged kernel spike (moos-kernel #59, `--wt-addr :8443`, `/wt/presence`). This is a SPIKE, not a
  surface, and the gate above **still stands** — the spike makes **NO claim** to beat, or be needed
  over, the reliable path. It exists so that IF an organic high-rate surface ever appears, we know
  the datagram transport works end-to-end.

  What shipped (pilot side, all READ-ONLY, all panel-side):
  - `src/wt/wt-datagram.js` — pure, node-testable wire/config law (datagram parse, cert-hash
    decode, config normalize, the feature-detect gate). Shared with `scripts/wt-smoke.mjs`.
  - `src/wt/wt-client.ts` — `new WebTransport(url, { serverCertificateHashes })`, reads
    `datagrams.readable`, exposes `onDatagram`/`onState` + `stats()`. Inert (never throws) when
    `WebTransport` is undefined, the flag is off, or the connect rejects — the strip stays hidden,
    exactly like the PiP feature-detect precedent.
  - `src/components/PresenceStrip.tsx` + `src/state/use-wt-presence.ts` — a compact strip UNDER the
    graph showing the synthetic `value` (sparkline + bar), `seq`, measured Hz, and inferred gaps.
    Labelled "WebTransport spike (synthetic)". Hidden entirely when the flag is off / unavailable.
  - `scripts/wt-bench.mjs` — this re-measure harness: re-reports the reliable baseline and documents
    the browser-side datagram measurement (Node has no built-in WebTransport).

  **Feature flag / config** — `chrome.storage.local['pilot.wt']`
  (mirrors `adapter-factory` / `prefs`):
  ```js
  { enabled: false, url?: "https://localhost:8443/wt/presence", certHash?: "<sha-256 hex|base64>" }
  ```
  `enabled` defaults false. Any malformed stored value collapses to `{ enabled:false }` (fail-closed).

  **Cert caveat (operational, the real spike challenge)** — a browser `WebTransport` connection to
  the kernel's **self-signed dev cert** requires
  `serverCertificateHashes: [{ algorithm:'sha-256', value:<ArrayBuffer of the cert SHA-256> }]`, and
  browsers cap such certs at **≤ 14 days** validity and require **ECDSA** (the kernel's ephemeral
  cert is ECDSA P-256 — compatible). Supply the hash via `pilot.wt.certHash` (hex or base64). BUT the
  kernel's **default cert is EPHEMERAL** — minted in memory per start — so its SHA-256 **changes on
  every restart**, staleing the pinned hash. For a stable live connection, start the kernel with a
  fixed `--tls-cert`/`--tls-key` dev cert (ECDSA, ≤14 d) whose SHA-256 you pin, or have the kernel
  expose its cert hash. The cert hash is **config, not a secret**.

  **Structural verification (no live endpoint):** `node scripts/wt-smoke.mjs` proves the
  feature-detect stays inert when `WebTransport` is absent or the flag is off; the parser decodes the
  contract shape and tolerates malformed/dropped/wrong-kind frames; cert-hash hex+base64 decode to a
  32-byte buffer; config normalize is fail-closed. `npm run typecheck` + `npm run build` green; the
  MV3 worker bundle is byte-for-byte unchanged (this is panel-side).

  **LIVE datagram receipt: PENDING** the kernel restart with `--wt-addr :8443` (Sam-gated). Once the
  endpoint is up, enable `pilot.wt`, pin the cert hash, open the side panel, and read the strip's
  live Hz/seq/gaps (verify Δt_ms/Δseq ≈ 50 ms ⇒ ~20 Hz). Re-run `scripts/wt-bench.mjs` to compare
  against the reliable ~61 Hz p95 baseline. Kernel-side contract: `moos-kernel/docs/spike-p9-webtransport.md`.

## If/when the gate is crossed

The build, in order, still gated by measurements at each step:
1. A separate data-plane endpoint (NOT the MCP control plane) — WebTransport over HTTP/3.
2. Datagrams for lossy presence/cursor; reliable streams only where a lossy drop is unacceptable.
3. Keep tool calls + HG rewrites on MCP/reliable paths — the data plane carries render/presence
   deltas only.
4. Lift the benchmark traces into HG evidence before changing the transport doctrine.
