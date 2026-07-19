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
import {
  resolveAccess,
  readRequestedMode,
  ANON_USER_URN,
} from "../src/mcp/access.js";

/** Tiny assert — prints and exits non-zero on failure so this is a real gate. */
function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL (access): ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

/**
 * Exercise the SHARED access law (src/mcp/access.js) over the live fold + a synthetic fixture.
 * Anon = public-only; Bring-in = the WF02 governs → reverse-WF19 has-occupant set (∪ the
 * occupant-property [CONJ] fallback); worker-strip keeps only `mode`.
 */
function accessChecks(fold) {
  console.log("\n=== access law (src/mcp/access.js) ===");

  const anon = {
    mode: "anon",
    user: ANON_USER_URN,
    workstation: null,
    role: null,
    identity_source: "anon",
    enforced_by: "client-presentation",
  };
  const sam = {
    mode: "identified",
    user: "urn:moos:user:sam",
    workstation: "urn:moos:workstation:hp-z440",
    role: null,
    identity_source: "trusted-storage",
    enforced_by: "client-presentation",
  };

  // (a) anon = public-only.
  const anonRes = resolveAccess(fold, anon);
  line("anon permitted", JSON.stringify(anonRes.permitted_workspaces));
  line("anon public", JSON.stringify(anonRes.public_workspaces));
  assert(
    JSON.stringify(anonRes.permitted_workspaces.slice().sort()) ===
      JSON.stringify(anonRes.public_workspaces.slice().sort()),
    "anon permitted === public_workspaces (public-only)",
  );
  assert(anonRes.role_topology.includes(ANON_USER_URN), "anon principal is a visible participant");
  assert(anonRes.workspace_path === "none", "anon workspace_path is 'none'");

  // (b) Bring-in over the LIVE fold: WF02 → reverse-WF19 permitted set (primary path).
  const samRes = resolveAccess(fold, sam);
  line("sam role_topology", `${samRes.role_topology.length} principals`);
  line("sam permitted", JSON.stringify(samRes.permitted_workspaces));
  line("sam path", samRes.workspace_path);
  line("intersection_applied", samRes.intersection_applied);
  assert(samRes.role_topology.includes("urn:moos:user:sam"), "sam is in his own governs closure");
  assert(samRes.permitted_workspaces.length >= 1, "identified sam has a non-empty permitted set");
  assert(
    samRes.intersection_applied === false,
    "workstation ∩ SKIPPED at client tier (widened, not narrowed)",
  );
  assert(samRes.computed_by === "client-presentation", "computed_by is client-presentation");

  // (c) occupant-property [CONJ] FALLBACK: a synthetic fold with WF02 governs but NO WF19
  //     has-occupant, occupancy carried only as a session property.
  const synthetic = {
    nodes: {
      "urn:moos:user:demo": { urn: "urn:moos:user:demo", type_id: "user", properties: {} },
      "urn:moos:agent:demo.bot": { urn: "urn:moos:agent:demo.bot", type_id: "agent", properties: {} },
      "urn:moos:session:demo.ws": {
        urn: "urn:moos:session:demo.ws",
        type_id: "session",
        properties: { occupant: { value: "urn:moos:agent:demo.bot" } },
      },
    },
    relations: {
      "urn:moos:relation:demo.governs": {
        urn: "urn:moos:relation:demo.governs",
        rewrite_category: "WF02",
        src_urn: "urn:moos:user:demo",
        src_port: "governs",
        tgt_urn: "urn:moos:agent:demo.bot",
        tgt_port: "governed-by",
      },
    },
  };
  const demoScope = { ...sam, user: "urn:moos:user:demo", workstation: null };
  const demoRes = resolveAccess(synthetic, demoScope);
  line("fallback path", demoRes.workspace_path);
  line("fallback permitted", JSON.stringify(demoRes.permitted_workspaces));
  assert(
    demoRes.workspace_path === "occupant-property",
    "occupant-property FALLBACK fires when WF19 has-occupant is absent",
  );
  assert(
    demoRes.permitted_workspaces.includes("urn:moos:session:demo.ws"),
    "fallback attributes the session via properties.occupant ∈ governed principals",
  );

  // (d) worker-strip primitive: only `mode` is read from an inbound request; forged identity
  //     fields are never trusted (the worker re-injects the storage identity).
  const forged = {
    view_filter: {
      access: {
        mode: "identified",
        user: "urn:moos:user:EVIL",
        workstation: "urn:moos:workstation:attacker",
      },
    },
  };
  assert(readRequestedMode(forged) === "identified", "readRequestedMode extracts ONLY the posture");
  assert(readRequestedMode({}) === "anon", "missing access ⇒ anon (fail-closed)");
  assert(
    readRequestedMode({ view_filter: { access: { mode: "bogus", user: "x" } } }) === "anon",
    "a non-'identified' mode ⇒ anon (fail-closed)",
  );

  console.log("\nPASS: access law verified (anon public-only · bring-in WF02→WF19 · fallback · strip).");
}

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

  // Access law over the SAME live fold (+ a synthetic fallback fixture).
  accessChecks(fold);
}

main().catch((err) => {
  console.error(`\nFAIL: ${err instanceof Error ? err.stack || err.message : err}`);
  process.exit(1);
});
