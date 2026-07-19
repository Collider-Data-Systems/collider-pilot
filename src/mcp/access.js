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
 *   (1) group_topology = WF02 `governs` closure. BFS from `user_urn` over relations with
 *       rewrite_category==="WF02" && src_port==="governs" (src→tgt), following role→role
 *       `delegates-to` delegates; include `user_urn` itself. If `role` is pinned, seed the
 *       closure from that role instead of (in addition to) the user.
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
 * `workspaceOfNode(fold, urn)` (owner attribution): a session is its own workspace; else the
 * node's owning workspace = the session reachable via its WF12 `provides-kb` / `kb-source`
 * lineage, else its WF19 `has-occupant` lineage; unattributable ⇒ null. The gate treats a
 * null (unattributable) node as SHOWN for identified (never under-hide a legit user) and
 * HIDDEN for anon (fail-closed) — anon sees ONLY explicitly-public nodes.
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
 * (1) group_topology = WF02 `governs` transitive closure from a seed principal, following
 * role→role `delegates-to` delegates. Includes the seed. Same governs spine the kernel
 * folds for §M11/§M12 write-gating, generalized to the full reachable principal set.
 * @param {any} fold
 * @param {string} seedUrn - user_urn (or a pinned role urn)
 * @returns {string[]} reachable principals (agents/roles/user), incl. the seed
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
      if ((isGoverns || isDelegates) && r.src_urn === cur && r.tgt_urn && !seen.has(r.tgt_urn)) {
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
 * (3) WorkspacesOnWorkstation — sessions bound to a workstation via the design's named
 * engine→workstation relation D7 `realizes`, or a direct session `opens-on` a workstation.
 * Returns null when NEITHER named relation resolves (⇒ SKIP the intersection / widen).
 *
 * NOTE (4.0.2 reconciliation): the named `realizes` relation does not exist; engine↔workstation
 * is a WF03 `hosts` two-hop (workstation --hosts--> kernel, session --opens-on--> kernel). That
 * two-hop IS derivable, but a plain `workstation=` is a CLAIM not proof (§8), so it is NOT
 * applied at the client-presentation tier — it is where the server-authoritative tier, with a
 * cert-bound workstation, would enforce. Hence this returns null today and the caller skips.
 * @param {any} fold
 * @param {string} workstationUrn
 * @returns {string[] | null} bound session urns, or null to SKIP (widened)
 */
export function workspacesOnWorkstation(fold, workstationUrn) {
  if (!workstationUrn) return null;
  /** @type {Set<string>} */
  const ws = new Set();
  for (const r of foldRelations(fold)) {
    if (!r) continue;
    // D7 `realizes`: session/surface realizes-on the workstation (design's named relation).
    if (r.src_port === "realizes" && r.tgt_urn === workstationUrn && r.src_urn) ws.add(r.src_urn);
    // direct session opens-on a workstation (vs the live fold's session opens-on kernel).
    if (r.src_port === "opens-on" && r.tgt_urn === workstationUrn && r.src_urn) ws.add(r.src_urn);
  }
  return ws.size > 0 ? [...ws] : null; // null ⇒ named binding absent ⇒ SKIP (widened)
}

/**
 * Owner attribution: the workspace (session) a node belongs to, or null (unattributable).
 * Session ⇒ itself; else the session reachable via WF12 `provides-kb`/`kb-source` lineage;
 * else its WF19 `has-occupant` lineage (an agent's occupied session). [CONJ] heuristic until
 * ownership is a first-class folded relation.
 * @param {any} fold
 * @param {string} urn
 * @returns {string | null}
 */
export function workspaceOfNode(fold, urn) {
  const idx = nodeIndex(fold);
  const node = idx.get(urn);
  if (!node) return null;
  if (node.type_id === "session") return urn;

  const rels = foldRelations(fold);
  const isSession = (u) => idx.get(u)?.type_id === "session";

  // WF12 provides-kb / kb-source lineage toward a session (bounded walk, cycle-guarded).
  /** @type {Set<string>} */
  const seen = new Set([urn]);
  let frontier = [urn];
  for (let depth = 0; depth < 6 && frontier.length; depth++) {
    /** @type {string[]} */
    const next = [];
    for (const cur of frontier) {
      for (const r of rels) {
        if (!r || r.rewrite_category !== "WF12") continue;
        // follow provides-kb (src→tgt) and kb-source (tgt→src) toward the workspace.
        let hop = null;
        if (r.src_urn === cur && (r.src_port === "provides-kb" || r.tgt_port === "kb-source")) hop = r.tgt_urn;
        else if (r.tgt_urn === cur && (r.src_port === "provides-kb" || r.tgt_port === "kb-source")) hop = r.src_urn;
        if (hop && !seen.has(hop)) {
          if (isSession(hop)) return hop;
          seen.add(hop);
          next.push(hop);
        }
      }
    }
    frontier = next;
  }

  // WF19 has-occupant lineage: if this node is an occupant agent, its occupied session.
  for (const r of rels) {
    if (r && r.rewrite_category === "WF19" && r.src_port === "has-occupant" && r.tgt_urn === urn && isSession(r.src_urn)) {
      return r.src_urn;
    }
  }
  return null;
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
 * (permitted set) — orchestrates (1)-(4) for a resolved AccessScope.
 * @param {any} fold
 * @param {AccessScope} scope
 * @returns {{ permitted: string[], role_topology: string[], public: string[], path: "wf19-has-occupant"|"occupant-property"|"none", intersection_applied: boolean }}
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
    };
  }

  // Identified: (1) governs closure from the pinned role, else the user.
  const seed = scope.role || scope.user;
  const principals = seed ? governedPrincipals(fold, seed) : [];

  // (2) reverse WF19 has-occupant (∪ occupant-property fallback).
  const { workspaces, path } = workspacesForPrincipals(fold, principals);

  // (4) union public.
  /** @type {Set<string>} */
  let permitted = new Set([...workspaces, ...pub]);

  // (3) workstation ∩. null ⇒ named binding absent (or a client-tier claim) ⇒ SKIP (widen).
  let intersectionApplied = false;
  if (scope.workstation && scope.enforced_by === "server-authoritative") {
    const onWs = workspacesOnWorkstation(fold, scope.workstation);
    if (onWs) {
      const wsSet = new Set(onWs);
      permitted = new Set([...permitted].filter((w) => wsSet.has(w)));
      intersectionApplied = true;
    }
  }

  return {
    permitted: [...permitted],
    role_topology: principals,
    public: pub,
    path,
    intersection_applied: intersectionApplied,
  };
}

