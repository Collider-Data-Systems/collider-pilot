/**
 * Collider Pilot - the access law (A3 hybrid-staged, SHARED, pure)
 * ===============================================================
 * `permitted_workspaces = f(group_topology × user × workstation)` — computed ONCE over the
 * FULL raw fold `graph_state` returns, BEFORE `applyViewFilter` narrows types/scope. Pure
 * data-in/data-out (no network, no DOM, no chrome.*), authored in JS+JSDoc like
 * transform.js so Node imports it directly and `scripts/live-smoke.mjs` exercises the REAL
 * law, not a copy. READ-ONLY: nothing here emits or references a rewrite.
 *
 * THE GO-PORT ANTI-DRIFT ANCHOR (§8 of the design note)
 * -----------------------------------------------------
 * The A2 server-tier drop-in is a PORT of THIS function into
 * `moos-kernel/internal/operad/access.go`. The two implementations stay definitionally
 * identical only while this spec drives both. The law, verbatim:
 *
 *   (1) group_topology = WF02 closure over `governs` ∪ `delegates-to` ∪ `member-of`. BFS from
 *       `user_urn` over relations with rewrite_category==="WF02" (src→tgt), following
 *       role→role `delegates-to` delegates and principal→group `member-of` (4.0.4:
 *       user|agent|group → group, member→group direction ONLY — monotone widening; a member
 *       inherits the group's grant-closure); include `user_urn` itself. If `role` is pinned,
 *       seed the closure from that role instead of (in addition to) the user.
 *   (2) principals → workspaces = REVERSE WF19 `has-occupant`. Live-fold orientation is
 *       session --[WF19 has-occupant]--> agent (a workspace HAS an occupant), so the reverse
 *       walk is: collect the SRC (session/workspace) of every has-occupant relation whose
 *       TGT ∈ principals. Union over principals.
 *       [CONJ] FALLBACK where WF19 has-occupant relations are absent: scan `session` nodes
 *       whose properties.occupant ∈ principals. RECORD which path was used (workspace_path).
 *   (3) workstation ∩ (placement fiber). WorkspacesOnWorkstation = sessions bound to the
 *       workstation via the design's named engine→workstation relation D7 `realizes` (or a
 *       direct session `opens-on` a workstation); intersect. [CONJ] when those relations are
 *       absent, SKIP (widened) and set intersection_applied=false. In ontology 4.0.2 the
 *       named `realizes` relation does NOT exist (engine↔workstation is a WF03 `hosts`
 *       two-hop instead) and a plain `workstation=` is a CLAIM, not proof (§8) — so at the
 *       client-presentation tier the workstation ∩ is SKIPPED and deferred to the
 *       server-authoritative tier where the workstation is cert-bound.
 *   (4) public union (SEE ANON below): public_workspaces = nodes with
 *       properties.visibility==="public" || properties.anon_visible===true, UNIONED with the
 *       client-side PUBLIC_WORKSPACE_DEFAULTS. Bring-in unions it in; anon returns ONLY it.
 *
 *   (2b) SEAT-OWNERSHIP PERMIT (ADDITIVE, seat-grounded). The frame's placement is a SEAT —
 *       persona × agent × workspace(session) × engine × surface — and every `session` node
 *       records its owner in `owner_urn`. An IDENTIFIED principal is ALSO permitted every
 *       session it OWNS OUTRIGHT (`owner_urn === scope.user`), INDEPENDENT of the (2)
 *       governs→reverse-WF19 closure. So permitted = (governs-occupant closure) ∪ (sessions the
 *       user owns) ∪ public. This is why Sam (who owns all his seats, incl. the workspace he is
 *       viewing) sees them all, where the closure alone under-resolved to a 2-seat fragment.
 *       FAIL-CLOSED PRESERVED: it is keyed on `owner_urn === scope.user` and NEVER fires for
 *       anon (anon returns before this step, and the helper guards `user===anon`) nor for a
 *       low-priv identified user who owns nothing (empty set) — it only ever ADDS literally-owned
 *       sessions, never widens. At the server-authoritative tier the owned sessions ride inside
 *       `permitted` and are subject to the SAME workstation ∩ / fail-closed drop as everything else.
 *
 * `owningWorkspaces(fold, urn)` (owner attribution): a session is its own workspace; else the
 * SET of owning sessions found by walking the WF12 `provides-kb`/`kb-source` lineage in the
 * provider→item direction ONLY (session --provides-kb--> item), unioned with its WF19
 * `has-occupant` lineage; unattributable ⇒ [] (empty set). Multi-owner is FAIL-CLOSED: the
 * gate keeps a node only if EVERY owning workspace is permitted (an item owned by a
 * non-permitted session but merely cited by a permitted one is HIDDEN — no insertion-order
 * over-exposure). The gate treats an unattributable (empty-owner) node as HIDDEN for EVERYONE
 * (fail-closed) unless it is explicitly public. A legit user's real workspaces are
 * attributable, so this never under-hides them; anon likewise sees ONLY explicitly-public
 * nodes. NOTE: ownership here is a heuristic (WF12 lineage direction) — DEBT until ownership
 * is a first-class folded relation; the fail-closed multi-owner rule bounds the blast radius.
 *
 * THE ANONYMOUS USER (Sam's explicit requirement): `urn:moos:user:anon` is a first-class
 * principal. Anon mode ⇒ permitted = public_workspaces, and the anon principal appears in
 * provenance (scope.user = urn:moos:user:anon) so anon is a VISIBLE participant, never a
 * silent empty.
 *
 * @typedef {import("./types").AccessScope} AccessScope
 * @typedef {import("./types").AccessResolution} AccessResolution
 * @typedef {import("./types").AccessMode} AccessMode
 */

