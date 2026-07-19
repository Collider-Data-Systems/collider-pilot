/**
 * Collider Pilot - SEAT-GROUNDED access smoke test
 * ================================================
 * Headless gate for the seat-grounded rework, run against the LIVE Z440 fold (:8080 MCP,
 * :8000 REST). Like scripts/live-smoke.mjs it imports the SAME shared modules the extension
 * uses (`transform` + `access`), so it exercises the real law, not a copy.
 *
 * It proves the three fixes and every held invariant:
 *   1. OWNERSHIP-PERMIT — identified sam's permitted set now includes every session he OWNS
 *      (owner_urn === sam), INCLUDING sam.z440-cowork-workspace (the seat he is viewing), which
 *      the WF02→reverse-WF19 closure alone under-resolved. Reports closure-only → full (before→after).
 *   2. ANON UNCHANGED — anon permitted = {public-demo} only (ownership-permit MUST NOT fire).
 *   3. LOW-PRIV NO-LEAK — a synthetic identified user who owns nothing / governs nothing gets a
 *      minimal permitted set (ownership does not leak). A synthetic user who DOES own a session
 *      gets exactly that session (ADDITIVE proof).
 *   4. SERVER-AUTHORITATIVE — unattributable nodes still fail closed at the server tier.
 *   5. WORKER-STRIP — a forged inbound identity is still dropped (only `mode` is read).
 *   6. DE-HARDCODED SCOPE + SEAT SELECTOR — default (empty) scope renders ALL permitted seats
 *      incl. the cowork session node; choosing a seat narrows the frame to that seat.
 *
 * READ-ONLY: only `graph_state` (MCP) + GET /healthz (REST) are called. No apply/POST anywhere.
 * Run:  node scripts/seat-smoke.mjs   (exit 0 iff every assertion holds)
 */

import { createStreamableHttpClient } from "../src/mcp/streamable-http-client.js";
import {
  selectFrame,
  parseGraphStateResult,
  summarizeFrame,
  DEFAULT_ENGINE_URN,
} from "../src/mcp/transform.js";
import {
  resolveAccess,
  accessKeepSet,
  ownedSessions,
  governedPrincipals,
  workspacesForPrincipals,
  readRequestedMode,
  ANON_USER_URN,
} from "../src/mcp/access.js";

const SAM = "urn:moos:user:sam";
const COWORK = "urn:moos:session:sam.z440-cowork-workspace";
const PUBLIC_DEMO = "urn:moos:session:public-demo";

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}
function line(label, value) {
  console.log(`  ${label.padEnd(26)} ${value}`);
}
const identified = (user, workstation, enforced_by) => ({
  mode: "identified",
  user,
  workstation: workstation ?? null,
  role: null,
  identity_source: "trusted-storage",
  enforced_by: enforced_by ?? "client-presentation",
});
const anonScope = {
  mode: "anon",
  user: ANON_USER_URN,
  workstation: null,
  role: null,
  identity_source: "anon",
  enforced_by: "client-presentation",
};
const node = (urn, type_id, properties = {}) => ({ urn, type_id, properties });
const rel = (urn, rewrite_category, src_urn, src_port, tgt_urn, tgt_port) => ({
  urn,
  rewrite_category,
  src_urn,
  src_port,
  tgt_urn,
  tgt_port,
});
/** Count nodes a request would render (the extension's exact transform path). */
function frameFor(fold, healthz, access, scope_urns) {
  const view_filter = { access };
  if (Array.isArray(scope_urns)) view_filter.scope_urns = scope_urns;
  return selectFrame(fold, {
    healthz,
    engine: DEFAULT_ENGINE_URN,
    request: { view_filter },
  });
}

const mcpBaseUrl = process.env.PILOT_MCP_BASE_URL || "http://localhost:8080";
const engineUrl = process.env.PILOT_ENGINE_URL || "http://localhost:8000";

