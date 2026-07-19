#!/usr/bin/env node
/**
 * Phase 5 gate instrument — reliable-read baseline.
 * =================================================
 * Measures the CURRENT reliable read path (MCP Streamable HTTP `graph_state` round-trip
 * + a fold->frame-shaped transform) against the live engine, over N iterations, and
 * reports p50/p95/max latency + frame size. This is the baseline the Phase 5 gate compares
 * a candidate high-rate surface's frame budget against (see docs/phase5-data-plane.md).
 *
 * READ-ONLY: issues only `initialize` + `tools/call graph_state` + GET /healthz. No apply,
 * no write, no tool other than the read discovery. Safe to run against the live kernel.
 *
 *   node scripts/bench-frame-read.mjs [--n 20] [--mcp http://localhost:8080] [--engine http://localhost:8000]
 */

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const N = parseInt(arg("n", "20"), 10);
const MCP = arg("mcp", "http://localhost:8080");
const ENGINE = arg("engine", "http://localhost:8000");

async function mcpCall(method, params) {
  const res = await fetch(`${MCP}/sse`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  // Streamable HTTP may frame the JSON in an SSE `data:` line; tolerate both.
  const line = text.includes("data:") ? text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) : text;
  return JSON.parse(line);
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  // Handshake + a size probe.
  await mcpCall("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "bench", version: "0" } });
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
    // Parse the tool payload the way the adapter does (the transform cost is part of the read).
    const payloadText = resp?.result?.content?.[0]?.text ?? "{}";
    const state = JSON.parse(payloadText);
    const nodes = state?.nodes ? Object.keys(state.nodes).length : 0;
    const dt = performance.now() - t0;
    times.push(dt);
    lastFrameBytes = payloadText.length;
    lastNodes = nodes;
  }

  const sorted = [...times].sort((a, b) => a - b);
  const p50 = pct(sorted, 50);
  const p95 = pct(sorted, 95);
  const max = sorted[sorted.length - 1] ?? 0;
  const mean = times.reduce((a, b) => a + b, 0) / (times.length || 1);

  console.log("=== Phase 5 reliable-read baseline (MCP graph_state round-trip + parse) ===");
  console.log(`engine       t_day=${health.t_day ?? "?"} log_len=${health.log_len ?? "?"} ontology=${health.ontology_version ?? "?"}`);
  console.log(`iterations   ${N}`);
  console.log(`nodes/read   ${lastNodes}`);
  console.log(`payload      ${(lastFrameBytes / 1024).toFixed(1)} KiB`);
  console.log(`latency ms   mean=${mean.toFixed(1)}  p50=${p50.toFixed(1)}  p95=${p95.toFixed(1)}  max=${max.toFixed(1)}`);
  console.log("");
  // The gate readout: what update rate the reliable path sustains at p95.
  const hzAtP95 = p95 > 0 ? (1000 / p95).toFixed(1) : "inf";
  console.log(`gate readout  reliable path sustains ~${hzAtP95} Hz at p95.`);
  console.log(`decision      WebTransport is justified ONLY for a surface needing a HIGHER rate`);
  console.log(`              than this AND tolerant of lossy delivery. See docs/phase5-data-plane.md.`);
}

main().catch((e) => {
  console.error("bench failed:", e.message);
  process.exit(1);
});