/** The anonymous user, modeled as a first-class principal (Sam's requirement). */
export const ANON_USER_URN = "urn:moos:user:anon";

/**
 * PRESENTATION-TIER, Sam-editable, NOT authoritative.
 * ---------------------------------------------------
 * A small client-side default list of workspace urns exposed to the anonymous user, UNIONED
 * with any HG node carrying `visibility:"public"` / `anon_visible:true`. This is a
 * presentation-tier convenience ONLY — it is NOT a security boundary and NOT folded from the
 * log. Seeded EMPTY: no workspace in the current fold is confirmed genuinely-safe to show
 * publicly (none carry a visibility/anon_visible property), so anon relies on the explicit
 * empty-state rather than leaking a workspace by client-side default. To make a workspace
 * anon-native/authoritative, apply the staged program `hg-programs/anon-user-visibility.staged.json`
 * (Sam-gated) — do NOT hardcode confidential workspaces here.
 *
 * >>> add public workspace urns here (presentation-tier only) <<<
 * @type {string[]}
 */
export const PUBLIC_WORKSPACE_DEFAULTS = [];

/** Iterate the values of a fold map that may be a Record OR an array (both supported). */
function values(mapOrArray) {
  if (!mapOrArray) return [];
  return Array.isArray(mapOrArray) ? mapOrArray : Object.values(mapOrArray);
}

/** All raw nodes as an array (Record or array fold). @returns {any[]} */
function foldNodes(fold) {
  return values(fold && fold.nodes);
}
/** All raw relations as an array (Record or array fold). @returns {any[]} */
function foldRelations(fold) {
  return values(fold && fold.relations);
}
/** Index raw nodes by urn. @returns {Map<string, any>} */
function nodeIndex(fold) {
  /** @type {Map<string, any>} */
  const m = new Map();
  for (const n of foldNodes(fold)) if (n && n.urn) m.set(n.urn, n);
  return m;
}

/**
 * Read a node property whether the fold wraps it (`{value,...}`, raw graph_state) or has
 * already flattened it (`value`, post-transform). Returns the scalar, or undefined.
 * @param {any} node
 * @param {string} key
 */
function rawProp(node, key) {
  const bag = node && node.properties ? node.properties[key] : undefined;
  if (bag && typeof bag === "object" && "value" in bag) return bag.value;
  return bag;
}

/**
 * Is this node explicitly public? (`visibility:"public"` OR `anon_visible:true`, OR its urn
 * is in the presentation-tier PUBLIC_WORKSPACE_DEFAULTS).
 * @param {any} node
 * @returns {boolean}
 */
