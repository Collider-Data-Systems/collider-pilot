#!/usr/bin/env node
/**
 * P9 re-measure harness — reliable SSE/MCP baseline vs. WebTransport datagram spike.
 * =================================================================================
 * This is the Phase-5 gate instrument (`bench-frame-read.mjs`) EXTENDED for the P9
 * spike. It does two things:
 *
 *   (a) RELIABLE BASELINE — re-measures the reliable read path (MCP Streamable HTTP
 *       `graph_state` round-trip + parse) against the live engine, over N iterations,
 *       reporting p50/p95/max latency, frame size, and the sustained Hz at p95. This is
 *       the comparand the spike must be honest about: Phase-5 clocked ~61 Hz p95, which
 *       already exceeds any realistic single-user UI rate.
 *
 *   (b) WEBTRANSPORT DATAGRAM SIDE — documents how to measure the datagram
 *       inter-arrival rate/latency once the endpoint is live. Node has NO built-in
 *       WebTransport, so the WT measurement is a BROWSER step: enable the pilot.wt flag,
 *       open the side panel, and read `stats()` off the running client (the strip already
 *       shows Hz/seq/gaps). The client computes arrival-delta Hz and inferred gaps; the
 *       kernel's `t_ms`/`seq` fields let you verify the ~50 ms/20 Hz cadence
 *       independent of loss (Δt_ms/Δseq ≈ 50 ms).
 *
 * HONEST FRAMING (do not regress): the spike PROVES the datagram pipe works. It makes
 * NO claim to beat, or be needed over, the reliable path. The Phase-5 gate still stands;
 * re-run this before any adoption. See docs/phase5-data-plane.md.
 *
 * READ-ONLY: the baseline issues only `initialize` + `tools/call graph_state` + GET
 * /healthz. No apply, no write. Safe against the live kernel.
 *
 *   node scripts/wt-bench.mjs [--n 20] [--mcp http://localhost:8080] \
 *        [--engine http://localhost:8000] [--wt https://localhost:8443/wt/presence]
 */

import {
  DEFAULT_WT_URL,
  EXPECTED_EMIT_INTERVAL_MS,
  EXPECTED_HZ,
} from "../src/wt/wt-datagram.js";

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const N = parseInt(arg("n", "20"), 10);
const MCP = arg("mcp", "http://localhost:8080");
const ENGINE = arg("engine", "http://localhost:8000");
const WT = arg("wt", DEFAULT_WT_URL);

async function mcpCall(method, params) {
  const res = await fetch(`${MCP}/sse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  const line = text.includes("data:")
    ? text.split("\n").find((l) => l.startsWith("data:"))?.slice(5)
    : text;
  return JSON.parse(line);
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function measureReliableBaseline() {
  await mcpCall("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "wt-bench", version: "0" },
  });
  let health;
  try {
    health = await (await fetch(`${ENGINE}/healthz`)).json();
  } catch {
    health = {};
  }

  const times = [];
  let lastFrameBytes = 0;
  let lastNodes = 0;
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    const resp = await mcpCall("tools/call", { name: "graph_state", arguments: {} });
    const payloadText = resp?.result?.content?.[0]?.text ?? "{}";
    const state = JSON.parse(payloadText);
    const nodes = state?.nodes ? Object.keys(state.nodes).length : 0;
    times.push(performance.now() - t0);
    lastFrameBytes = payloadText.length;
    lastNodes = nodes;
  }

  const sorted = [...times].sort((a, b) => a - b);
  const p50 = pct(sorted, 50);
  const p95 = pct(sorted, 95);
  const max = sorted[sorted.length - 1] ?? 0;
  const mean = times.reduce((a, b) => a + b, 0) / (times.length || 1);
  const hzAtP95 = p95 > 0 ? 1000 / p95 : Infinity;

  console.log("=== (a) reliable SSE/MCP baseline (graph_state round-trip + parse) ===");
  console.log(
    `engine       t_day=${health.t_day ?? "?"} log_len=${health.log_len ?? "?"} ontology=${health.ontology_version ?? "?"}`,
  );
  console.log(`iterations   ${N}`);
  console.log(`nodes/read   ${lastNodes}`);
  console.log(`payload      ${(lastFrameBytes / 1024).toFixed(1)} KiB`);
  console.log(
    `latency ms   mean=${mean.toFixed(1)}  p50=${p50.toFixed(1)}  p95=${p95.toFixed(1)}  max=${max.toFixed(1)}`,
  );
  console.log(
    `gate readout reliable path sustains ~${Number.isFinite(hzAtP95) ? hzAtP95.toFixed(1) : "inf"} Hz at p95.`,
  );
}

function printWebTransportProtocol() {
  console.log("");
  console.log("=== (b) WebTransport datagram spike — measurement protocol ===");
  console.log(`endpoint     ${WT}  (HTTP/3, Extended CONNECT, ALPN h3, datagrams)`);
  console.log(
    `expected     ~${EXPECTED_HZ} Hz cadence, i.e. Δt_ms/Δseq ≈ ${EXPECTED_EMIT_INTERVAL_MS} ms (lossy; gaps expected)`,
  );
  console.log("");
  console.log("Node has no built-in WebTransport, so measure the datagram side in the");
  console.log("browser (the client already computes it):");
  console.log("  1. Start the kernel with the spike listener (Sam-gated):");
  console.log("       go run ./cmd/moos --wt-addr :8443   (in moos-kernel)");
  console.log("  2. Configure + enable the pilot flag in the extension side panel's");
  console.log("     DevTools console (chrome.storage.local):");
  console.log("       chrome.storage.local.set({ 'pilot.wt': {");
  console.log("         enabled: true,");
  console.log(`         url: '${WT}',`);
  console.log("         certHash: '<sha-256 of the kernel dev cert, hex or base64>'");
  console.log("       } })");
  console.log("     (certHash is REQUIRED for a browser to trust the self-signed dev");
  console.log("      cert via serverCertificateHashes — see the caveat below.)");
  console.log("  3. Reopen the side panel. The 'WebTransport spike' strip under the graph");
  console.log("     shows live value / seq / Hz / gaps. The Hz field IS the measured");
  console.log("     arrival rate (rolling window of datagram-arrival deltas).");
  console.log("  4. Compare: the datagram Hz vs. the reliable ~61 Hz p95 above.");
  console.log("");
  console.log("CERT CAVEAT (operational): browsers cap serverCertificateHashes certs at");
  console.log("  <= 14 days validity and require ECDSA. The kernel's DEFAULT cert is");
  console.log("  EPHEMERAL (minted in memory per start) so its SHA-256 CHANGES on every");
  console.log("  restart — the certHash above goes stale each restart. For a stable live");
  console.log("  connection, start the kernel with a fixed --tls-cert/--tls-key dev cert");
  console.log("  (ECDSA, <=14d) whose SHA-256 you pin, or have the kernel expose its hash.");
  console.log("");
  console.log("HONEST DECISION: the spike proves the datagram pipe end-to-end. It does");
  console.log("  NOT beat, and is NOT needed over, the reliable path. The Phase-5 gate");
  console.log("  still stands (docs/phase5-data-plane.md). Re-measure before any adoption.");
}

async function main() {
  try {
    await measureReliableBaseline();
  } catch (e) {
    console.log("=== (a) reliable SSE/MCP baseline ===");
    console.log(`baseline unavailable (engine not reachable): ${e.message}`);
    console.log("start the kernel (:8000 / :8080) to measure the reliable comparand.");
  }
  printWebTransportProtocol();
}

main().catch((e) => {
  console.error("wt-bench failed:", e.message);
  process.exit(1);
});