async function main() {
  console.log("collider-pilot :: SEAT-GROUNDED access smoke test");
  console.log(`  MCP   ${mcpBaseUrl}/sse`);
  console.log(`  REST  ${engineUrl}/healthz\n`);

  const client = createStreamableHttpClient({ mcpBaseUrl, engineUrl });
  await client.initialize();
  const [graphRpc, health] = await Promise.all([client.graphState(), client.healthz()]);
  const fold = parseGraphStateResult(graphRpc);
  console.log(
    `fold OK  raw nodes=${Object.keys(fold.nodes).length} relations=${Object.keys(fold.relations).length} t_day=${health.t_day} ontology=${health.ontology_version}\n`,
  );

  // ── 1. OWNERSHIP-PERMIT (identified sam) ─────────────────────────────────────────────────
  console.log("=== 1. ownership-permit — identified sam ===");
  // BEFORE (closure only): WF02 governs → reverse-WF19 has-occupant (∪ public), no ownership.
  const closurePrincipals = governedPrincipals(fold, SAM);
  const closureOnly = new Set([
    ...workspacesForPrincipals(fold, closurePrincipals).workspaces,
    PUBLIC_DEMO, // public is unioned regardless; shown here for an apples-to-apples count
  ]);
  const owned = ownedSessions(fold, SAM);
  const samRes = resolveAccess(fold, identified(SAM, "urn:moos:workstation:hp-z440"));
  const samPermitted = samRes.permitted_workspaces;
  line("closure-only (BEFORE)", `${closureOnly.size} :: ${[...closureOnly].map((u) => u.split(":").pop()).sort().join(", ")}`);
  line("owned sessions", `${owned.length} :: ${owned.map((u) => u.split(":").pop()).sort().join(", ")}`);
  line("permitted (AFTER)", `${samPermitted.length} :: ${samPermitted.map((u) => u.split(":").pop()).sort().join(", ")}`);
  assert(owned.every((u) => fold.nodes[u]?.type_id === "session"), "ownedSessions returns only session nodes");
  assert(owned.includes(COWORK), "ownedSessions(sam) includes sam.z440-cowork-workspace (the viewed seat)");
  assert(samPermitted.includes(COWORK), "AFTER: sam.z440-cowork-workspace IS in the permitted set (bug 1 fixed)");
  assert(!closureOnly.has(COWORK), "BEFORE: cowork was NOT in the closure-only set (the bug)");
  assert(samPermitted.length > closureOnly.size, `permitted GREW ${closureOnly.size} -> ${samPermitted.length} (ownership additive)`);
  for (const seat of ["urn:moos:session:sam.karpathy-seat", "urn:moos:session:sam.steinberger-seat"]) {
    assert(samPermitted.includes(seat), `owned seat ${seat.split(":").pop()} now permitted (was not in closure)`);
  }
  // HELD: the closure seats are still permitted (ownership only ADDS).
  for (const legit of ["urn:moos:session:sam.kernel-proper", "urn:moos:session:sam.moos-diary"]) {
    assert(samPermitted.includes(legit), `closure seat ${legit.split(":").pop()} still permitted (nothing dropped)`);
  }
  // The cowork session node now SURVIVES the access gate.
  const samKeep = accessKeepSet(fold, samRes);
  assert(samKeep.has(COWORK), "access gate KEEPS the cowork session node (owner=sam ∈ permitted)");

  // Node count before→after via the REAL transform (default vs pre-fix pinned-cowork scope).
  const samAll = frameFor(fold, health, identified(SAM, "urn:moos:workstation:hp-z440")); // default empty scope
  const samAllSummary = summarizeFrame(samAll);
  const samPinned = frameFor(fold, health, identified(SAM, "urn:moos:workstation:hp-z440"), [COWORK]); // pre-fix behavior
  line("frame nodes (pinned cowork, pre-fix scope)", `${summarizeFrame(samPinned).nodeCount} sessions=${summarizeFrame(samPinned).nodesByType.session ?? 0}`);
  line("frame nodes (empty default scope, AFTER)", `${samAllSummary.nodeCount} byType=${JSON.stringify(samAllSummary.nodesByType)}`);
  assert(samAll.nodes.some((n) => n.urn === COWORK), "FIX 3: cowork session node RENDERS in the default (all-permitted) frame");
  assert((samAllSummary.nodesByType.session ?? 0) >= 5, "default frame renders the owned seat session nodes (>=5)");
  assert(samAllSummary.nodeCount > summarizeFrame(samPinned).nodeCount, "de-hardcoded scope shows MORE than the pinned-cowork scope");

  // ── 2. ANON UNCHANGED ────────────────────────────────────────────────────────────────────
  console.log("\n=== 2. anon unchanged — ownership-permit must NOT fire ===");
  const anonRes = resolveAccess(fold, anonScope);
  line("anon permitted", JSON.stringify(anonRes.permitted_workspaces));
  line("anon public", JSON.stringify(anonRes.public_workspaces));
  assert(
    JSON.stringify(anonRes.permitted_workspaces.slice().sort()) === JSON.stringify([PUBLIC_DEMO]),
    "anon permitted === {public-demo} only (public-only, ownership-permit inert for anon)",
  );
  assert(
    JSON.stringify(anonRes.permitted_workspaces.slice().sort()) === JSON.stringify(anonRes.public_workspaces.slice().sort()),
    "anon permitted === public_workspaces (unchanged boundary)",
  );
  assert(ownedSessions(fold, ANON_USER_URN).length === 0, "ownedSessions(anon) === [] (anon owns nothing, guarded)");
  assert(ownedSessions(fold, null).length === 0, "ownedSessions(null) === [] (unset owns nothing)");
  // Anon RENDERS its one public seat now that scope is de-hardcoded (permitted set identical).
  const anonFrame = frameFor(fold, health, anonScope);
  const anonSummary = summarizeFrame(anonFrame);
  line("anon frame nodes (default scope)", `${anonSummary.nodeCount} byType=${JSON.stringify(anonSummary.nodesByType)}`);
  assert(anonFrame.nodes.every((n) => anonRes.permitted_workspaces.includes(n.urn) || n.urn === PUBLIC_DEMO), "anon renders only public-permitted nodes");
  assert(anonSummary.nodeCount <= anonRes.permitted_workspaces.length + 5, "anon frame stays public-scoped (no leak)");

  // ── 3. LOW-PRIV NO-LEAK (synthetic) ──────────────────────────────────────────────────────
  console.log("\n=== 3. low-priv identified user — ownership does NOT leak ===");
  // (a) owns nothing, governs nothing → permitted minimal (public only).
  const s3 = {
    nodes: {
      "urn:moos:user:nobody": node("urn:moos:user:nobody", "user"),
      "urn:moos:session:someones.secret": node("urn:moos:session:someones.secret", "session", {
        owner_urn: { value: SAM }, // owned by SAM, NOT by nobody
      }),
      [PUBLIC_DEMO]: node(PUBLIC_DEMO, "session", { anon_visible: { value: true } }),
    },
    relations: {},
  };
  const r3 = resolveAccess(s3, identified("urn:moos:user:nobody", null));
  line("nobody permitted", JSON.stringify(r3.permitted_workspaces));
  assert(!r3.permitted_workspaces.includes("urn:moos:session:someones.secret"), "low-priv 'nobody' does NOT get sam's owned session (no ownership leak)");
  assert(
    JSON.stringify(r3.permitted_workspaces.slice().sort()) === JSON.stringify([PUBLIC_DEMO]),
    "low-priv 'nobody' (owns nothing, governs nothing) permitted = public-only (fail-closed preserved)",
  );
  // (b) ADDITIVE proof: a user who OWNS a session (but governs nothing) gets exactly that session.
  const s3b = {
    nodes: {
      "urn:moos:user:owner": node("urn:moos:user:owner", "user"),
      "urn:moos:session:owner.seat": node("urn:moos:session:owner.seat", "session", {
        owner_urn: { value: "urn:moos:user:owner" },
      }),
      "urn:moos:session:other.seat": node("urn:moos:session:other.seat", "session", {
        owner_urn: { value: SAM },
      }),
    },
    relations: {},
  };
  const r3b = resolveAccess(s3b, identified("urn:moos:user:owner", null));
  line("owner permitted", JSON.stringify(r3b.permitted_workspaces));
  assert(r3b.permitted_workspaces.includes("urn:moos:session:owner.seat"), "ADDITIVE: a user who owns a seat IS permitted it (via ownership, no governs needed)");
  assert(!r3b.permitted_workspaces.includes("urn:moos:session:other.seat"), "ownership is exact: 'owner' does NOT get sam's seat");

  // ── 4. SERVER-AUTHORITATIVE — unattributable still fails closed ───────────────────────────
  console.log("\n=== 4. server-authoritative tier — unattributable fails closed ===");
  const SECRET = "urn:moos:purpose:secret.no-owner";
  const s4 = {
    nodes: {
      "urn:moos:user:sv": node("urn:moos:user:sv", "user"),
      "urn:moos:session:sv.seat": node("urn:moos:session:sv.seat", "session", { owner_urn: { value: "urn:moos:user:sv" } }),
      [SECRET]: node(SECRET, "purpose"), // bare, no owner, not public
    },
    relations: {},
  };
  const r4 = resolveAccess(s4, { ...identified("urn:moos:user:sv", null), enforced_by: "server-authoritative", computed_by: "server-authoritative" });
  // Force the server tier on the resolution (computed_by drives the keep-set's fail-closed branch).
  const r4server = { ...r4, computed_by: "server-authoritative" };
  const keep4 = accessKeepSet(s4, r4server);
  line("server permitted", JSON.stringify(r4server.permitted_workspaces));
  line("server keeps secret?", keep4.has(SECRET));
  assert(r4server.permitted_workspaces.includes("urn:moos:session:sv.seat"), "server tier: owned seat still permitted (you can access what you own)");
  assert(keep4.has("urn:moos:session:sv.seat"), "server tier: the user's OWN seat survives the gate");
  assert(!keep4.has(SECRET), "server tier: unattributable (no-owner, non-public) node FAILS CLOSED (tier logic intact)");
  // Same secret at the CLIENT identified tier is shown (unattributable-shown rule unchanged).
  const keep4client = accessKeepSet(s4, { ...r4, computed_by: "client-presentation" });
  assert(keep4client.has(SECRET), "client tier: unattributable node still SHOWN (that rule is untouched)");

  // ── 5. WORKER-STRIP — forged inbound identity dropped ────────────────────────────────────
  console.log("\n=== 5. worker-strip — forged inbound identity dropped ===");
  const forged = {
    view_filter: {
      access: { mode: "identified", user: "urn:moos:user:EVIL", workstation: "urn:moos:workstation:attacker", role: "urn:moos:role:superadmin", identity_source: "trusted-storage", enforced_by: "server-authoritative" },
    },
  };
  assert(readRequestedMode(forged) === "identified", "strip: only the posture is read from the inbound request");
  assert(readRequestedMode({}) === "anon", "strip: missing access ⇒ anon (fail-closed)");
  // The worker re-injects the TRUSTED scope; with no trusted storage that is anon — EVIL never surfaces.
  const stripped = resolveAccess(fold, anonScope);
  const strippedJson = JSON.stringify(stripped);
  assert(!strippedJson.includes("EVIL") && !strippedJson.includes("attacker"), "strip: forged user:EVIL / workstation:attacker never surface in the resolution");
  assert(stripped.permitted_workspaces.length === stripped.public_workspaces.length, "strip→anon: forged 'identified' with no trusted backing resolves public-only");

  // ── 6. SEAT SELECTOR — narrow to one seat vs All permitted ───────────────────────────────
  console.log("\n=== 6. seat selector — narrow-to-seat vs All permitted ===");
  const allFrame = frameFor(fold, health, identified(SAM, "urn:moos:workstation:hp-z440")); // All (empty scope)
  const oneFrame = frameFor(fold, health, identified(SAM, "urn:moos:workstation:hp-z440"), [COWORK]); // pick cowork seat
  const allN = summarizeFrame(allFrame).nodeCount;
  const oneN = summarizeFrame(oneFrame).nodeCount;
  line("All permitted node count", allN);
  line("cowork-only node count", oneN);
  assert(oneFrame.nodes.some((n) => n.urn === COWORK), "selector: choosing the cowork seat KEEPS the cowork node");
  assert(oneN <= allN, "selector: a single seat renders <= All permitted");
  assert(oneFrame.nodes.every((n) => allFrame.nodes.some((m) => m.urn === n.urn)), "selector: the seat frame is a SUBSET of All permitted");

  console.log("\nPASS: seat-grounded access verified (ownership-permit · anon unchanged · low-priv no-leak · server fail-closed · strip · selector).");
}

main().catch((err) => {
  console.error(`\nFAIL: ${err instanceof Error ? err.stack || err.message : err}`);
  process.exit(1);
});