export function isPublicWorkspace(node) {
  if (!node) return false;
  if (rawProp(node, "visibility") === "public") return true;
  if (rawProp(node, "anon_visible") === true) return true;
  if (node.urn && PUBLIC_WORKSPACE_DEFAULTS.includes(node.urn)) return true;
  return false;
}

/**
 * The anon-visible public workspace set: HG-public nodes ∪ PUBLIC_WORKSPACE_DEFAULTS.
 * @param {any} fold
 * @returns {string[]}
 */
export function publicWorkspaces(fold) {
  const out = new Set(PUBLIC_WORKSPACE_DEFAULTS);
  for (const n of foldNodes(fold)) {
    if (n && n.urn && isPublicWorkspace(n)) out.add(n.urn);
  }
  return [...out];
}

/**
 * (1) group_topology = WF02 transitive closure over `governs` ∪ `delegates-to` ∪ `member-of`
 * from a seed principal. Includes the seed. Same governs spine the kernel folds for
 * §M11/§M12 write-gating, generalized to the full reachable principal set; `member-of`
 * (ontology 4.0.4) is followed in the member→group direction ONLY, so membership widens
 * monotonically (a member inherits the group's grant-closure, never the reverse).
 * @param {any} fold
 * @param {string} seedUrn - user_urn (or a pinned role urn)
 * @returns {string[]} reachable principals (agents/roles/groups/user), incl. the seed
 */
export function governedPrincipals(fold, seedUrn) {
  const rels = foldRelations(fold);
  /** @type {Set<string>} */
  const seen = new Set();
  if (!seedUrn) return [];
  const queue = [seedUrn];
  seen.add(seedUrn);
  while (queue.length) {
    const cur = /** @type {string} */ (queue.shift());
    for (const r of rels) {
      if (!r) continue;
      const isGoverns = r.rewrite_category === "WF02" && r.src_port === "governs";
      const isDelegates = r.rewrite_category === "WF02" && r.src_port === "delegates-to";
      const isMemberOf = r.rewrite_category === "WF02" && r.src_port === "member-of";
      if ((isGoverns || isDelegates || isMemberOf) && r.src_urn === cur && r.tgt_urn && !seen.has(r.tgt_urn)) {
        seen.add(r.tgt_urn);
        queue.push(r.tgt_urn);
      }
    }
  }
  return [...seen];
}

/**
 * (2) principals → workspaces = REVERSE WF19 `has-occupant` (session --has-occupant--> agent;
 * collect the session SRC whose occupant TGT ∈ principals). [CONJ] fallback: when no
 * has-occupant relations resolve, scan `session` nodes whose properties.occupant ∈ principals.
 * @param {any} fold
 * @param {string[]} principals
 * @returns {{ workspaces: string[], path: "wf19-has-occupant" | "occupant-property" | "none" }}
 */
export function workspacesForPrincipals(fold, principals) {
  const pset = new Set(principals);
  /** @type {Set<string>} */
  const ws = new Set();
  for (const r of foldRelations(fold)) {
    if (r && r.rewrite_category === "WF19" && r.src_port === "has-occupant" && pset.has(r.tgt_urn)) {
      if (r.src_urn) ws.add(r.src_urn);
    }
  }
  if (ws.size > 0) return { workspaces: [...ws], path: "wf19-has-occupant" };

  // [CONJ] fallback: no reverse-WF19 hit — attribute via the session.occupant property.
  for (const n of foldNodes(fold)) {
    if (n && n.type_id === "session") {
      const occ = rawProp(n, "occupant");
      if (typeof occ === "string" && pset.has(occ)) ws.add(n.urn);
    }
  }
  if (ws.size > 0) return { workspaces: [...ws], path: "occupant-property" };
  return { workspaces: [], path: "none" };
}

