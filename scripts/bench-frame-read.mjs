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
 *
 * t342 P2 FIRST PAINT (`npm run bench:frame -- --layout`): with `--layout [auto|nested|
 * concentric|breadthfirst|grid]` each iteration is the whole road to the first drawing, on the
 * code the panel runs — the `graph_state` read and parse, the REAL transform (`selectFrame`, lens
 * `everything`; `--user <urn>` reads it identified, as "Bring me in" does — no access gate
 * without it), FrameGraph's real `drawingPlan` (boxes, sources in their box, the unlinked band),
 * and its real `runLayout` in headless Cytoscape with the real STYLE. Headless Cytoscape
 * measures no text, so labels count as zero-size: this times the layout ALGORITHM, not the
 * canvas paint. Each step is reported in wall and in CPU time (the process's, and the main
 * thread's where Node reports it); the pilot's share of the first paint — the main thread's CPU
 * time of transform + plan + layout — is held to FIRST_PAINT_BUDGET_MS at p95 and the script
 * exits 1 over it. The read's share (the engine and the network) is reported beside it.
 * `--framegraph <file.tsx>` times another FrameGraph (a before/after comparison; it must export
 * `runLayout`). Also reads the engine's three GET /operad/* routes once, before timing.
 * Env: PILOT_MCP_BASE_URL / PILOT_ENGINE_URL set the defaults of --mcp / --engine.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseMcpBody } from "../src/mcp/streamable-http-client.js";

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
}
const N = parseInt(arg("n", "20"), 10);
const MCP = arg("mcp", process.env.PILOT_MCP_BASE_URL || "http://localhost:8080");
const ENGINE = arg("engine", process.env.PILOT_ENGINE_URL || "http://localhost:8000");
// t342 P2: `--layout` alone is `auto`, the layout a panel with no stored choice draws.
const LAYOUT = args.includes("--layout") ? arg("layout", "auto") : null;
const USER = arg("user", null);

/**
 * t342 P2: the first-paint budget — the pilot's share of the first paint: the p95, over the
 * iterations, of the CPU time the transform, the plan and the layout (headless, see above) take
 * from the frame read to positions on every node. CPU time, not wall: at t342 a seat busy with
 * other work stretched the wall clock several-fold without the code changing (the wall times are
 * printed too). The read is the engine's and the network's share — through the scratch proxy it
 * took 3 to 22 s at t342 — and is reported, not budgeted (the Phase 5 baseline is its measure).
 * A cose over the whole frame (about 7 s; on the main thread 3.6 to 6.7 s, quiet) breaks this
 * budget; the layout as P2 ships it does not. TESTING.md "First paint" has the numbers before
 * and after P2/P3.
 *
 * t342 P2 (hand-off B verification): the MAIN thread's CPU time (MAIN_THREAD_CPU), the thread
 * the first paint waits on. The process's CPU time also counts V8's background compiler and
 * garbage-collector threads, which do not hold the paint: at the cold first iteration (the
 * p95) it was 1.5 to 2.3 times the main thread's over 18 runs on both engines, and on a
 * saturated seat it went over this budget with nothing changed (4 094 ms against 2 250 on the
 * main thread). Both are printed.
 */
const FIRST_PAINT_BUDGET_MS = 3000;
/**
 * t342 P2 (hand-off B verification): whether this Node reports the main thread's CPU time
 * (`process.threadCpuUsage`, in recent releases — Node 24 on the seat that measured). Without it
 * the budget is held against the process's CPU time — higher, so a run within it there is
 * within it here too — and the report says which it used.
 */
const MAIN_THREAD_CPU = typeof process.threadCpuUsage === "function";

