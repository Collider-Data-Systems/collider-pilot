/**
 * Collider Pilot - LIVE read smoke test (Phase 2)
 * ===============================================
 * Headless proof that the live MCP read path works end-to-end against the running Z440
 * engine. Node has no CORS and can set Origin, so this is the canonical live verification
 * (the served preview-live.html is CORS-blocked by design).
 *
 * It imports the SAME shared modules the extension adapter uses — `streamable-http-client`
 * (transport) and `transform` (pure fold -> HgFrame) — so it exercises the real code, not
 * a copy. It performs exactly the read path:
 *
 *     initialize  ->  tools/call graph_state   (MCP :8080/sse)
 *                 ->  GET /healthz             (REST :8000)
 *                 ->  selectFrame(...)         (pure transform + view_filter)
 *                 ->  tools/call node_lookup   (one node, to exercise that helper)
 *
 * READ-ONLY: the only tools named are `graph_state` and `node_lookup`; the only REST call
 * is GET /healthz. No apply_rewrite / apply_program / POST is ever issued.
 *
 * Run:  node scripts/live-smoke.mjs
 * Env:  PILOT_MCP_BASE_URL (default http://localhost:8080)
 *       PILOT_ENGINE_URL   (default http://localhost:8000)
 *
 * Exit code 0 iff a live frame with a NON-ZERO node count was read; 1 otherwise.
 */

import { createStreamableHttpClient } from "../src/mcp/streamable-http-client.js";
import {
  selectFrame,
  parseGraphStateResult,
  parseNodeLookupResult,
  summarizeFrame,
  DEFAULT_ENGINE_URN,
  DEFAULT_SCOPE_URN,
} from "../src/mcp/transform.js";

const mcpBaseUrl = process.env.PILOT_MCP_BASE_URL || "http://localhost:8080";
const engineUrl = process.env.PILOT_ENGINE_URL || "http://localhost:8000";

function line(label, value) {
  console.log(`  ${label.padEnd(16)} ${value}`);
}

async function main() {
  console.log("collider-pilot :: live MCP read smoke test");
  console.log(`  MCP   ${mcpBaseUrl}/sse`);
  console.log(`  REST  ${engineUrl}/healthz\n`);

  const client = createStreamableHttpClient({ mcpBaseUrl, engineUrl });

  // 1. handshake
  const server = await client.initialize();
  const info = server?.serverInfo ?? server;
  console.log(
    `initialize OK  serverInfo=${info?.name ?? "?"} protocol=${server?.protocolVersion ?? "?"}`,
  );

  // 2. graph_state + healthz
  const [graphRpc, health] = await Promise.all([
    client.graphState(),
    client.healthz(),
  ]);
  const fold = parseGraphStateResult(graphRpc);
  console.log(
    `graph_state OK  raw nodes=${Object.keys(fold.nodes).length} raw relations=${Object.keys(fold.relations).length}`,
  );
  console.log(
    `healthz OK      t_day=${health.t_day} log_len=${health.log_len} ontology=${health.ontology_version}`,
  );

  // 3. pure transform + default view_filter selection (the REAL adapter transform)
  const frame = selectFrame(fold, {
    healthz: health,
    engine: DEFAULT_ENGINE_URN,
    engineEndpoint: `${engineUrl} (HTTP) · ${mcpBaseUrl} (MCP)`,
    foldedAt: new Date().toISOString(),
  });
  const summary = summarizeFrame(frame);

  console.log("\n=== HgFrame (default view_filter) ===");
  console.log("provenance:");
  line("engine", frame.provenance.engine);
  line("endpoint", frame.provenance.engine_endpoint);
  line("log_seq", frame.provenance.log_seq);
  line("t_day", frame.provenance.t_day);
  line("ontology", frame.provenance.ontology_version);
  line("workspace", frame.provenance.workspace);
  line("purpose", frame.provenance.purpose);
  line("folded_at", frame.provenance.folded_at);
  line("mock", frame.provenance.mock);
  line("view_filter", JSON.stringify(frame.provenance.view_filter));

  console.log("\nselected slice:");
  line("nodes", summary.nodeCount);
  line("relations", summary.relationCount);
  line("nodes_by_type", JSON.stringify(summary.nodesByType));

  // 4. node_lookup helper on the scope anchor (exercises that read tool)
  try {
    const node = parseNodeLookupResult(await client.nodeLookup(DEFAULT_SCOPE_URN));
    console.log("\nnode_lookup OK");
    line("urn", node.urn);
    line("type_id", node.type_id);
    line("label", node.label);
    line("prop_keys", Object.keys(node.properties).length);
  } catch (err) {
    console.log(`\nnode_lookup skipped: ${err instanceof Error ? err.message : err}`);
  }

  if (summary.nodeCount === 0) {
    console.error("\nFAIL: live frame had zero nodes.");
    process.exit(1);
  }
  console.log("\nPASS: live read produced a non-zero frame.");
}

main().catch((err) => {
  console.error(`\nFAIL: ${err instanceof Error ? err.stack || err.message : err}`);
  process.exit(1);
});
