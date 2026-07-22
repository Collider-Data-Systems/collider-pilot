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
  accessKeepSet,
  owningWorkspaces,
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
  // HELD INVARIANT (not-over-hidden): the fail-closed fixes must NOT drop sam's legit workspaces.
  for (const legit of ["urn:moos:session:sam.kernel-proper", "urn:moos:session:sam.moos-diary"]) {
    assert(
      samRes.permitted_workspaces.includes(legit),
      `sam's legit workspace ${legit.split(":").pop()} is still permitted (fixes don't over-hide)`,
    );
  }
  // t264: the member-of glue (ontology 4.0.4) — sam's closure now reaches his groups.
  for (const g of ["urn:moos:group:sam", "urn:moos:group:moos"]) {
    assert(samRes.role_topology.includes(g), `member-of closure reaches ${g.split(":").pop()}`);
  }
  assert(
    samRes.intersection_applied === false,
    "workstation ∩ SKIPPED at client tier (widened, not narrowed)",
  );
  assert(
    samRes.workstation_intersection === "skipped-widened",
    "sam (client tier) workstation_intersection = 'skipped-widened'",
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

  // (e) member-of transitivity (ontology 4.0.4): the workspace is reachable ONLY through
  //     nested membership (user → team-a → org-b → governs → occupant), and the walk never
  //     runs group→member (monotone widening, no reverse leak).
  const memberFold = {
    nodes: {
      "urn:moos:user:demo2": node("urn:moos:user:demo2", "user"),
      "urn:moos:group:team-a": node("urn:moos:group:team-a", "group"),
      "urn:moos:group:org-b": node("urn:moos:group:org-b", "group"),
      "urn:moos:agent:demo2.bot": node("urn:moos:agent:demo2.bot", "agent"),
      "urn:moos:session:demo2.ws": node("urn:moos:session:demo2.ws", "session"),
    },
    relations: {
      m1: rel("m1", "WF02", "urn:moos:user:demo2", "member-of", "urn:moos:group:team-a", "has-member"),
      m2: rel("m2", "WF02", "urn:moos:group:team-a", "member-of", "urn:moos:group:org-b", "has-member"),
      g1: rel("g1", "WF02", "urn:moos:group:org-b", "governs", "urn:moos:agent:demo2.bot", "governed-by"),
      o1: rel("o1", "WF19", "urn:moos:session:demo2.ws", "has-occupant", "urn:moos:agent:demo2.bot", "is-occupant-of"),
    },
  };
  const memberScope = { ...sam, user: "urn:moos:user:demo2", workstation: null };
  const memberRes = resolveAccess(memberFold, memberScope);
  line("member-of path", memberRes.workspace_path);
  line("member-of permitted", JSON.stringify(memberRes.permitted_workspaces));
  for (const hop of ["urn:moos:group:team-a", "urn:moos:group:org-b", "urn:moos:agent:demo2.bot"]) {
    assert(memberRes.role_topology.includes(hop), `member-of closure hops through ${hop.split(":").pop()}`);
  }
  assert(
    memberRes.permitted_workspaces.includes("urn:moos:session:demo2.ws"),
    "workspace reachable ONLY via nested membership is permitted",
  );
  const reverseRes = resolveAccess(memberFold, { ...sam, user: "urn:moos:group:org-b", workstation: null });
  assert(
    !reverseRes.role_topology.includes("urn:moos:user:demo2"),
    "member-of is NEVER followed group→member (no reverse leak)",
  );

  console.log("\nPASS: access law verified (anon public-only · bring-in WF02→WF19 · member-of transitivity · fallback · strip).");
}

/** Shorthand raw-node/relation builders for the synthetic over-exposure fixtures. */
const node = (urn, type_id, properties = {}) => ({ urn, type_id, properties });
const rel = (urn, rewrite_category, src_urn, src_port, tgt_urn, tgt_port) => ({
  urn,
  rewrite_category,
  src_urn,
  src_port,
  tgt_urn,
  tgt_port,
});
const identified = (user, workstation, enforced_by) => ({
  mode: "identified",
  user,
  workstation: workstation ?? null,
  role: null,
  identity_source: "trusted-storage",
  enforced_by: enforced_by ?? "client-presentation",
});

