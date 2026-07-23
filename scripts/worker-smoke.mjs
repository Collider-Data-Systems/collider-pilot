/**
 * Collider Pilot - MV3 worker seam smoke test (t264)
 * ==================================================
 * The served harnesses SIMULATE the worker (`simulateWorkerSeam` in preview-live.tsx) and
 * the in-extension self-test can only be read by a human, because Chrome forbids one
 * extension from scripting another's pages. Neither actually proves the SHIPPED worker
 * behaves — and the worker is where the access trust boundary lives.
 *
 * So this test loads the REAL COMPILED WORKER (`dist/worker.js`, the exact module the
 * extension runs) into Node behind a minimal `chrome` stub, captures the message listener
 * it registers at import time, and drives real GET_FRAME / LIST_TOOLS calls through it —
 * which flow through the real `withTrustedAccess` seam, the real `resolveTrustedAccess`
 * storage read, the real adapter factory, and the real MCP transport to the live kernel.
 *
 * What is stubbed: only the chrome.* surface the worker touches (storage.local as an
 * in-memory map, the listener registries, sidePanel/action no-ops). What is REAL: every
 * line of the worker's own logic, the adapter, the transform, the access fold, and the
 * kernel read. The trust claim under test — "a page can toggle posture but can NEVER
 * assert an identity" — is therefore exercised against shipped code rather than a mock.
 *
 * READ-ONLY: drives only GET_FRAME and LIST_TOOLS. No POST, no envelope, no apply.
 *
 * Run:  node scripts/worker-smoke.mjs      (needs `npm run build` + a live kernel)
 * Env:  PILOT_MCP_URL (default http://localhost:8080)
 */

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