/**
 * (2b) SEAT-OWNERSHIP PERMIT — the sessions a user OWNS outright (`owner_urn === userUrn`).
 * ---------------------------------------------------------------------------------------
 * Seat grounding: every `session` node carries `owner_urn` naming its owner; the owner is
 * permitted that seat's workspace INDEPENDENT of the WF02-governs → reverse-WF19 has-occupant
 * closure (which under-resolves — a user occupies far fewer seats than it owns). This is an
 * ADDITIVE permit path unioned into the identified permitted set; it never subtracts.
 *
 * FAIL-CLOSED, by construction:
 *   - anon owns nothing: guarded out (`!userUrn || userUrn === ANON_USER_URN` ⇒ []), AND anon
 *     never reaches this step (permittedWorkspaces returns in the anon branch first). So the
 *     anon boundary is untouched — anon stays public-only.
 *   - a low-priv identified user who owns no session ⇒ [] (no `owner_urn` matches). Ownership
 *     therefore CANNOT leak a workspace to someone who does not literally own it.
 * @param {any} fold
 * @param {string | null | undefined} userUrn - the IDENTIFIED user urn (scope.user)
 * @returns {string[]} session urns whose `owner_urn` === userUrn (empty for anon / no-owner)
 */
export function ownedSessions(fold, userUrn) {
  if (!userUrn || userUrn === ANON_USER_URN) return []; // anon (or unset) owns nothing
  /** @type {Set<string>} */
  const out = new Set();
  for (const n of foldNodes(fold)) {
    if (n && n.type_id === "session" && rawProp(n, "owner_urn") === userUrn) {
      out.add(n.urn);
    }
  }
  return [...out];
}

/**
 * (3) WorkspacesOnWorkstation — sessions bound to a workstation via the design's named
 * engine→workstation relation D7 `realizes`, or a direct session `opens-on` a workstation.
 * Returns null when NEITHER named relation resolves (⇒ SKIP the intersection / widen).
 *
 * NOTE (4.0.2 reconciliation): the named `realizes` relation does not exist; engine↔workstation
 * is a WF03 `hosts` two-hop (workstation --hosts--> kernel, session --opens-on--> kernel). That
 * two-hop IS derivable, but a plain `workstation=` is a CLAIM not proof (§8), so it is NOT
 * applied at the client-presentation tier — it is where the server-authoritative tier, with a
 * cert-bound workstation, would enforce. Hence this returns null today and the caller skips
 * (client tier) or FAILS CLOSED (server-authoritative tier — see permittedWorkspaces).
 *
 * GUARD (should-fix): match ONLY the intended placement rewrite_category (WF19, the family
 * `opens-on`/`realizes` live in — confirmed against the live fold) AND verify the collected
 * src is a `session` node. A bare `src_port==="opens-on"` with no WFxx/type guard would let a
 * mislabeled relation inflate the on-workstation set at the server tier.
 * @param {any} fold
 * @param {string} workstationUrn
 * @param {Map<string, any>} [idx] - precomputed node index (built once by the caller)
 * @returns {string[] | null} bound session urns, or null to SKIP/fail-closed decision by caller
 */
export function workspacesOnWorkstation(fold, workstationUrn, idx) {
  if (!workstationUrn) return null;
  const index = idx || nodeIndex(fold);
  const isSession = (u) => index.get(u)?.type_id === "session";
  /** @type {Set<string>} */
  const ws = new Set();
  for (const r of foldRelations(fold)) {
    if (!r || r.tgt_urn !== workstationUrn || !r.src_urn) continue;
    // Placement family only: WF19 `opens-on` (session opens-on workstation) or the design's
    // D7 `realizes` (same placement family). rewrite_category + session-type guarded so a
    // mislabeled relation carrying these port names cannot inflate the set at the server tier.
    const isPlacement =
      r.rewrite_category === "WF19" &&
      (r.src_port === "opens-on" || r.src_port === "realizes");
    if (isPlacement && isSession(r.src_urn)) ws.add(r.src_urn);
  }
  return ws.size > 0 ? [...ws] : null; // null ⇒ no proven binding ⇒ caller SKIPs or fails closed
}

