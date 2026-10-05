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

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

import { createStreamableHttpClient } from "../src/mcp/streamable-http-client.js";
import {
  selectFrame,
  parseGraphStateResult,
  parseNodeLookupResult,
  summarizeFrame,
  applyViewFilter,
  resolveViewFilter,
  unnamedEngineIdentity,
  DEFAULT_ENGINE_URN,
  DEFAULT_ENGINE_URL,
  DEFAULT_MCP_BASE_URL,
  DEFAULT_SCOPE_URN,
} from "../src/mcp/transform.js";
import {
  resolveAccess,
  accessKeepSet,
  owningWorkspaces,
  readRequestedMode,
  ANON_USER_URN,
} from "../src/mcp/access.js";
import {
  channelUrnCandidates,
  parseEngineHint,
  resolutionFromChannelNode,
  resolveSurfaceEngine,
} from "../src/mcp/surface-resolver.js";
// t337: the knowledge ports are READ from the Lean-emitted vocabulary — the same module
// GraphControls.tsx builds its "knowledge" port group and lens from. Never restated here.
import {
  KB_NESTING_PORT,
  KB_NODE_TYPES,
  KB_ONTOLOGY_VERSION,
  KB_PORTS,
  KB_RELATIONS,
  KB_REWRITE_CATEGORY,
} from "../src/ui/kb-vocab.js";

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
  // t337: stamped the way the adapter stamps an engine nobody named — what the engine
  // itself reports, else `unnamedEngineIdentity` (the default urn on the default endpoints
  // only). A non-default engine with no kernel_urn used to print the default engine's urn.
  const frame = selectFrame(fold, {
    healthz: health,
    engine:
      typeof health.kernel_urn === "string" && health.kernel_urn.length > 0
        ? health.kernel_urn
        : unnamedEngineIdentity(engineUrl, mcpBaseUrl),
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

  // t264 search ranking on the LIVE fold: the obvious query must reach the obvious node.
  searchRankingChecks(fold, health);

  // t337: the find box also matches inside text properties — on the real node-search.ts.
  await textSearchChecks(fold, health);

  // t264 axes over the LIVE fold read through the REAL MCP transport (not a fixture):
  // this is the coverage the extension's own self-test provides in the browser realm.
  liveAxisChecks(fold, health);

  // t337: the identity stamped on an engine nobody named (pure — no engine needed).
  engineIdentityChecks();

  // t337: the 4.0.8 knowledge VOCAB renders BEFORE the fleet carries any knowledge data.
  knowledgeVocabChecks();

  // t337: what the knowledge drawing is ASKED to draw — which node sits in which box, and
  // which layout `auto` resolves to — on the real FrameGraph.tsx rules.
  await nestingRuleChecks(fold, health);

  // A16: the engine self-identifies (healthz kernel_urn, the A6 surface) and the
  // transform stamps it beside the claimed engine — the mismatch warning's raw material.
  console.log("\n=== A16 engine self-identification ===");
  assert(
    typeof health.kernel_urn === "string" && health.kernel_urn.length > 0,
    `healthz carries kernel_urn (${health.kernel_urn})`,
  );
  assert(
    frame.provenance.engine_reported === health.kernel_urn,
    "provenance.engine_reported === healthz kernel_urn",
  );

  // A16: surface_key -> channel -> engine resolution (pure fixtures + the live directory).
  await surfaceResolutionChecks(engineUrl);

  // Access law over the SAME live fold (+ a synthetic fallback fixture).
  accessChecks(fold);

  // The 4 over-exposure fixes, each asserting the leak is CLOSED (before→after in comments).
  accessFixChecks(fold);

  // t264 slice axes: ports filter · N-hop scope · the ["*"] all-types sentinel.
  sliceAxisChecks();

  // T7: the 4.0.5 kinship VOCAB renders BEFORE any kinship data reaches a fold.
  kinshipVocabChecks();
}

/**
 * t337 — which identity a frame is stamped with when NOBODY named the engine (no urn from
 * the caller, no kernel_urn on /healthz). The rule is transform.js `unnamedEngineIdentity`,
 * the one the adapter and the live harness call. Measured before it existed: the t336
 * scratch kernel (:8899, started without a kernel urn) rendered as
 * urn:moos:kernel:hp-z440.primary, and no ENGINE MISMATCH could contradict it because the
 * warning needs a reported urn.
 */
function engineIdentityChecks() {
  console.log("\n=== t337 identity of an engine nobody named ===");
  assert(
    unnamedEngineIdentity(DEFAULT_ENGINE_URL, DEFAULT_MCP_BASE_URL) === DEFAULT_ENGINE_URN,
    "the default endpoints keep the default engine urn (unchanged)",
  );
  const custom = unnamedEngineIdentity("http://127.0.0.1:18999", "http://127.0.0.1:18998");
  assert(
    custom === "unidentified engine at 127.0.0.1:18999",
    `a custom pair is named by its REST endpoint (${custom})`,
  );
  assert(
    custom !== DEFAULT_ENGINE_URN && !custom.startsWith("urn:"),
    "…never as the default engine, and not as a urn (the pilot mints no graph identity)",
  );
  assert(
    unnamedEngineIdentity(DEFAULT_ENGINE_URL, "http://127.0.0.1:18998") !== DEFAULT_ENGINE_URN,
    "a non-default MCP base alone already makes the pair custom",
  );
  // The stamp reaches provenance verbatim, and with nothing reported there is nothing for
  // the mismatch warning to compare — the unidentified name is the whole statement.
  const stamped = selectFrame({ nodes: {}, relations: {} }, { healthz: {}, engine: custom });
  assert(
    stamped.provenance.engine === custom && stamped.provenance.engine_reported === null,
    "provenance carries the unidentified name with engine_reported null",
  );
}

/**
 * t337 — the WF12 knowledge ports (ontology 4.0.8: part-of, derived-from, … read from the
 * Lean-emitted vocabulary, never restated). The fleet primary is below 4.0.8 and carries
 * none of these relations, so check (g) above skips every one of them there. Exactly as
 * with kinship below, the lens is therefore asserted on a SYNTHETIC knowledge graph
 * (synthetic urns only; the repo is public): one relation per vocabulary port, between
 * node types the vocabulary allows on its ends.
 */
function knowledgeVocabChecks() {
  console.log(
    `\n=== t337 knowledge VOCAB (ontology ${KB_ONTOLOGY_VERSION}, ahead of the fleet's data) ===`,
  );

  // The knowledge lens declares the vocabulary's ports (parsed from GraphControls.tsx).
  const lens = parseLensTable().find((l) => l.id === "knowledge");
  assert(lens !== undefined, "the knowledge lens exists");
  assert(
    lens.ports.length === KB_PORTS.length && KB_PORTS.every((p) => lens.ports.includes(p)),
    `the knowledge lens declares exactly the vocabulary's ${KB_PORTS.length} ports`,
  );

  const node = (type, n) => ({ urn: `urn:moos:${type}:${n}`, type_id: type, label: n, properties: {} });
  const nodes = [];
  const relations = [];
  KB_RELATIONS.forEach((r, i) => {
    const src = node(r.src_types[0], `kb-src-${i}`);
    const tgt = node(r.tgt_types[0], `kb-tgt-${i}`);
    nodes.push(src, tgt);
    relations.push({
      urn: `kb${i}`,
      type_id: KB_REWRITE_CATEGORY,
      label: r.src_port,
      source_urn: src.urn,
      target_urn: tgt.urn,
    });
  });
  // A node of a type the knowledge graph also uses, but on NO knowledge relation.
  const outsider = node(KB_NODE_TYPES.find((t) => !lens.types.includes(t)), "kb-outsider");
  nodes.push(outsider);

  const slice = applyViewFilter(
    nodes,
    relations,
    resolveViewFilter(
      { view_filter: { types: lens.types, ports: lens.ports, lens: "knowledge" } },
      { t_day: 337 },
    ),
    false,
  );
  assert(
    slice.relations.length === KB_RELATIONS.length,
    `the knowledge lens renders all ${KB_RELATIONS.length} knowledge relations (got ${slice.relations.length})`,
  );
  // The lens selects only its listed type(s); the relation closure brings in what the
  // knowledge relations point at — and nothing else of those types.
  assert(
    slice.nodes.length === nodes.length - 1 && !slice.nodes.some((n) => n.urn === outsider.urn),
    `what the relations point at comes along; an unrelated ${outsider.type_id} stays out (${slice.nodes.length} of ${nodes.length} nodes)`,
  );
  // Knowledge ports narrow like any other port family.
  const nestOnly = applyViewFilter(
    nodes,
    relations,
    resolveViewFilter({ view_filter: { types: ["*"], ports: [KB_NESTING_PORT] } }, { t_day: 337 }),
    false,
  );
  assert(
    nestOnly.relations.length === 1 && nestOnly.relations[0].label === KB_NESTING_PORT,
    `ports ['${KB_NESTING_PORT}'] narrows to exactly the nesting relation`,
  );

  console.log("\nPASS: t337 knowledge VOCAB present and renderable ahead of the fleet's 4.0.8 data.");
}

/**
 * Load `src/components/FrameGraph.tsx` for its two PURE exports. Type-stripped with
 * `ts.transpileModule` and written one directory below the source (so `../` specifiers
 * gain a level), next to the one TypeScript module it imports a VALUE from
 * (`state/prefs.ts`). React and Cytoscape resolve from node_modules and are only loaded:
 * nothing here mounts a component or draws.
 */
async function loadFrameGraphRules() {
  const strip = (file) =>
    ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
  const components = fileURLToPath(new URL("../src/components/", import.meta.url));
  const dir = mkdtempSync(join(components, ".live-smoke-"));
  try {
    writeFileSync(join(dir, "prefs.mjs"), strip("../src/state/prefs.ts"));
    writeFileSync(
      join(dir, "FrameGraph.mjs"),
      strip("../src/components/FrameGraph.tsx")
        .replaceAll('from "../state/prefs"', 'from "./prefs.mjs"')
        .replaceAll('from "../', 'from "../../'),
    );
    return await import(pathToFileURL(join(dir, "FrameGraph.mjs")).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * t337 — the two rules that decide what the knowledge drawing is asked to draw, on the
 * REAL code (`nestingParents`, `resolveGraphLayout`, exported by FrameGraph.tsx):
 *   - the vocabulary's nesting relation puts its source INSIDE its target, one box per
 *     node, a domain_tag before a program, and never inside any other type;
 *   - `auto` (no layout picked) is `nested` exactly when that draws a box, and
 *     `concentric` — the layout from before t337 — on every other frame.
 * No gate renders Cytoscape, so the picture itself is looked at, not asserted; these two
 * rules are pure, and the fleet carries no nesting relation yet, so they are asserted on a
 * synthetic hierarchy (synthetic urns only; the repo is public) and then on the live fold.
 * Types and the port come from the vocabulary — nothing is restated.
 * @param {any} fold
 * @param {any} health
 */
async function nestingRuleChecks(fold, health) {
  console.log("\n=== t337 nesting + auto layout (the real src/components/FrameGraph.tsx) ===");
  const { nestingParents, resolveGraphLayout } = await loadFrameGraphRules();
  const nesting = KB_RELATIONS.find((r) => r.src_port === KB_NESTING_PORT);
  assert(
    nesting !== undefined,
    `the vocabulary declares one nesting relation (${KB_NESTING_PORT})`,
  );

  // The box types, in the order the rule prefers them, and a target type that is no box.
  const [TAG, MODULE] = ["domain_tag", "program"];
  const OTHER = nesting.tgt_types.find((t) => t !== TAG && t !== MODULE);
  const LEAF = nesting.src_types.find((t) => !nesting.tgt_types.includes(t));
  assert(
    nesting.tgt_types.includes(TAG) && nesting.tgt_types.includes(MODULE) && OTHER && LEAF,
    `the nesting relation targets ${TAG}, ${MODULE} and one more type (${OTHER}); ${LEAF} only nests`,
  );
  const node = (type, n) => ({
    urn: `urn:moos:${type}:nest-${n}`,
    type_id: type,
    label: n,
    properties: {},
  });
  let seq = 0;
  const rel = (label, src, tgt) => ({
    urn: `nest${seq++}`,
    type_id: KB_REWRITE_CATEGORY,
    label,
    source_urn: src.urn,
    target_urn: tgt.urn,
  });
  const frameOf = (nodes, relations) => ({ provenance: {}, nodes, relations });

  const leaf = node(LEAF, "leaf");
  const both = node(LEAF, "both");
  const field = node(TAG, "field");
  const topic = node(TAG, "topic");
  const module = node(MODULE, "module");
  const other = node(OTHER, "other");
  const nodes = [leaf, both, field, topic, module, other];
  const relations = [
    rel(KB_NESTING_PORT, leaf, field),
    rel(KB_NESTING_PORT, field, topic),
    rel(KB_NESTING_PORT, topic, module),
    rel(KB_NESTING_PORT, topic, other), // a target that is never a box
    rel(KB_NESTING_PORT, both, module), // two targets: the tag wins over the module
    rel(KB_NESTING_PORT, both, field),
    rel(KB_PORTS.find((p) => p !== KB_NESTING_PORT), leaf, both), // not a nesting port
    rel(KB_NESTING_PORT, leaf, leaf), // a node is never its own box
  ];
  const hierarchy = frameOf(nodes, relations);
  const parents = nestingParents(hierarchy);
  const want = [
    [leaf, field],
    [field, topic],
    [topic, module],
    [both, field],
  ];
  assert(
    parents.size === want.length && want.every(([n, box]) => parents.get(n.urn) === box.urn),
    `each node sits in ONE box: leaf in field, field in topic, topic in module (${parents.size} nested)`,
  );
  assert(parents.get(both.urn) === field.urn, `two targets: the ${TAG} is the box, not the ${MODULE}`);
  assert(
    ![...parents.values()].includes(other.urn),
    `a ${OTHER} target is never a box — that relation stays a line`,
  );
  const reversed = nestingParents(frameOf([...nodes].reverse(), [...relations].reverse()));
  assert(
    reversed.size === parents.size && [...parents].every(([n, box]) => reversed.get(n) === box),
    "the boxes do not depend on the order the engine returns nodes and relations in",
  );
  const a = node(TAG, "cycle-a");
  const b = node(TAG, "cycle-b");
  const cut = nestingParents(
    frameOf([a, b], [rel(KB_NESTING_PORT, a, b), rel(KB_NESTING_PORT, b, a)]),
  );
  assert(
    cut.size === 1,
    `a cycle (a in b in a) is cut: one box, the other relation stays a line (${cut.size})`,
  );

  // `auto` — nested exactly when a box is drawn; an explicit choice is drawn as chosen.
  const flat = frameOf([leaf, both], [relations[6]]);
  const noBox = frameOf([topic, other], [rel(KB_NESTING_PORT, topic, other)]);
  assert(
    resolveGraphLayout("auto", hierarchy) === "nested",
    "auto on a frame that draws a box is nested",
  );
  assert(
    resolveGraphLayout("auto", flat) === "concentric",
    "auto on a frame without the nesting relation is concentric (as before t337)",
  );
  assert(
    resolveGraphLayout("auto", noBox) === "concentric",
    "auto on a frame whose nesting relation draws no box is concentric",
  );
  const picked = ["concentric", "breadthfirst", "grid", "nested"];
  assert(
    picked.every((l) => resolveGraphLayout(l, hierarchy) === l && resolveGraphLayout(l, flat) === l),
    `a picked layout is drawn as picked on every frame (${picked.join(", ")})`,
  );

  // The LIVE fold, lens by lens (the table parsed from GraphControls.tsx).
  const whole = selectFrame(fold, { healthz: health, request: { view_filter: { types: ["*"] } } });
  const liveNesting = whole.relations.filter((r) => r.label === KB_NESTING_PORT).length;
  for (const lens of parseLensTable()) {
    const slice = selectFrame(fold, {
      healthz: health,
      request: { view_filter: { types: lens.types, ports: lens.ports, lens: lens.id } },
    });
    const boxed = nestingParents(slice);
    const auto = resolveGraphLayout("auto", slice);
    assert(
      (auto === "nested") === (boxed.size > 0) && (liveNesting > 0 || auto === "concentric"),
      `lens '${lens.id}' on the live fold: auto -> ${auto} ` +
        `(${boxed.size} of ${slice.nodes.length} nodes in ${new Set(boxed.values()).size} boxes)`,
    );
  }
  console.log(
    `\nPASS: t337 nesting rules hold; this fold has ${liveNesting} nesting relations` +
      (liveNesting > 0 ? "." : " — every lens draws concentric, as before."),
  );
}

/**
 * T7 — WF01 kinship ports (ontology 4.0.5: parent-of/child-of · spouse-of/spouse-of ·
 * sibling-of/sibling-of). The kinship APPLY is Sam-gated behind G3, so no live fold
 * carries these labels yet — which is exactly why this is asserted on a SYNTHETIC family
 * (synthetic urns only; the repo is public): the pilot's vocabulary and lens must render
 * kinship the day the data lands, never be the blocker. Checks (d)/(g) above then keep
 * covering the live side once real labels appear.
 */
function kinshipVocabChecks() {
  console.log("\n=== T7 kinship VOCAB (ontology 4.0.5, ahead of any applied data) ===");

  // The identity lens declares all four ports (parsed from GraphControls.tsx — no copy).
  const identity = parseLensTable().find((l) => l.id === "identity");
  const KINSHIP = ["parent-of", "child-of", "spouse-of", "sibling-of"];
  assert(identity !== undefined, "the identity lens exists");
  for (const p of KINSHIP) {
    assert(identity.ports.includes(p), `identity lens declares '${p}'`);
  }

  // A synthetic family folds through the REAL applyViewFilter and every kinship relation
  // survives — i.e. the pilot RENDERS these relation types, both under the identity
  // lens's declared ports and under the all-ports default.
  const person = (n) => ({ urn: `urn:moos:user:${n}`, type_id: "user", label: n, properties: {} });
  const nodes = [person("ada"), person("ben"), person("cai"), person("dot")];
  const kin = (urn, label, src, tgt) => ({
    urn,
    type_id: "WF01",
    label,
    source_urn: `urn:moos:user:${src}`,
    target_urn: `urn:moos:user:${tgt}`,
  });
  const relations = [
    kin("k1", "parent-of", "ada", "cai"),
    kin("k2", "child-of", "cai", "ada"),
    kin("k3", "spouse-of", "ada", "ben"),
    kin("k4", "sibling-of", "cai", "dot"),
  ];
  const lensSlice = applyViewFilter(
    nodes,
    relations,
    resolveViewFilter(
      { view_filter: { types: identity.types, ports: identity.ports, lens: "identity" } },
      { t_day: 275 },
    ),
    false,
  );
  assert(
    lensSlice.relations.length === 4,
    `the identity lens renders all 4 kinship relations (got ${lensSlice.relations.length})`,
  );
  const allSlice = applyViewFilter(
    nodes,
    relations,
    resolveViewFilter({ view_filter: { types: ["*"] } }, { t_day: 275 }),
    false,
  );
  assert(
    allSlice.relations.length === 4,
    "the all-ports default renders all 4 kinship relations",
  );
  // Kinship narrows like any other port family: asking for spouse-of alone keeps only it.
  const spouseOnly = applyViewFilter(
    nodes,
    relations,
    resolveViewFilter({ view_filter: { types: ["*"], ports: ["spouse-of"] } }, { t_day: 275 }),
    false,
  );
  assert(
    spouseOnly.relations.length === 1 && spouseOnly.relations[0].label === "spouse-of",
    "ports ['spouse-of'] narrows to exactly the spouse relation",
  );

  console.log("\nPASS: T7 kinship VOCAB present and renderable ahead of the G3-gated apply.");
}

/**
 * A16 — surface_key -> channel -> engine resolution. Pure parts on synthetic channel
 * nodes (public shapes only — the display_name grammar is the tracked manifest's, the
 * urns synthetic); then the LIVE chain against the running primary's directory read,
 * exactly as the worker resolves it. The optional twin round-trip (does :8001 really
 * answer as menno?) is skipped, not failed, when the twin is down — this gate must stay
 * runnable with only the primary up (TESTING.md's stated precondition).
 * @param {string} engineUrl
 */
async function surfaceResolutionChecks(engineUrl) {
  console.log("\n=== A16 surface -> channel -> engine resolution ===");

  // Candidates: exact key first; bare twin alias appended; invalid keys resolve nowhere.
  assert(
    JSON.stringify(channelUrnCandidates("z440-menno")) ===
      JSON.stringify(["urn:moos:channel:virtual-desktop.z440-menno"]),
    "an exact launcher key maps to its channel urn only",
  );
  assert(
    JSON.stringify(channelUrnCandidates("menno")) ===
      JSON.stringify([
        "urn:moos:channel:virtual-desktop.menno",
        "urn:moos:channel:virtual-desktop.z440-menno",
      ]),
    "a bare twin key aliases to the z440- channel as fallback",
  );
  assert(
    channelUrnCandidates("Not A Key!").length === 0 && channelUrnCandidates("").length === 0,
    "invalid keys produce no candidates",
  );

  // The display_name grammar: "... <host>.<leaf> :<port>" resolves; rooms without an
  // engine tail do not; the parse is case-sensitive lowercase like every kernel urn.
  const hint = parseEngineHint("Z440 desktop 2: my-tiny-data-collider.hp-z440.menno :8001");
  assert(
    hint !== null &&
      hint.engineUrn === "urn:moos:kernel:hp-z440.menno" &&
      hint.port === 8001,
    `engine hint parses host/leaf/port (${hint && hint.engineUrn} :${hint && hint.port})`,
  );
  assert(
    parseEngineHint("Z440 desktop 9: Example_manifold.WORKSPACE[PARAMETERS]") === null,
    "an engine-less room's display_name parses to no hint",
  );

  // Pure resolution over synthetic wrapped nodes: a Z440 twin PREFERS its localhost
  // transport (twins answer MCP on :9001-:9003, NOT :8080+offset) with the tailnet pair
  // as the verification alternative; another workstation's engine prefers its TAILNET
  // transport (t278 fleet-wide reads — the async resolver then keeps the first candidate
  // whose engine self-reports the expected kernel_urn).
  const wrapped = (displayName) => ({
    properties: { display_name: { value: displayName } },
  });
  const local = resolutionFromChannelNode(
    "z440-menno",
    "urn:moos:channel:virtual-desktop.z440-menno",
    wrapped("Z440 desktop 2: demo.hp-z440.menno :8001"),
  );
  assert(
    local !== null &&
      local.reachable === true &&
      local.engine_url === "http://localhost:8001" &&
      local.mcp_base_url === "http://localhost:9001",
    "a Z440 twin prefers engine_url :8001 + MCP :9001 (localhost first)",
  );
  assert(
    local !== null &&
      Array.isArray(local.transport_candidates) &&
      local.transport_candidates.length === 2 &&
      local.transport_candidates[1].engineUrl === "http://100.82.243.13:8001",
    "the twin's verification alternative is its tailnet pair",
  );
  const remote = resolutionFromChannelNode(
    "hp-laptop-primary",
    "urn:moos:channel:virtual-desktop.hp-laptop-primary",
    wrapped("Z440 desktop 5: demo.hp-laptop.primary :8000"),
  );
  assert(
    remote !== null &&
      remote.reachable === true &&
      remote.engine_urn === "urn:moos:kernel:hp-laptop.primary" &&
      remote.engine_url === "http://100.106.220.58:8000" &&
      remote.mcp_base_url === "http://100.106.220.58:8080",
    "another workstation's engine resolves its TAILNET transport (fleet-wide reads, t278)",
  );

  // LIVE: the t266 channel batch, consumed. The directory is the running primary.
  const live = await resolveSurfaceEngine("z440-menno", { directoryUrl: engineUrl });
  assert(
    live !== null && live.engine_urn === "urn:moos:kernel:hp-z440.menno",
    `LIVE: ?surface=z440-menno resolves to hp-z440.menno via ${live && live.channel_urn}`,
  );
  const alias = await resolveSurfaceEngine("menno", { directoryUrl: engineUrl });
  assert(
    alias !== null && alias.engine_urn === "urn:moos:kernel:hp-z440.menno",
    "LIVE: the bare alias ?surface=menno resolves to the same engine",
  );
  const nowhere = await resolveSurfaceEngine("zzz-not-a-surface", { directoryUrl: engineUrl });
  assert(nowhere === null, "LIVE: an unknown surface key resolves to null (default engine)");

  // Twin round-trip (best-effort): the resolved engine must SELF-REPORT the resolved urn.
  if (live && live.reachable && live.engine_url) {
    try {
      const res = await fetch(`${live.engine_url}/healthz`, {
        signal: AbortSignal.timeout(3000),
      });
      const twinHealth = await res.json();
      assert(
        twinHealth.kernel_urn === live.engine_urn,
        `LIVE: ${live.engine_url} self-reports ${live.engine_urn} (match, no warning)`,
      );
    } catch {
      console.log("  (twin engine not reachable — round-trip skipped, resolution asserted above)");
    }
  }

  console.log("\nPASS: A16 surface resolution verified (candidates · hint grammar · transports · live chain).");
}

/**
 * t264 search ranking, on the LIVE fold. Taking the first fold-order match made searching
 * an APPLIED PROGRAM's name select a governance_proposal that merely mentioned it — and
 * inspecting applied programs is a first-class use of this panel. Mirrors the ranking in
 * src/ui/node-search.ts (TS, so not importable here) and asserts the outcome that matters.
 * @param {any} fold
 * @param {any} health
 */
function searchRankingChecks(fold, health) {
  console.log("\n=== t264 search ranking (live fold) ===");
  const frame = selectFrame(fold, { healthz: health, request: { view_filter: { types: ["*"] } } });
  const tail = (u) => u.split(":").pop();
  const stripOwner = (t) => (t.indexOf(".") > 0 ? t.slice(t.indexOf(".") + 1) : t);
  // Normalize exactly as matchRank does. This mirror is hand-copied (the TS is not
  // importable here), so the normalization has to be copied too: without the trim/lowercase
  // an uppercase slug never matches the lowercased urn, and without the empty-query guard
  // `startsWith("")` ranks EVERY node 1 where matchRank ranks none.
  const rank = (n, query) => {
    const q = String(query ?? "").trim().toLowerCase();
    if (!q) return Infinity;
    const urn = n.urn.toLowerCase(), t = tail(urn), l = (n.label || "").toLowerCase();
    if (t === q || stripOwner(t) === q) return 0;
    if (t.startsWith(q) || stripOwner(t).startsWith(q)) return 1;
    if (urn.includes(q)) return 2;
    if (l.startsWith(q)) return 3;
    if (l.includes(q)) return 4;
    return Infinity;
  };
  const best = (q) => frame.nodes
    .map((n, i) => ({ n, r: rank(n, q), i }))
    .filter((x) => x.r !== Infinity)
    .sort((a, b) => a.r - b.r || a.i - b.i)[0];

  // A program searched by its slug must select the PROGRAM.
  const prog = frame.nodes.find((n) => n.type_id === "program");
  if (prog) {
    const slug = stripOwner(tail(prog.urn));
    const hit = best(slug);
    assert(
      hit && hit.n.urn === prog.urn,
      `program slug "${slug}" selects the program itself (got ${hit && hit.n.type_id} ${hit && tail(hit.n.urn)})`,
    );
  } else {
    console.log("  (no program node in this fold - program ranking skipped)");
  }

  // An exact urn tail always wins, whatever else mentions it.
  const sample = frame.nodes[Math.floor(frame.nodes.length / 2)];
  const exact = best(tail(sample.urn).toLowerCase());
  assert(exact && exact.n.urn === sample.urn, `exact urn tail wins for ${tail(sample.urn)}`);

  // A miss is a miss.
  assert(best("zzz-not-a-node-anywhere") === undefined, "a non-matching query ranks nothing");

  // The mirror has to normalize like matchRank, or it silently stops guarding the thing it
  // claims to guard. Measured against the pre-fix rank(): the EMPTY query reached
  // `startsWith("")` and ranked every node 1 (matchRank returns Infinity), and an UPPERCASE
  // slug matched nothing at all against the lowercased urn — a false negative that would
  // have failed the program-slug assert had any urn carried a capital. The whitespace case
  // already behaved, so that line is a lock, not a catch.
  assert(best("") === undefined, "an empty query ranks nothing");
  assert(best("   ") === undefined, "a whitespace-only query ranks nothing");
  if (prog) {
    const slug = stripOwner(tail(prog.urn));
    const noisy = best(`  ${slug.toUpperCase()}  `);
    assert(
      noisy && noisy.n.urn === prog.urn,
      `an uppercase, space-padded slug selects the same program ("${slug.toUpperCase()}")`,
    );
  }
}

/**
 * t337 text search, on the REAL ranking. `searchRankingChecks` above mirrors ranks 0-4 by
 * hand; the rank added at t337 — a match inside a text property — is exercised on
 * `src/ui/node-search.ts` itself, type-stripped in memory with `ts.transpileModule` the way
 * lens-smoke reads GraphControls.tsx. The file has only a type import, so it loads as a
 * data module and nothing is written to disk.
 *
 * Asserted: a word found only inside a text property selects a node that carries it, and
 * the hint says where; a urn / label match always outranks a text-only match; every match
 * is listed, best first (the graph fades the rest); and on the live fold the real ranking
 * gives the same answers the mirror above asserts.
 * @param {any} fold
 * @param {any} health
 */
async function textSearchChecks(fold, health) {
  console.log("\n=== t337 text search (the real src/ui/node-search.ts) ===");
  const source = readFileSync(new URL("../src/ui/node-search.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const { searchNodes, matchRank, SEARCH_PROPERTIES } = await import(
    `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
  );
  const tail = (u) => u.split(":").pop();

  // (a) Synthetic: three nodes, one word that sits in a label AND in another node's text.
  const one = {
    urn: "urn:moos:claim:x.one",
    type_id: "claim",
    label: "Merge is a join",
    properties: {
      text: "Merge is a join; the colimit reading is a conjecture.",
      pointer: "ledger item 12, first pointer",
    },
  };
  const tag = { urn: "urn:moos:tag:x.colimit", type_id: "domain_tag", label: "Colimit", properties: {} };
  const two = {
    urn: "urn:moos:claim:x.two",
    type_id: "claim",
    label: "A second claim",
    properties: { text: "Nothing about the other word here." },
  };
  const nodes = [one, tag, two];

  const inText = searchNodes(nodes, "Conjecture");
  assert(
    inText.hit?.urn === one.urn && inText.count === 1 && inText.hint === "1 match · claim · in text",
    `a word found only in a claim's text selects that claim and the hint says where ("${inText.hint}")`,
  );
  const inPointer = searchNodes(nodes, "ledger item");
  assert(
    inPointer.hit?.urn === one.urn && inPointer.hint === "1 match · claim · in pointer",
    `a pointer is searched too ("${inPointer.hint}")`,
  );
  const both = searchNodes(nodes, "colimit");
  assert(
    both.hit?.urn === tag.urn && both.hint === "2 matches · showing domain_tag",
    `a urn / label match outranks a text-only match ("${both.hint}")`,
  );
  assert(
    JSON.stringify(both.matchUrns) === JSON.stringify([tag.urn, one.urn]),
    `every match is listed, best first — the graph keeps these lit (${both.matchUrns.map(tail)})`,
  );
  assert(
    matchRank(one, "colimit") > matchRank(tag, "colimit") && matchRank(one, "colimit") > 4,
    `the text rank (${matchRank(one, "colimit")}) is below every urn / label rank (0-4)`,
  );
  const miss = searchNodes(nodes, "zzz-not-a-node-anywhere");
  const blank = searchNodes(nodes, "   ");
  assert(
    miss.hit === null && miss.matchUrns.length === 0 && blank.hit === null && blank.matchUrns.length === 0,
    "a miss and a blank query match nothing, so nothing fades",
  );

  // (b) The live fold: the real ranking gives the answers the mirror above asserts ...
  const frame = selectFrame(fold, { healthz: health, request: { view_filter: { types: ["*"] } } });
  const stripOwner = (t) => (t.indexOf(".") > 0 ? t.slice(t.indexOf(".") + 1) : t);
  const prog = frame.nodes.find((n) => n.type_id === "program");
  if (prog) {
    const slug = stripOwner(tail(prog.urn));
    const got = searchNodes(frame.nodes, slug).hit;
    assert(got?.urn === prog.urn, `real ranking: program slug "${slug}" selects the program itself`);
  }
  const sample = frame.nodes[Math.floor(frame.nodes.length / 2)];
  assert(
    searchNodes(frame.nodes, tail(sample.urn)).hit?.urn === sample.urn,
    `real ranking: exact urn tail wins for ${tail(sample.urn)}`,
  );

  // ... and a word that is in a text property but in NO urn and NO label reaches a node
  // carrying it. Before t337 such a word was "no match".
  const haystack = frame.nodes.map((n) => `${n.urn} ${n.label ?? ""}`.toLowerCase()).join("\n");
  let probe = null;
  for (const n of frame.nodes) {
    for (const key of SEARCH_PROPERTIES) {
      const value = n.properties?.[key];
      const word = typeof value === "string"
        ? (value.toLowerCase().match(/[a-z]{7,}/g) ?? []).find((w) => !haystack.includes(w))
        : undefined;
      if (word) probe = probe ?? { word, key };
    }
  }
  if (probe) {
    const found = searchNodes(frame.nodes, probe.word);
    const carries = SEARCH_PROPERTIES.some(
      (key) => typeof found.hit?.properties?.[key] === "string" &&
        found.hit.properties[key].toLowerCase().includes(probe.word),
    );
    assert(
      found.hit && carries && / · in \w+$/.test(found.hint ?? ""),
      `live fold: "${probe.word}" (in no urn, no label) reaches a node whose text carries it ("${found.hint}")`,
    );
  } else {
    console.log("  (no word in this fold sits only inside a text property - live text search skipped)");
  }
}

/**
 * t264 axes against the LIVE fold, through the same selectFrame the adapter uses. The
 * synthetic chain below proves the LAW; this proves the law holds on the real graph — the
 * default slice is a superset of the legacy one, ports actually narrow live relations,
 * hops actually widen a live focus, and the ["*"] sentinel reaches the whole fold.
 * @param {any} fold
 * @param {any} health
 */
function liveAxisChecks(fold, health) {
  console.log("\n=== t264 axes on the LIVE fold (real MCP read) ===");
  const sel = (view_filter) =>
    selectFrame(fold, { healthz: health, request: view_filter ? { view_filter } : undefined });

  // (a) legacy default vs the t264 content lens: the new default must LOSE nothing.
  const legacy = sel(undefined);
  const content = sel({
    types: ["knowledge_item", "derivation", "program", "grammar_fragment", "purpose", "session", "domain_tag"],
    lens: "content",
  });
  const legacyNodes = new Set(legacy.nodes.map((n) => n.urn));
  const contentNodes = new Set(content.nodes.map((n) => n.urn));
  const lostNodes = [...legacyNodes].filter((u) => !contentNodes.has(u));
  const legacyRels = new Set(legacy.relations.map((r) => r.urn));
  const lostRels = [...legacyRels].filter((u) => !new Set(content.relations.map((r) => r.urn)).has(u));
  console.log(`  legacy default ${legacy.nodes.length}n/${legacy.relations.length}r -> content lens ${content.nodes.length}n/${content.relations.length}r`);
  assert(lostNodes.length === 0, `content lens loses no legacy node (lost ${lostNodes.length})`);
  assert(lostRels.length === 0, `content lens loses no legacy relation (lost ${lostRels.length})`);

  // (b) ["*"] reaches the whole permitted fold.
  const all = sel({ types: ["*"] });
  const allTypes = new Set(all.nodes.map((n) => n.type_id));
  assert(
    all.nodes.length > content.nodes.length && allTypes.size > 7,
    `['*'] widens to the whole fold (${all.nodes.length} nodes, ${allTypes.size} types)`,
  );

  // (c) ports narrows LIVE relations, and every survivor carries the asked-for label.
  const liveLabels = [...new Set(all.relations.map((r) => r.label))];
  const probe = liveLabels.includes("member-of") ? "member-of" : liveLabels[0];
  const narrowed = sel({ types: ["*"], ports: [probe] });
  assert(
    narrowed.relations.length > 0 && narrowed.relations.every((r) => r.label === probe),
    `ports ['${probe}'] narrows live relations (${narrowed.relations.length} kept, all '${probe}')`,
  );
  assert(
    narrowed.relations.length < all.relations.length,
    `ports actually narrows (${narrowed.relations.length} < ${all.relations.length})`,
  );

  // (d) every port the drawer offers must be REACHABLE, i.e. the vocabulary closes over
  // the live label set. This is the check that caught `guards` / `participates` missing.
  const VOCAB = new Set([
    "owns", "member-of", "governs", "delegates-to",
    "parent-of", "child-of", "spouse-of", "sibling-of", // T7: WF01 kinship (ontology 4.0.5)
    "opens-on", "has-occupant", "hosts", "routes-to", "spans", "realizes", "presents-as", "participates",
    "provides-kb", "classifies", "pins-urn", "cites", "depends-on", "composes", "produces",
    "causes", "triggers", "has-purpose", "curates", "scheduled-after", "focus", "guards",
    // t337: the WF12 knowledge ports (ontology 4.0.8) — spread from the vocabulary the
    // drawer's "knowledge" group is built from, so this check and the panel cannot disagree.
    ...KB_PORTS,
  ]);
  const unreachable = liveLabels.filter((l) => !VOCAB.has(l));
  assert(
    unreachable.length === 0,
    `every live relation label is in the port vocabulary (unreachable: ${JSON.stringify(unreachable)})`,
  );

  // (e) hops widen a LIVE focus monotonically.
  const manifold = all.nodes.find((n) => n.type_id === "manifold");
  if (manifold) {
    const counts = [1, 2, 3].map(
      (h) => sel({ types: ["*"], scope_urns: [manifold.urn], scope_hops: h }).nodes.length,
    );
    assert(
      counts[0] > 0 && counts[1] >= counts[0] && counts[2] >= counts[1],
      `hops widen the live focus monotonically on ${manifold.urn.split(":").pop()}: ${counts.join(" -> ")}`,
    );
  } else {
    console.log("  (no manifold node in this fold — hops-on-live-focus skipped)");
  }

  // (f) the lens name reaches provenance verbatim (the audit drawer reads it).
  const echoed = sel({ types: ["*"], lens: "everything" });
  assert(echoed.provenance.view_filter.lens === "everything", "provenance echoes the lens verbatim");

  // (g) NO LENS MAY DECLARE A PORT IT CANNOT RENDER.
  //
  // A relation survives only when both endpoints survive, so a lens whose type list omits
  // an intermediate node type silently drops a port its own tooltip advertises. Measured
  // before the relation closure landed: the topology lens rendered `routes-to` 0 of 43
  // times (the fabric is `router -> shard_rule -> kernel`; `shard_rule` is not a topology
  // type), `composes` 0/9, `participates` 0/1; the identity lens rendered `owns` 0 of 17
  // and `presents-as` 0 of 5. Nothing failed — the frame just quietly lacked them.
  //
  // The lens table is PARSED FROM GraphControls.tsx rather than mirrored here. A hand copy
  // is what drifted in `rank()` (see #31) and a guard that copies what it guards proves
  // nothing once the source moves. Ports with zero live relations are skipped, not failed:
  // `delegates-to` and `realizes` are ontology-valid and simply unused in this fold.
  for (const lens of parseLensTable()) {
    const slice = sel({ types: lens.types, ports: lens.ports, lens: lens.id });
    const rendered = new Set(slice.relations.map((r) => r.label));
    const dead = lens.ports.filter(
      (p) => liveLabels.includes(p) && !rendered.has(p),
    );
    assert(
      dead.length === 0,
      `lens '${lens.id}' renders every port it declares and the fold has ` +
        `(${lens.ports.filter((p) => liveLabels.includes(p)).length} live-declared, ` +
        `${slice.nodes.length}n/${slice.relations.length}r${dead.length ? `, DEAD: ${dead.join(", ")}` : ""})`,
    );
  }
}

/**
 * Read the lens presets out of `src/components/GraphControls.tsx`.
 *
 * That file is TypeScript, so it cannot be imported into this plain-.mjs harness (same
 * constraint as `src/ui/node-search.ts`). Parsing the source is still strictly better than
 * restating the table: if a lens gains a port or loses a type, check (g) sees the change
 * on the next run instead of testing a stale duplicate that agrees only with itself.
 */
function parseLensTable() {
  const src = readFileSync(new URL("../src/components/GraphControls.tsx", import.meta.url), "utf8");
  const block = src.match(/export const LENSES: Lens\[\] = \[([\s\S]*?)\n\s*\];/);
  if (!block) throw new Error("live-smoke: could not locate the LENSES table in GraphControls.tsx");
  const list = [];
  // t337: a lens may SPREAD a list from the knowledge vocabulary (`[...KB_PORTS]`) instead
  // of writing string literals. Resolve the spread to the imported list — read as literals
  // only, it parses to [] and check (g) would test "all ports", a different slice than the
  // lens selects. An unknown spread is an error, never a silent [].
  const SPREADS = { KB_PORTS };
  const arrayOf = (body, key) => {
    const m = body.match(new RegExp(`${key}:\\s*\\[([\\s\\S]*?)\\]`));
    if (!m) return [];
    const spread = [...m[1].matchAll(/\.\.\.([A-Za-z_$][\w$]*)/g)].flatMap((x) => {
      if (!SPREADS[x[1]]) throw new Error(`live-smoke: lens '${key}' spreads an unknown list '${x[1]}'`);
      return SPREADS[x[1]];
    });
    return [...[...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]), ...spread];
  };
  for (const m of block[1].matchAll(/id:\s*"([^"]+)"([\s\S]*?)(?=\n\s*id:\s*"|$)/g)) {
    list.push({ id: m[1], types: arrayOf(m[2], "types"), ports: arrayOf(m[2], "ports") });
  }
  if (list.length === 0) throw new Error("live-smoke: parsed zero lenses from GraphControls.tsx");
  return list;
}

/**
 * t264 — the new slice degrees of freedom, on a synthetic 4-node chain:
 *   a --member-of(WF02)--> b --routes-to(WF16)--> c --pins-urn(WF19)--> d
 */
function sliceAxisChecks() {
  console.log("\n=== t264 slice axes (ports · hops · all-types sentinel) ===");
  const nodes = [
    { urn: "urn:moos:user:a", type_id: "user", label: "a", properties: {} },
    { urn: "urn:moos:group:b", type_id: "group", label: "b", properties: {} },
    { urn: "urn:moos:channel:c", type_id: "channel", label: "c", properties: {} },
    { urn: "urn:moos:knowledge_item:d", type_id: "knowledge_item", label: "d", properties: {} },
  ];
  const relations = [
    { urn: "r1", type_id: "WF02", label: "member-of", source_urn: "urn:moos:user:a", target_urn: "urn:moos:group:b" },
    { urn: "r2", type_id: "WF16", label: "routes-to", source_urn: "urn:moos:group:b", target_urn: "urn:moos:channel:c" },
    { urn: "r3", type_id: "WF19", label: "pins-urn", source_urn: "urn:moos:channel:c", target_urn: "urn:moos:knowledge_item:d" },
  ];
  const vf = (over) =>
    resolveViewFilter({ view_filter: { types: ["*"], ...over } }, { t_day: 264 });

  // ["*"] sentinel ⇒ every type survives.
  const all = applyViewFilter(nodes, relations, vf({}), false);
  assert(all.nodes.length === 4 && all.relations.length === 3, "types ['*'] retains all 4 types + 3 relations");

  // Ports filter narrows RELATIONS (nodes stay per types).
  const memberOnly = applyViewFilter(nodes, relations, vf({ ports: ["member-of"] }), false);
  assert(
    memberOnly.relations.length === 1 && memberOnly.relations[0].label === "member-of",
    "ports ['member-of'] keeps exactly the member-of relation",
  );

  // 1 hop from a ⇒ {a,b}; 3 hops ⇒ the whole chain. Expansion walks only visible ports.
  const hop1 = applyViewFilter(nodes, relations, vf({ scope_urns: ["urn:moos:user:a"] }), false);
  assert(hop1.nodes.length === 2, `1 hop from user:a reaches {a,b} (got ${hop1.nodes.length})`);
  const hop3 = applyViewFilter(
    nodes,
    relations,
    vf({ scope_urns: ["urn:moos:user:a"], scope_hops: 3 }),
    false,
  );
  assert(hop3.nodes.length === 4, `3 hops from user:a reach the whole chain (got ${hop3.nodes.length})`);
  const hop3member = applyViewFilter(
    nodes,
    relations,
    vf({ scope_urns: ["urn:moos:user:a"], scope_hops: 3, ports: ["member-of"] }),
    false,
  );
  assert(
    hop3member.nodes.length === 2,
    "hops expand ONLY along retained ports (member-of stops the walk at b)",
  );
  console.log("  ok  t264 slice axes hold");
}

main().catch((err) => {
  console.error(`\nFAIL: ${err instanceof Error ? err.stack || err.message : err}`);
  process.exit(1);
});