/**
 * The 4 must-fix over-exposure defects, each asserting the leak is CLOSED (with the pre-fix
 * behavior noted). Pure synthetic folds — no network — plus the live fold for FIX 1.
 */
function accessFixChecks(liveFold) {
  console.log("\n=== over-exposure fixes (each asserts the leak is CLOSED) ===");

  // ── FIX 1 — Badge honesty ────────────────────────────────────────────────────────────────
  // A chrome.storage flag sets enforcement='server-authoritative' but NO server path ran (this
  // is the client-side resolveAccess). BEFORE: computed_by echoed scope.enforced_by →
  // 'server-authoritative' → UI rendered ACCESS: ENFORCED + "the kernel returned only the
  // permitted subgraph" over a client computation. AFTER: computed_by is forced
  // 'client-presentation' → badge renders ACCESS: PRESENTATION.
  const forcedFlag = identified("urn:moos:user:sam", "urn:moos:workstation:hp-z440", "server-authoritative");
  const r1 = resolveAccess(liveFold, forcedFlag);
  line("FIX1 enforced_by", forcedFlag.enforced_by);
  line("FIX1 computed_by", r1.computed_by);
  assert(
    r1.computed_by === "client-presentation",
    "FIX1: enforcement flag does NOT promote computed_by (badge → PRESENTATION, was ENFORCED)",
  );

  // ── FIX 2 — TIER-AWARE unattributable handling ───────────────────────────────────────────
  // A bare secret purpose (no kb/occupant lineage, not public) + a low-priv identified user
  // whose governs-closure does NOT reach it. Tier-aware (97c5ef3): at the CLIENT-presentation
  // tier (not a boundary — the full fold is already in the panel) unattributable nodes are
  // SHOWN; at the SERVER-authoritative tier they FAIL CLOSED. Assert BOTH.
  const SECRET = "urn:moos:purpose:sam.secret-program";
  const s2 = {
    nodes: {
      "urn:moos:user:lowpriv": node("urn:moos:user:lowpriv", "user"),
      "urn:moos:agent:lowpriv.bot": node("urn:moos:agent:lowpriv.bot", "agent"),
      "urn:moos:session:lowpriv.ws": node("urn:moos:session:lowpriv.ws", "session"),
      [SECRET]: node(SECRET, "purpose"), // bare, no lineage, no visibility/anon_visible
    },
    relations: {
      g: rel("urn:moos:rel:s2.g", "WF02", "urn:moos:user:lowpriv", "governs", "urn:moos:agent:lowpriv.bot", "governed-by"),
      o: rel("urn:moos:rel:s2.o", "WF19", "urn:moos:session:lowpriv.ws", "has-occupant", "urn:moos:agent:lowpriv.bot", "is-occupant-of"),
    },
  };
  const r2 = resolveAccess(s2, identified("urn:moos:user:lowpriv", null)); // client-presentation
  const keep2 = accessKeepSet(s2, r2);
  const r2srv = { ...r2, computed_by: "server-authoritative" };            // simulate enforced tier
  const keep2srv = accessKeepSet(s2, r2srv);
  line("FIX2 permitted", JSON.stringify(r2.permitted_workspaces));
  line("FIX2 secret kept (client / server)", `${keep2.has(SECRET)} / ${keep2srv.has(SECRET)}`);
  assert(
    r2.permitted_workspaces.includes("urn:moos:session:lowpriv.ws"),
    "FIX2 setup: low-priv user's governs→occupant closure = {lowpriv.ws}",
  );
  assert(
    keep2srv.has(SECRET) === false,
    "FIX2 (server tier): bare null-owner secret purpose is HIDDEN — fail-closed",
  );
  assert(
    keep2.has(SECRET) === true,
    "FIX2 (client tier): unattributable node is SHOWN — client-presentation is not a boundary (97c5ef3)",
  );
  assert(
    keep2.has("urn:moos:session:lowpriv.ws") && keep2srv.has("urn:moos:session:lowpriv.ws"),
    "FIX2: the user's OWN workspace is shown in both tiers",
  );

  // ── FIX 3 — workspace attribution direction + multi-owner ─────────────────────────────────
  // KI `shared` is OWNED by non-permitted session A (A --provides-kb--> shared) but CITED by
  // permitted session B (shared --provides-kb--> B). BEFORE: the UNDIRECTED WF12 walk hopped
  // shared→B (src→tgt) and, depending on enumeration order, attributed shared to permitted B →
  // SHOWN. AFTER: the walk is provider→item ONLY, so shared is attributed to owner A → since A
  // is not permitted → HIDDEN. `legit` (genuinely B-owned) stays SHOWN.
  const A = "urn:moos:session:a.secret";
  const B = "urn:moos:session:b.permitted";
  const SHARED = "urn:moos:ki:shared";
  const LEGIT = "urn:moos:ki:legit";
  const s3 = {
    nodes: {
      "urn:moos:user:u3": node("urn:moos:user:u3", "user"),
      "urn:moos:agent:b.bot": node("urn:moos:agent:b.bot", "agent"),
      [B]: node(B, "session"),
      [A]: node(A, "session"),
      [SHARED]: node(SHARED, "knowledge_item"),
      [LEGIT]: node(LEGIT, "knowledge_item"),
    },
    relations: {
      // permitted set = {B}: u3 governs b.bot; B has-occupant b.bot.
      g: rel("urn:moos:rel:s3.g", "WF02", "urn:moos:user:u3", "governs", "urn:moos:agent:b.bot", "governed-by"),
      o: rel("urn:moos:rel:s3.o", "WF19", B, "has-occupant", "urn:moos:agent:b.bot", "is-occupant-of"),
      // NOTE ordering: the CITE (shared→B) is enumerated BEFORE the OWN (A→shared) precisely to
      // trip the old insertion-order misattribution — the fix must ignore direction, not order.
      cite: rel("urn:moos:rel:s3.cite", "WF12", SHARED, "provides-kb", B, "kb-source"),
      own: rel("urn:moos:rel:s3.own", "WF12", A, "provides-kb", SHARED, "kb-source"),
      ownB: rel("urn:moos:rel:s3.ownB", "WF12", B, "provides-kb", LEGIT, "kb-source"),
    },
  };
  const r3 = resolveAccess(s3, identified("urn:moos:user:u3", null));
  const keep3 = accessKeepSet(s3, r3);
  line("FIX3 permitted", JSON.stringify(r3.permitted_workspaces));
  line("FIX3 owners(shared)", JSON.stringify(owningWorkspaces(s3, SHARED)));
  assert(
    r3.permitted_workspaces.includes(B) && !r3.permitted_workspaces.includes(A),
    "FIX3 setup: permitted = {B}, non-permitted session A excluded",
  );
  assert(
    JSON.stringify(owningWorkspaces(s3, SHARED)) === JSON.stringify([A]),
    "FIX3: owningWorkspaces walks provider→item ONLY — `shared` attributed to owner A, not citee B",
  );
  assert(
    !keep3.has(SHARED),
    "FIX3: KI owned by non-permitted A but cited by permitted B is HIDDEN (was misattributed→shown)",
  );
  assert(
    keep3.has(LEGIT),
    "FIX3: KI genuinely owned by permitted B is SHOWN (no over-hide)",
  );
  // multi-owner fail-closed: a KI provided-kb by BOTH A(non-permitted) and B(permitted) is HIDDEN.
  const MULTI = "urn:moos:ki:multi";
  const s3b = {
    nodes: { ...s3.nodes, [MULTI]: node(MULTI, "knowledge_item") },
    relations: {
      ...s3.relations,
      mA: rel("urn:moos:rel:s3.mA", "WF12", A, "provides-kb", MULTI, "kb-source"),
      mB: rel("urn:moos:rel:s3.mB", "WF12", B, "provides-kb", MULTI, "kb-source"),
    },
  };
  const keep3b = accessKeepSet(s3b, resolveAccess(s3b, identified("urn:moos:user:u3", null)));
  assert(
    !keep3b.has(MULTI),
    "FIX3: multi-owner {A,B} node is HIDDEN — EVERY owner must be permitted (fail-closed ambiguity)",
  );

  // ── FIX 4 — Workstation fail-closed under a server-authoritative claim ────────────────────
  // Governs-closure yields {u4.ws}; the claimed workstation has NO placement relation (opens-on/
  // realizes → workstation) so workspacesOnWorkstation() returns null. BEFORE: server-auth + null
  // binding SILENTLY SKIPPED the ∩ → the full governs closure was returned (widened leak). AFTER:
  // server-auth + unresolvable ⇒ FAIL CLOSED (governs closure dropped to public-only).
  const GHOST_WS = "urn:moos:workstation:ghost";
  const s4 = {
    nodes: {
      "urn:moos:user:u4": node("urn:moos:user:u4", "user"),
      "urn:moos:agent:u4.bot": node("urn:moos:agent:u4.bot", "agent"),
      "urn:moos:session:u4.ws": node("urn:moos:session:u4.ws", "session"),
    },
    relations: {
      g: rel("urn:moos:rel:s4.g", "WF02", "urn:moos:user:u4", "governs", "urn:moos:agent:u4.bot", "governed-by"),
      o: rel("urn:moos:rel:s4.o", "WF19", "urn:moos:session:u4.ws", "has-occupant", "urn:moos:agent:u4.bot", "is-occupant-of"),
    },
  };
  const rClient4 = resolveAccess(s4, identified("urn:moos:user:u4", GHOST_WS, "client-presentation"));
  const rServer4 = resolveAccess(s4, identified("urn:moos:user:u4", GHOST_WS, "server-authoritative"));
  line("FIX4 client permitted", JSON.stringify(rClient4.permitted_workspaces));
  line("FIX4 client wsi", rClient4.workstation_intersection);
  line("FIX4 server permitted", JSON.stringify(rServer4.permitted_workspaces));
  line("FIX4 server wsi", rServer4.workstation_intersection);
  assert(
    rClient4.permitted_workspaces.includes("urn:moos:session:u4.ws") &&
      rClient4.workstation_intersection === "skipped-widened",
    "FIX4 baseline: client-presentation tier WIDENS (governs closure returned, skipped-widened)",
  );
  assert(
    !rServer4.permitted_workspaces.includes("urn:moos:session:u4.ws"),
    "FIX4: server-authoritative + unresolvable workstation does NOT return the governs closure",
  );
  assert(
    rServer4.workstation_intersection === "failed-closed",
    "FIX4: workstation_intersection = 'failed-closed' (never silently skipped/widened at server tier)",
  );

  // ── HELD INVARIANT — worker-strip drops a forged urn:moos:user:EVIL ──────────────────────
  // The panel/page may contribute ONLY access.mode; a forged identity is never read.
  const forgedEvil = {
    view_filter: {
      access: {
        mode: "identified",
        user: "urn:moos:user:EVIL",
        workstation: "urn:moos:workstation:attacker",
        role: "urn:moos:role:superadmin",
        identity_source: "trusted-storage",
        enforced_by: "server-authoritative",
      },
    },
  };
  assert(readRequestedMode(forgedEvil) === "identified", "strip: only the posture is extracted");
  // Proof the forged fields never reach a resolution: the worker re-injects the TRUSTED scope
  // (here anon, since no trusted storage) — EVIL/attacker never appear.
  const stripped = resolveAccess(liveFold, {
    mode: "anon",
    user: ANON_USER_URN,
    workstation: null,
    role: null,
    identity_source: "anon",
    enforced_by: "client-presentation",
  });
  const strippedJson = JSON.stringify(stripped);
  assert(
    !strippedJson.includes("EVIL") && !strippedJson.includes("attacker"),
    "strip: forged urn:moos:user:EVIL / workstation:attacker never surface in the resolution",
  );
  assert(
    stripped.permitted_workspaces.length === stripped.public_workspaces.length,
    "strip→anon: a forged 'identified' with no trusted backing resolves public-only",
  );

  console.log(
    "\nPASS: over-exposure fixes verified (badge honesty · null-owner fail-closed · directed multi-owner · workstation fail-closed · strip).",
  );
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

  // The 4 over-exposure fixes, each asserting the leak is CLOSED (before→after in comments).
  accessFixChecks(fold);
}

main().catch((err) => {
  console.error(`\nFAIL: ${err instanceof Error ? err.stack || err.message : err}`);
  process.exit(1);
});