/**
 * Owner attribution: the SET of workspaces (sessions) a node belongs to, or [] (unattributable).
 * Session ⇒ [itself]; else the sessions reachable by walking the WF12 `provides-kb`/`kb-source`
 * lineage in the provider→item direction ONLY (session --provides-kb--> item; we walk item←provider),
 * UNIONED with its WF19 `has-occupant` lineage (an agent's occupied session). Every owning
 * session is collected (multi-owner); the gate then keeps the node only if ALL owners are
 * permitted (fail-closed). Directed-only so a node owned by a non-permitted session but merely
 * cited by a permitted one (item --provides-kb--> permitted-session) is NOT attributed to the
 * permitted one — that undirected hop was the insertion-order over-exposure defect.
 *
 * [CONJ] ownership-heuristic DEBT: until ownership is a first-class folded relation this leans on
 * WF12 lineage direction; the fail-closed multi-owner rule bounds the exposure of that heuristic.
 * @param {any} fold
 * @param {string} urn
 * @param {Map<string, any>} [idx] - precomputed node index (built once by the caller; perf)
 * @param {any[]} [rels] - precomputed relations array (built once by the caller; perf)
 * @returns {string[]} the set of owning workspace urns (empty ⇒ unattributable)
 */
export function owningWorkspaces(fold, urn, idx, rels) {
  const index = idx || nodeIndex(fold);
  const relations = rels || foldRelations(fold);
  const node = index.get(urn);
  if (!node) return [];
  if (node.type_id === "session") return [urn];

  const isSession = (u) => index.get(u)?.type_id === "session";
  /** @type {Set<string>} owning sessions (multi-owner union) */
  const owners = new Set();

  // WF12 provider→item lineage, DIRECTED: for the current item, an owning provider is the SRC of
  // a `provides-kb` relation whose TGT is the item (tgt_port `kb-source` is the same relation's
  // item-side port). Walk item→provider (match tgt_urn===cur) up to a session. Bounded + cycle-guarded.
  /** @type {Set<string>} */
  const seen = new Set([urn]);
  let frontier = [urn];
  for (let depth = 0; depth < 6 && frontier.length; depth++) {
    /** @type {string[]} */
    const next = [];
    for (const cur of frontier) {
      for (const r of relations) {
        if (!r || r.rewrite_category !== "WF12") continue;
        if (r.tgt_urn !== cur) continue; // provider→item ONLY (never item→provider)
        if (r.src_port !== "provides-kb" && r.tgt_port !== "kb-source") continue;
        const provider = r.src_urn;
        if (!provider || seen.has(provider)) continue;
        seen.add(provider);
        if (isSession(provider)) owners.add(provider); // an owning session — collect, don't stop
        else next.push(provider); // an intermediate item — keep walking up its providers
      }
    }
    frontier = next;
  }

  // WF19 has-occupant lineage: if this node is an occupant, collect EVERY occupying session.
  for (const r of relations) {
    if (r && r.rewrite_category === "WF19" && r.src_port === "has-occupant" && r.tgt_urn === urn && isSession(r.src_urn)) {
      owners.add(r.src_urn);
    }
  }
  return [...owners];
}

/**
 * The effective mode after the trust check: a `mode:"identified"` that is NOT backed by a
 * trusted-storage identity collapses to anon (fail-closed). Anon is the default for every
 * ambiguity.
 * @param {AccessScope | undefined | null} scope
 * @returns {AccessMode}
 */
export function effectiveMode(scope) {
  if (!scope) return "anon";
  return scope.mode === "identified" && scope.identity_source === "trusted-storage"
    ? "identified"
    : "anon";
}

/**
 * @typedef {"applied"|"skipped-widened"|"failed-closed"} WorkstationIntersection
 * "applied"        — a concrete workstation binding was resolved and intersected (narrowed).
 * "skipped-widened"— workstation ∩ NOT applied (client-presentation tier, or no workstation in
 *                    scope); the set is left as-is (widened, NOT narrowed by workstation).
 * "failed-closed"  — server-authoritative claim + UNRESOLVABLE workstation ⇒ the governs closure
 *                    is dropped to public-only (never widened). See FIX 4.
 */

/**
 * (permitted set) — orchestrates (1)-(4) for a resolved AccessScope.
 * @param {any} fold
 * @param {AccessScope} scope
 * @returns {{ permitted: string[], role_topology: string[], public: string[], path: "wf19-has-occupant"|"occupant-property"|"none", intersection_applied: boolean, workstation_intersection: WorkstationIntersection }}
 */