/**
 * resolveAccess(fold, accessScope) -> AccessResolution. The single entry point selectFrame
 * calls ONCE over the FULL fold. Pure. If a server AccessResolution is already present the
 * caller skips this and trusts+echoes it (future A2).
 * @param {any} fold
 * @param {AccessScope} scope - a RESOLVED scope (identity already worker-injected)
 * @returns {AccessResolution}
 */
export function resolveAccess(fold, scope) {
  const { permitted, role_topology, public: pub, path, intersection_applied } =
    permittedWorkspaces(fold, scope);
  return {
    scope,
    permitted_workspaces: permitted,
    role_topology,
    public_workspaces: pub,
    computed_by: scope.enforced_by || "client-presentation",
    intersection_applied,
    workspace_path: effectiveMode(scope) === "anon" ? "none" : path,
  };
}

/**
 * The access GATE as a keep-set over the FULL raw fold: the urns a resolution admits. The
 * caller intersects this with the type/scope/t selection in applyViewFilter. Rules:
 *   - explicitly-public node        → keep (always)
 *   - owner ∈ permitted_workspaces  → keep
 *   - unattributable (owner null)   → keep iff identified (never under-hide a legit user);
 *                                      anon drops it (fail-closed — anon sees only public)
 *   - owner ∉ permitted             → drop
 * @param {any} fold
 * @param {AccessResolution} resolution
 * @returns {Set<string>}
 */
export function accessKeepSet(fold, resolution) {
  const permitted = new Set(resolution.permitted_workspaces);
  const mode = effectiveMode(resolution.scope);
  const idx = nodeIndex(fold);
  /** @type {Set<string>} */
  const keep = new Set();
  for (const node of foldNodes(fold)) {
    if (!node || !node.urn) continue;
    if (isPublicWorkspace(node)) {
      keep.add(node.urn);
      continue;
    }
    const owner = node.type_id === "session" ? node.urn : workspaceOfNode(fold, node.urn);
    if (owner && permitted.has(owner)) {
      keep.add(node.urn);
    } else if (owner === null && mode === "identified") {
      keep.add(node.urn);
    }
    void idx; // idx retained for symmetry with workspaceOfNode's index
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