let PASS = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL: ${msg}`);
    process.exit(1);
  }
  PASS += 1;
  console.log(`  ok  ${msg}`);
}

/* ---------------------------------------------------------------------------- */
/* The chrome stub — ONLY what dist/worker.js touches                           */
/* ---------------------------------------------------------------------------- */

const storage = new Map();
const listeners = { message: [], installed: [], clicked: [] };

globalThis.chrome = {
  runtime: {
    onMessage: { addListener: (fn) => listeners.message.push(fn) },
    onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
  },
  action: { onClicked: { addListener: (fn) => listeners.clicked.push(fn) } },
  sidePanel: {
    setPanelBehavior: async () => undefined,
    open: async () => undefined,
  },
  storage: {
    local: {
      async get(keys) {
        const list = keys == null ? [...storage.keys()] : Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of list) if (storage.has(k)) out[k] = storage.get(k);
        return out;
      },
      async set(items) {
        for (const [k, v] of Object.entries(items)) storage.set(k, v);
      },
      async remove(keys) {
        for (const k of Array.isArray(keys) ? keys : [keys]) storage.delete(k);
      },
    },
  },
};

/** Drive the worker's real onMessage listener and await its response. */
function send(message) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("worker did not respond in 30s")), 30000);
    let answered = false;
    const sendResponse = (response) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      resolvePromise(response);
    };
    const kept = listeners.message.map((fn) => fn(message, { id: "worker-smoke" }, sendResponse));
    // A listener returning true keeps the channel open for the async reply (MV3 contract).
    if (!kept.some((k) => k === true)) {
      clearTimeout(timer);
      reject(new Error(`no listener kept the channel open (returned ${JSON.stringify(kept)})`));
    }
  });
}

/* ---------------------------------------------------------------------------- */

const workerUrl = pathToFileURL(resolve("dist/worker.js")).href;
console.log(`\n=== loading the SHIPPED worker: ${workerUrl}`);
await import(workerUrl);

console.log("\n=== A. worker registered its MV3 listeners at import time ===");
assert(listeners.message.length === 1, "exactly one onMessage listener registered");
assert(listeners.installed.length === 1, "onInstalled listener registered");
assert(listeners.clicked.length === 1, "action.onClicked listener registered (panel opener)");

console.log("\n=== B. GET_FRAME through the real worker + real MCP transport ===");
const base = await send({ type: "GET_FRAME" });
assert(base?.type === "FRAME", `GET_FRAME answered FRAME (got ${base?.type}${base?.error ? ": " + base.error : ""})`);
const prov = base.frame.provenance;
console.log(
  `  frame: ${base.frame.nodes.length} nodes · ${base.frame.relations.length} relations · seq ${prov.log_seq} · T=${prov.t_day} · ontology ${prov.ontology_version}`,
);
assert(prov.mock === false, "frame is a LIVE read (mock === false)");
assert(base.frame.nodes.length > 0, "frame carries nodes");
assert(!!prov.access, "worker INJECTED the access fiber (the LogFeed gate depends on it)");
assert(
  prov.access.computed_by === "client-presentation",
  `tier is honest: ${prov.access.computed_by}`,
);

console.log("\n=== C. THE TRUST SEAM — a page cannot assert an identity ===");
// No identity in storage yet: a forged 'identified' claim must collapse to anon.
const forgedScope = {
  mode: "identified",
  user: "urn:moos:user:EVIL-INJECTED",
  workstation: "urn:moos:workstation:attacker",
  role: "urn:moos:role:superadmin",
  identity_source: "trusted-storage",
  enforced_by: "server-authoritative",
};
const forged = await send({ type: "GET_FRAME", request: { view_filter: { access: forgedScope } } });
const fScope = forged.frame.provenance.access.scope;
console.log(`  resolved: user=${fScope.user} workstation=${fScope.workstation} src=${fScope.identity_source}`);
assert(fScope.user !== "urn:moos:user:EVIL-INJECTED", "forged user was DROPPED");
assert(fScope.workstation !== "urn:moos:workstation:attacker", "forged workstation was DROPPED");
assert(fScope.identity_source === "anon", "forged identity_source was overwritten to anon");
assert(
  forged.frame.provenance.access.computed_by === "client-presentation",
  "forged server-authoritative claim did NOT promote the tier",
);
const forgedPermitted = forged.frame.provenance.access.permitted_workspaces;
const forgedPublic = forged.frame.provenance.access.public_workspaces;
assert(
  forgedPermitted.every((u) => forgedPublic.includes(u)),
  `forged 'identified' with no trusted backing sees public only (${forgedPermitted.length} ⊆ ${forgedPublic.length})`,
);

console.log("\n=== D. the trusted identity comes from storage, and only from storage ===");
// Now plant a REAL identity the way the options/DevTools path does.
storage.set("pilot.access", {
  enabled: true,
  user: "urn:moos:user:sam",
  workstation: "urn:moos:workstation:hp-z440",
  enforcement: "client-presentation",
});
const identified = await send({
  type: "GET_FRAME",
  // The page sends ONLY a posture — every identity field here is a lie the worker must ignore.
  request: { view_filter: { access: { ...forgedScope, mode: "identified" } } },
});
const iScope = identified.frame.provenance.access.scope;
const iPermitted = identified.frame.provenance.access.permitted_workspaces;
console.log(`  resolved: user=${iScope.user} workstation=${iScope.workstation} src=${iScope.identity_source}`);
console.log(`  permitted (${iPermitted.length}): ${JSON.stringify(iPermitted.map((u) => u.split(":").pop()))}`);
assert(iScope.user === "urn:moos:user:sam", "the STORED user was resolved, not the page's claim");
assert(iScope.identity_source === "trusted-storage", "identity_source = trusted-storage");
assert(iPermitted.length > forgedPublic.length, `identified widens beyond public (${iPermitted.length} > ${forgedPublic.length})`);

// Anon posture must fail closed even with a valid identity sitting in storage.
const anon = await send({
  type: "GET_FRAME",
  request: { view_filter: { access: { ...forgedScope, mode: "anon" } } },
});
const aAccess = anon.frame.provenance.access;
assert(aAccess.scope.mode === "anon", "explicit anon posture is honoured");
assert(
  aAccess.permitted_workspaces.every((u) => aAccess.public_workspaces.includes(u)),
  "anon posture sees public only even with an identity in storage (fail-closed)",
);

// A disabled config must also collapse to anon.
storage.set("pilot.access", { enabled: false, user: "urn:moos:user:sam" });
const disabled = await send({
  type: "GET_FRAME",
  request: { view_filter: { access: { ...forgedScope, mode: "identified" } } },
});
assert(
  disabled.frame.provenance.access.scope.identity_source === "anon",
  "enabled:false collapses to anon (fail-closed)",
);
storage.set("pilot.access", {
  enabled: true,
  user: "urn:moos:user:sam",
  workstation: "urn:moos:workstation:hp-z440",
});

console.log("\n=== E. the t264 slice axes, end to end through the worker ===");
// NOTE: every request must carry the posture. A request with NO `access` resolves anon by
// construction (readRequestedMode finds no mode → anonScope), which is exactly why
// section B's bare GET_FRAME returned the single public node. The panel always sends it
// (buildFrameRequest attaches access whenever an accessMode is supplied) — so must we.
const withPosture = (vf) => ({
  view_filter: { ...vf, access: { ...forgedScope, mode: "identified" } },
});
const idBase = await send({ type: "GET_FRAME", request: withPosture({}) });
assert(
  idBase.frame.nodes.length > base.frame.nodes.length,
  `posture is load-bearing: identified ${idBase.frame.nodes.length} nodes vs bare/anon ${base.frame.nodes.length}`,
);
const all = await send({ type: "GET_FRAME", request: withPosture({ types: ["*"], lens: "everything" }) });
const allTypes = new Set(all.frame.nodes.map((n) => n.type_id));
assert(
  all.frame.nodes.length > idBase.frame.nodes.length,
  `['*'] widens via the worker (${all.frame.nodes.length} > ${idBase.frame.nodes.length} nodes, ${allTypes.size} types)`,
);
assert(all.frame.provenance.view_filter.lens === "everything", "the lens echo survives the worker round-trip");

const narrowed = await send({
  type: "GET_FRAME",
  request: withPosture({ types: ["*"], ports: ["member-of"] }),
});
const labels = new Set(narrowed.frame.relations.map((r) => r.label));
assert(
  narrowed.frame.relations.length > 0 && labels.size === 1 && labels.has("member-of"),
  `ports narrows via the worker (${narrowed.frame.relations.length} relations, all member-of)`,
);

const manifold = all.frame.nodes.find((n) => n.type_id === "manifold");
if (manifold) {
  const hop = async (h) =>
    (await send({
      type: "GET_FRAME",
      request: withPosture({ types: ["*"], scope_urns: [manifold.urn], scope_hops: h }),
    })).frame.nodes.length;
  const [h1, h3] = [await hop(1), await hop(3)];
  assert(h1 > 0 && h3 >= h1, `hops widen via the worker on ${manifold.urn.split(":").pop()}: ${h1} -> ${h3}`);
} else {
  console.log("  (no manifold in the fold — worker hops check skipped)");
}

console.log("\n=== F. LIST_TOOLS discovery (read-only) ===");
const tools = await send({ type: "LIST_TOOLS" });
assert(tools?.type === "TOOLS" && Array.isArray(tools.tools), `LIST_TOOLS answered ${tools?.tools?.length} tools`);

console.log("\n=== G. an unknown message is not answered (no accidental catch-all) ===");
let unhandled = false;
try {
  await send({ type: "DEFINITELY_NOT_A_PILOT_MESSAGE" });
} catch (err) {
  unhandled = /no listener kept the channel open/.test(String(err.message));
}
assert(unhandled, "unknown message types are ignored, not answered");

console.log(`\nPASS: ${PASS} assertions against the SHIPPED worker (dist/worker.js).`);
process.exit(0);