export function permittedWorkspaces(fold, scope) {
  const pub = publicWorkspaces(fold);
  const mode = effectiveMode(scope);

  if (mode === "anon") {
    // Anon: permitted = public ONLY. The anon principal is the sole (empty-topology) member.
    return {
      permitted: [...new Set(pub)],
      role_topology: [ANON_USER_URN],
      public: pub,
      path: "none",
      intersection_applied: false,
      workstation_intersection: "skipped-widened",
    };
  }

  // Identified: (1) governs closure from the pinned role, else the user.
  const seed = scope.role || scope.user;
  const principals = seed ? governedPrincipals(fold, seed) : [];

  // (2) reverse WF19 has-occupant (∪ occupant-property fallback).
  const { workspaces, path } = workspacesForPrincipals(fold, principals);

  // (2b) SEAT-OWNERSHIP PERMIT (ADDITIVE): every session the user OWNS outright (owner_urn ===
  // scope.user), independent of the (2) closure. This is the seat grounding — a user always sees
  // the seats they own, INCLUDING the workspace node they are viewing. Keyed on scope.user (NOT
  // the governed principals), guarded against anon, and empty for a user who owns nothing, so it
  // is fail-closed for anon/low-priv and only ever ADDS literally-owned sessions.
  const owned = ownedSessions(fold, scope.user);

  // (4) union public.
  /** @type {Set<string>} */
  let permitted = new Set([...workspaces, ...owned, ...pub]);

  // (3) workstation ∩.
  let intersectionApplied = false;
  /** @type {WorkstationIntersection} */
  let workstationIntersection = "skipped-widened";
  if (scope.workstation) {
    if (scope.enforced_by === "server-authoritative") {
      const onWs = workspacesOnWorkstation(fold, scope.workstation);
      if (onWs) {
        // A proven binding exists — narrow to workspaces on this workstation.
        const wsSet = new Set(onWs);
        permitted = new Set([...permitted].filter((w) => wsSet.has(w)));
        intersectionApplied = true;
        workstationIntersection = "applied";
      } else {
        // FIX 4 — FAIL CLOSED: a server-authoritative frame CLAIMS the workstation is
        // cert-bound, but the binding cannot be resolved from the fold. Do NOT widen (do NOT
        // silently skip and return the full governs closure). Drop every workstation-unprovable
        // workspace; keep only public (public is anon-visible, not workstation-gated). This is
        // the tier where the Go port MUST refuse to over-expose rather than fall through.
        permitted = new Set(pub);
        intersectionApplied = false;
        workstationIntersection = "failed-closed";
      }
    } else {
      // client-presentation tier: `workstation=` is a CLAIM not proof (§8) — SKIP the ∩ and
      // leave the set WIDENED. This is the ONLY tier allowed to skip+widen on a workstation.
      workstationIntersection = "skipped-widened";
    }
  }

  return {
    permitted: [...permitted],
    role_topology: principals,
    public: pub,
    path,
    intersection_applied: intersectionApplied,
    workstation_intersection: workstationIntersection,
  };
}

/**
 * resolveAccess(fold, accessScope) -> AccessResolution. The single entry point selectFrame
 * calls ONCE over the FULL fold. Pure, and CLIENT-SIDE by definition. If a genuine server
 * AccessResolution is present the caller (selectFrame, via opts.serverAccess) skips this
 * function entirely and trusts+echoes the server's own resolution (future A2).
 *
 * FIX 1 (badge honesty): `computed_by` is HARD-CODED to "client-presentation" here — this set
 * was computed client-side, full stop. `scope.enforced_by` is an INTENT hint (what tier the
 * config WANTS) and is NEVER echoed into `computed_by`; otherwise a chrome.storage flag could
 * make the UI claim `ACCESS: ENFORCED` ("the kernel returned only the permitted subgraph")
 * over a purely client-side computation. The only path to `computed_by:"server-authoritative"`
 * is a real server AccessResolution flowing through opts.serverAccess.
 * @param {any} fold
 * @param {AccessScope} scope - a RESOLVED scope (identity already worker-injected)
 * @returns {AccessResolution}
 */