async function mcpCall(method, params) {
  const res = await fetch(`${MCP}/sse`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  // Streamable HTTP may frame the JSON in an SSE `data:` line; tolerate both. t342 P2: with the
  // transport's own parser — the old test (`text.includes("data:")`) took a plain JSON body
  // whose fold carries "data:" in a property for SSE, and failed on hp-laptop's kernel.
  return parseMcpBody(await res.text(), res.headers.get("content-type") ?? "");
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
  if (LAYOUT) return firstPaint(health);

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

/**
 * t342 P2: type-strip FrameGraph.tsx for its exports, as smoke:lens and smoke:live do — into a
 * temporary directory beside the source, next to the one TypeScript module it imports a VALUE
 * from (`state/prefs.ts`). Nothing mounts; Cytoscape runs headless.
 */
async function loadFrameGraph(file) {
  const ts = (await import("typescript")).default;
  const root = fileURLToPath(new URL("..", import.meta.url));
  const strip = (path) =>
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
  const dir = mkdtempSync(join(root, "src/components", ".bench-"));
  try {
    writeFileSync(join(dir, "prefs.mjs"), strip(join(root, "src/state/prefs.ts")));
    writeFileSync(
      join(dir, "FrameGraph.mjs"),
      strip(resolve(file ?? join(root, "src/components/FrameGraph.tsx")))
        .replaceAll('from "../state/prefs"', 'from "./prefs.mjs"')
        .replaceAll('from "../', 'from "../../'),
    );
    return await import(pathToFileURL(join(dir, "FrameGraph.mjs")).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** t342 P2: the read-to-first-drawing road, timed in its five steps (see the header). */
async function firstPaint(health) {
  const { default: cytoscape } = await import("cytoscape");
  const { parseGraphStateResult, selectFrame } = await import("../src/mcp/transform.js");
  const { readEngineGrammar } = await import("../src/mcp/engine-grammar.js");
  const fg = await loadFrameGraph(arg("framegraph", null));
  if (typeof fg.runLayout !== "function") throw new Error("this FrameGraph does not export runLayout");
  const grammar = await readEngineGrammar({ engineUrl: ENGINE, healthz: health });
  const access = USER
    ? { mode: "identified", user: USER, workstation: null, role: null, identity_source: "trusted-storage", enforced_by: "client-presentation" }
    : undefined;
  // Each step's wall time, and the CPU time this process spent in it: on a machine busy with
  // other work the wall time grows and the CPU time does not, so the two together say whether a
  // slow run is the code or the machine.
  const steps = { read: [], transform: [], plan: [], layout: [], total: [] };
  const cpu = { read: [], transform: [], plan: [], layout: [], total: [] };
  // t342 P2 (hand-off B verification): and the MAIN thread's CPU time (see MAIN_THREAD_CPU).
  const main = { read: [], transform: [], plan: [], layout: [], total: [] };
  const clock = () => {
    const c = process.cpuUsage();
    const t = MAIN_THREAD_CPU ? process.threadCpuUsage() : c;
    return { wall: performance.now(), cpu: (c.user + c.system) / 1000, main: (t.user + t.system) / 1000 };
  };
  const spent = (name, a, b) => {
    steps[name].push(b.wall - a.wall);
    cpu[name].push(b.cpu - a.cpu);
    main[name].push(b.main - a.main);
  };
  let last = null;
  for (let i = 0; i < N; i++) {
    const t0 = clock();
    const fold = parseGraphStateResult(await mcpCall("tools/call", { name: "graph_state", arguments: {} }));
    const t1 = clock();
    const frame = selectFrame(fold, {
      healthz: health,
      grammar,
      request: { view_filter: { types: ["*"], ...(access ? { access } : {}) } },
    });
    const t2 = clock();
    const drawn = fg.resolveGraphLayout(LAYOUT, frame);
    // The panel's own plan where the FrameGraph has one (t342 P2/P3); else the parts it had.
    const elements = fg.drawingPlan
      ? fg.drawingPlan(frame, drawn, false).elements
      : fg.toElements(frame, drawn === "nested" ? fg.nestingParents(frame) : new Map(), fg.unlinkedUrns(frame));
    const cy = cytoscape({ headless: true, styleEnabled: true, elements, style: fg.STYLE });
    const t3 = clock();
    fg.runLayout(cy, drawn);
    const t4 = clock();
    last = {
      nodes: frame.nodes.length,
      relations: frame.relations.length,
      drawn,
      boxes: cy.nodes(":parent").length,
      report: cy.scratch("pilotLayout") ?? null,
    };
    cy.destroy();
    spent("read", t0, t1);
    spent("transform", t1, t2);
    spent("plan", t2, t3);
    spent("layout", t3, t4);
    spent("total", t0, t4);
  }
  const p = (xs, q) => pct([...xs].sort((a, b) => a - b), q);
  const row = (name) =>
    `${name.padEnd(10)} wall p50=${p(steps[name], 50).toFixed(1).padStart(8)}  p95=${p(steps[name], 95).toFixed(1).padStart(8)}` +
    `   cpu p50=${p(cpu[name], 50).toFixed(1).padStart(8)}  p95=${p(cpu[name], 95).toFixed(1).padStart(8)}` +
    (MAIN_THREAD_CPU
      ? `   main p50=${p(main[name], 50).toFixed(1).padStart(8)}  p95=${p(main[name], 95).toFixed(1).padStart(8)}`
      : "");
  console.log("=== t342 first paint (read + parse + transform + plan + layout, headless Cytoscape) ===");
  console.log(`engine       ${health.kernel_urn ?? "?"} log_len=${health.log_len ?? "?"} ontology=${health.ontology_version ?? "?"}`);
  console.log(`frame        ${last?.nodes} nodes / ${last?.relations} relations, lens everything, ${USER ? `identified as ${USER}` : "no access gate"}`);
  const rep = last?.report;
  console.log(
    `layout       ${LAYOUT} -> ${last?.drawn}, ${last?.boxes} boxes` +
      (rep && rep.drawn === "nested"
        ? `, ${rep.components.length} components outside a box (largest ${rep.components[0]?.length ?? 0}; ` +
          `${rep.refined.length} refined by cose${rep.refined.length ? `: ${rep.refined.join(", ")} nodes` : ""}` +
          // t342 P2 review: the iterations each got from the frame's one budget.
          `${rep.iterations?.length ? `, ${rep.iterations.join(", ")} iterations` : ""}; ` +
          `${rep.overlaps} overlapping label pairs — headless labels have no size), ` +
          `${rep.sources} sources in a box, ${rep.band} in the unlinked band`
        : rep
          ? `, ${rep.band} in the unlinked band`
          : ""),
  );
  console.log(
    `iterations   ${N}   (ms; cpu = the process, all threads` +
      `${MAIN_THREAD_CPU ? "; main = the main thread only" : ""})`,
  );
  for (const name of Object.keys(steps)) console.log(`  ${row(name)}`);
  // The budget's measure (see FIRST_PAINT_BUDGET_MS): the pilot's share, in the main thread's CPU
  // time — the process's where this Node cannot tell the threads apart.
  const share = (of) => of.transform.map((t, i) => t + of.plan[i] + of.layout[i]);
  const client = share(MAIN_THREAD_CPU ? main : cpu);
  const allThreads = share(cpu);
  const measure = MAIN_THREAD_CPU ? "main-thread cpu" : "process cpu (this Node has no threadCpuUsage)";
  console.log(
    `  ${"pilot".padEnd(10)} transform + plan + layout   ${MAIN_THREAD_CPU ? "main" : "cpu"} p50=${p(client, 50).toFixed(1).padStart(8)}  p95=${p(client, 95).toFixed(1).padStart(8)}` +
      (MAIN_THREAD_CPU
        ? `   (process cpu p50=${p(allThreads, 50).toFixed(1)}  p95=${p(allThreads, 95).toFixed(1)})`
        : ""),
  );
  const p95 = p(client, 95);
  const ok = p95 <= FIRST_PAINT_BUDGET_MS;
  console.log(
    `\nFIRST_PAINT_BUDGET_MS ${FIRST_PAINT_BUDGET_MS}: the pilot's share p95 ${p95.toFixed(1)} ms ${measure} — ${ok ? "within budget" : "OVER BUDGET"}` +
      ` (the read, not budgeted: wall p50 ${p(steps.read, 50).toFixed(0)} ms, p95 ${p(steps.read, 95).toFixed(0)} ms)`,
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("bench failed:", e.message);
  process.exit(1);
});