export function resolveAccess(fold, scope) {
  const { permitted, role_topology, public: pub, path, intersection_applied, workstation_intersection } =
    permittedWorkspaces(fold, scope);
  return {
    scope,
    permitted_workspaces: permitted,
    role_topology,
    public_workspaces: pub,
    computed_by: "client-presentation", // FIX 1: client-side computation ⇒ never "enforced"
    intersection_applied,
    workstation_intersection,
    workspace_path: effectiveMode(scope) === "anon" ? "none" : path,
  };
}

/**
 * The access GATE as a keep-set over the FULL raw fold: the urns a resolution admits. The
 * caller intersects this with the type/scope/t selection in applyViewFilter. Rules (fail-closed):
 *   - explicitly-public node            → keep (always)
 *   - owners ⊆ permitted_workspaces     → keep (EVERY owning workspace must be permitted)
 *   - unattributable (no owner) node    → DROP for EVERYONE (fail-closed) unless explicitly
 *                                          public (FIX 2 — a low-priv identified user must NOT
 *                                          see confidential null-owner nodes; identity alone
 *                                          never unlocks them)
 *   - ANY owner ∉ permitted             → drop (FIX 3 — fail-closed on multi-owner ambiguity)
 *
 * PERF (should-fix): the node index + relations are built ONCE here and threaded into
 * owningWorkspaces, so the keep-set is linear rather than the previous O(N²) (a full rebuild
 * per node). The old `void idx` shim is gone.
 * @param {any} fold
 * @param {AccessResolution} resolution
 * @returns {Set<string>}
 */
export function accessKeepSet(fold, resolution) {
  const permitted = new Set(resolution.permitted_workspaces);
  const idx = nodeIndex(fold);        // built ONCE
  const rels = foldRelations(fold);   // built ONCE
  /** @type {Set<string>} */
  const keep = new Set();
  // Tier-aware handling of UNATTRIBUTABLE nodes (no folded workspace owner — the common case:
  // the WF12/WF19 ownership heuristic places only a fraction of nodes). The client-presentation
  // tier is honestly NOT a security boundary — the full fold is already fetched into the panel and
  // the badge says PRESENTATION — and in a single-owner deployment an "unowned"/global node belongs
  // to the identified owner, so hiding it buys ZERO confidentiality and only empties the view. So at
  // the identified client tier, unattributable nodes are SHOWN. At the SERVER-authoritative tier
  // (computed_by === "server-authoritative"), and for ANON in EVERY tier, unattributable fails
  // CLOSED — that is the real multi-user boundary and the behavior that ports into access.go.
  // ATTRIBUTED nodes always require every owner to be permitted (multi-owner ambiguity fails closed).
  const mode = resolution.scope && resolution.scope.mode;
  const serverEnforced = resolution.computed_by === "server-authoritative";
  const keepUnattributed = mode === "identified" && !serverEnforced;
  for (const node of foldNodes(fold)) {
    if (!node || !node.urn) continue;
    if (isPublicWorkspace(node)) {
      keep.add(node.urn);
      continue;
    }
    const owners =
      node.type_id === "session" ? [node.urn] : owningWorkspaces(fold, node.urn, idx, rels);
    if (owners.length === 0) {
      if (keepUnattributed) keep.add(node.urn); // identified client tier only; anon + server drop
      continue;
    }
    if (owners.every((o) => permitted.has(o))) {
      keep.add(node.urn);
    }
  }
  return keep;
}

/**
 * The worker-strip primitive (pure, testable). Extracts the ONLY thing the panel/page may
 * contribute — `access.mode` — from an inbound request, discarding any forged
 * user/workstation/role/identity_source. The worker feeds the result to resolveTrustedAccess.
 * @param {any} request - an inbound FrameRequest (untrusted)
 * @returns {AccessMode} "identified" only if the inbound literally requested it; else "anon"
 */
export function readRequestedMode(request) {
  const m = request && request.view_filter && request.view_filter.access
    ? request.view_filter.access.mode
    : undefined;
  return m === "identified" ? "identified" : "anon";
}
