/**
 * Collider Pilot - slice controls (t264 re-cut of the Phase 6 graph toolbar)
 * ==========================================================================
 * The control surface for the ONE function the panel projects:
 *
 *     slice : State × Agent → Context          (t263 ratification, "the same function")
 *
 * Every control here is one of its arguments; nothing else earns panel space:
 *
 *   WHO    — access posture ("Stay anon" / "Bring me in"; identity set in Settings)
 *   WHERE  — focus: All permitted, or one spine node (manifold / group / workspace /
 *            channel / the current selection), expanded scope_hops BFS steps out
 *   WHAT   — a LENS preset (identity · topology · content · knowledge · substrate ·
 *            everything) that sets the node types + relation ports together; the raw
 *            checkboxes live in the advanced drawer and flip the lens to "custom" when
 *            they deviate
 *   WHEN   — the optional t bound
 *
 * The inline graph is OFF by default (t264: the PiP / pop-out / full-tab mirrors carry
 * the picture; selection syncs both ways through the shared scratch) — the toggle here
 * turns it back on for mirror-less use.
 *
 * Presentational + controlled: every VALUE comes in as a prop and every change is lifted
 * to the panel via a callback. The only local state is the advanced drawer's open flag.
 * No I/O, no adapter here.
 *
 * t342 hand-off C: `find` applies as you type, so Apply sits with the drawer it serves — the
 * staged type / port / t edits of `view_filter · advanced` (PIL-7); every control carries a
 * `data-testid` (PIL-10); the fold's labels on no declared pair are the "port on no pair"
 * group, one of the six words the pilot, the Workbench and the manual share (PIL-9).
 */

import { useState } from "react";
import type { AccessPosture } from "../state/prefs";
import type {
  AccessScope,
  EngineGrammar,
  FoldVocab,
  FrameRequest,
  HgFrame,
  ViewFilter,
} from "../mcp/types";
import { KB_NODE_TYPES, KB_ONTOLOGY_VERSION, KB_PORTS } from "../ui/kb-vocab.js";
import { grammarGap, isPlaceholderPort } from "../mcp/engine-grammar.js";

/* -------------------------------------------------------------------------- */
/* Lens presets — named (types × ports) slices matching the doctrine strata   */
/* -------------------------------------------------------------------------- */

export interface Lens {
  id: string;
  label: string;
  /** Node type_ids the lens retains. ["*"] = all (the transform's sentinel). */
  types: string[];
  /** Relation port labels the lens retains. [] = all. */
  ports: string[];
  title: string;
}

export const LENSES: Lens[] = [
  {
    id: "identity",
    label: "identity",
    types: ["user", "group", "agent", "role", "manifold"],
    // T7: the WF01 kinship ports (ontology 4.0.5 — parent-of/child-of, spouse-of,
    // sibling-of; `topology`-coloured there, but "who is who" is this lens's job). The
    // VOCAB must render BEFORE any kinship data is applied to a fold (the apply is
    // Sam-gated behind G3) — the pilot must never be the blocker.
    ports: [
      "member-of",
      "governs",
      "delegates-to",
      "owns",
      "spans",
      "presents-as",
      "parent-of",
      "child-of",
      "spouse-of",
      "sibling-of",
    ],
    title:
      "The A1 identity poset: who is who, who belongs to what, who governs whom (user · group · agent · role · manifold + member-of / governs / delegates-to / owns / spans / presents-as, and the 4.0.5 kinship ports parent-of / child-of / spouse-of / sibling-of). What those relations point AT comes along even when its type is not listed here — so `owns` brings the owned workstation and channel in with it.",
  },
  {
    id: "topology",
    label: "topology",
    types: [
      "session",
      "kernel",
      "workstation",
      "router",
      "channel",
      "manifold",
      "twin_link",
      "endpoint",
      "agent",
    ],
    ports: [
      "opens-on",
      "has-occupant",
      "hosts",
      "routes-to",
      "spans",
      "realizes",
      "composes",
      "participates",
    ],
    title:
      "Machines, workspaces, channels and how they connect (session · kernel · workstation · router · channel · manifold · twin_link · endpoint · agent + opens-on / has-occupant / hosts / routes-to / spans / realizes / composes / participates). What those relations point AT comes along even when its type is not listed here — so `routes-to` brings the shard rules the router routes through.",
  },
  {
    id: "content",
    label: "content",
    types: [
      "knowledge_item",
      "derivation",
      "program",
      "grammar_fragment",
      "purpose",
      "session",
      "domain_tag",
    ],
    // ALL ports (t264 review major): this was the DEFAULT lens until t342, and main's
    // default frame showed every relation between the retained nodes. Narrowing relations
    // is the spine lenses' job; the content lens narrows TYPES only.
    ports: [],
    title:
      "Knowledge and work products: knowledge items, derivations, applied programs, grammar fragments — with every relation between them.",
  },
  {
    id: "knowledge",
    label: "knowledge",
    // t337: the knowledge graph on its own — claims, the sources they derive from, and the
    // field > topic > module hierarchy they sit in (ontology 4.0.8, all WF12). The port names
    // are READ from the Lean-emitted vocabulary (src/ui/kb-vocab.json through its accessor),
    // never restated here; the tooltip is built from the same lists so it cannot drift.
    //
    // Only `claim` is selected by type. The relation closure (transform.js applyViewFilter)
    // carries in whatever a retained knowledge relation points at, so the sources, tags,
    // scheme and modules that are IN the knowledge graph arrive with their relations —
    // while naming those types here would add every unrelated node of the same type.
    // Measured on the t336 scratch fold (447n/420r): 122 nodes / 178 relations this way,
    // 219 nodes with all five types listed.
    //
    // Declared ahead of the data on any engine below 4.0.8, like the kinship ports above.
    types: ["claim"],
    ports: [...KB_PORTS],
    title: `The knowledge graph on its own: claims, the sources they were taken from, and the field / topic / module hierarchy they belong to (${KB_NODE_TYPES.join(" · ")} + ${KB_PORTS.join(" / ")}). Only claim is selected by type — every claim node of the engine is shown, also one that no knowledge relation touches. What the knowledge relations point AT comes along, so sources, tags and modules that are not part of the knowledge graph stay out. These ports are ontology ${KB_ONTOLOGY_VERSION}: on an engine with no knowledge relations this lens shows only its claim nodes, if it has any.`,
  },
  {
    id: "substrate",
    label: "substrate",
    // T=281: the A2 DEPLOYMENT axis — where a manifold's rewrites actually execute, as
    // opposed to `topology`'s A3 presentation axis (where a human sees it). The two were
    // conflated under one word until t265 separated them; this lens is the half that had
    // no surface at all.
    //
    // Declared AHEAD of any data, exactly as the kinship ports above were: mtdc-lab's round-7
    // census measured ZERO live compute/storage nodes and zero WF04/WF08/WF09/WF10 relations
    // fleet-wide — the grammar is ratified and empty. The first environment minted under
    // spec/0001 ruling 1 (sandbox -> substrate -> provisioning) would otherwise be visible
    // only inside `everything`, with no way to isolate it. The pilot must never be the blocker.
    types: [
      "compute",
      "storage",
      "harness",
      "kernel",
      "workstation",
      "transport_binding",
      "twin_link",
      "runtime",
      "workflow",
    ],
    ports: [
      "contains",
      "bound-to",
      "computes-on",
      "computed-by",
      "persisted-in",
      "persists",
      "hosts",
      "hosted-on",
      "exposes",
      "synced-via",
      "sync-target",
    ],
    title:
      "Where a manifold actually RUNS — the A2 deployment axis: compute and storage substrates, the engines bound to them, the harness that hosts execution, and the log's storage home (compute · storage · harness · runtime · workflow · kernel · workstation · transport_binding · twin_link + contains / bound-to / computes-on / computed-by / persisted-in / persists / hosts / hosted-on / exposes / synced-via / sync-target). Distinct from `topology`, which is where a human SEES it. Expect this lens to be empty until the first environment is minted — the grammar is ratified, the instances are not.",
  },
  {
    id: "everything",
    label: "everything",
    types: ["*"],
    ports: [],
    title: "The whole permitted fold — every node type, every relation. The full manifold view.",
  },
];

/** The lens id used when the advanced checkboxes deviate from every preset. */
export const CUSTOM_LENS_ID = "custom";

/**
 * Default lens on open — `everything` (t342, Sam: "I need the view not narrowed at
 * opening"). The panel opens on the whole permitted fold; every narrower lens is one tap
 * away and Reset comes back here. It was `content` (the classic four-type slice), which hid
 * every principal, place and claim until a lens was tapped. This widens WHAT is selected,
 * never WHO: the access posture still gates the frame exactly as before.
 */
export const DEFAULT_LENS_ID = "everything";

export function lensById(id: string): Lens | null {
  return LENSES.find((l) => l.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Advanced drawer vocab — grouped node types and relation ports              */
/* -------------------------------------------------------------------------- */

/** Node types offered in the advanced drawer, grouped for scanability. */
export const TYPE_GROUPS: { label: string; types: string[] }[] = [
  { label: "principals", types: ["user", "group", "agent", "role"] },
  {
    label: "places",
    types: [
      "session",
      "kernel",
      "workstation",
      "router",
      "channel",
      "manifold",
      "twin_link",
      "endpoint",
    ],
  },
  {
    label: "content",
    types: [
      "knowledge_item",
      "derivation",
      "program",
      "grammar_fragment",
      "domain_tag",
      "claim",
      "source_feed",
    ],
  },
  {
    // T=281: the A2 deployment axis. Declared ahead of data — zero live instances today
    // (mtdc-lab round 7); the grammar for all of it is ratified.
    label: "substrate",
    types: ["compute", "storage", "harness", "transport_binding", "runtime", "workflow"],
  },
  {
    label: "governance & ops",
    types: [
      "purpose",
      "governance_proposal",
      "t_hook",
      "watcher",
      "guard",
      "reactor",
      "system_instruction",
      "classification_scheme",
      "shard_rule",
      "calendar_event",
      "git_issue",
      "agent_session",
    ],
  },
];

/**
 * t342 P6 LEGACY PORTS: names the drawer offered by hand that NO operad declares — not the
 * laptop kernel's 4.0.7, not scratch's mtdc-2.1.0 — and that NO live fold carries (measured
 * t342 on both). Kept in their own group, not deleted: a fold written before they fell out
 * of the grammar may still hold one, and the `topology` lens still names `realizes`. Every
 * other port a lens names must be declared by the connected engine (or by the knowledge
 * vocabulary) — `smoke:live` (h) fails on one that is neither declared nor listed here.
 *   - realizes : placement, named by the topology lens; in no rewrite_category.
 *   - cites    : content/flow; in no rewrite_category (WF12 has `derived-from` for provenance).
 *   - curates  : content/flow; in no rewrite_category.
 */
export const LEGACY_PORTS: readonly string[] = ["realizes", "cites", "curates"];

/** Relation ports offered in the advanced drawer, grouped by family. */
export const PORT_GROUPS: { label: string; ports: string[] }[] = [
  { label: "identity/authority", ports: ["owns", "member-of", "governs", "delegates-to"] },
  // T7: WF01 kinship (ontology 4.0.5). Declared ahead of any applied kinship data.
  { label: "kinship", ports: ["parent-of", "child-of", "spouse-of", "sibling-of"] },
  {
    label: "placement",
    ports: [
      "opens-on",
      "has-occupant",
      "hosts",
      "routes-to",
      "spans",
      "presents-as",
      "participates",
    ],
  },
  {
    // T=281: WF04 contains · WF08 bound-to · WF09 computes-on · WF10 persisted-in — the
    // substrate chain. Ratified, zero live instances, declared here ahead of the data.
    label: "substrate",
    ports: [
      "contains",
      "bound-to",
      "computes-on",
      "computed-by",
      "persisted-in",
      "persists",
      "hosted-on",
      "exposes",
      "synced-via",
      "sync-target",
    ],
  },
  {
    label: "content/flow",
    ports: [
      "provides-kb",
      "classifies",
      "pins-urn",
      "depends-on",
      "composes",
      "produces",
      "causes",
      "triggers",
      "has-purpose",
      "scheduled-after",
      "focus",
      "guards",
    ],
  },
  // t337: the WF12 knowledge relations (ontology 4.0.8), READ from the Lean-emitted
  // vocabulary — never restated here. Before this group they had no checkbox, and unticking
  // ANY other port expanded from an ALL_PORTS that lacked them, silently dropping every
  // knowledge relation from the frame (measured: 178 -> 0).
  { label: "knowledge", ports: [...KB_PORTS] },
  // t342 P6: the legacy list (see LEGACY_PORTS) — still offered, so a fold that carries one
  // can select it and the `topology` lens keeps every port it names reachable.
  { label: "legacy", ports: [...LEGACY_PORTS] },
];

/**
 * The access posture the panel MAY contribute — ONLY `mode`. Identity_source is declared
 * "anon" and user/workstation/role are null because a page/panel has NO authority to assert
 * an identity: the worker (or the preview's worker simulation) DISCARDS this whole object and
 * re-injects the trusted scope from chrome.storage.local, keeping only `mode`. This is a
 * throwaway carrier for the toggle, never a claim.
 */
export function panelAccessScope(mode: AccessPosture): AccessScope {
  return {
    mode,
    user: null,
    workstation: null,
    role: null,
    identity_source: "anon",
    enforced_by: "client-presentation",
  };
}

/** The full slice specification the panel holds — one value per axis. */
export interface SliceSpec {
  lens: string; // lens id, or "custom"
  types: string[]; // effective type selection (["*"] = all)
  ports: string[]; // effective port selection ([] = all)
  t: string; // raw t text; "" = latest
  hops: number; // scope BFS depth (1..4)
}

/** The spec a fresh panel opens with. */
export function defaultSliceSpec(): SliceSpec {
  const lens = lensById(DEFAULT_LENS_ID)!;
  return { lens: lens.id, types: [...lens.types], ports: [...lens.ports], t: "", hops: 1 };
}

/** Every type / port the advanced drawer offers (flattened). */
export const ALL_TYPES: string[] = TYPE_GROUPS.flatMap((g) => g.types);
export const ALL_PORTS: string[] = PORT_GROUPS.flatMap((g) => g.ports);

/* -------------------------------------------------------------------------- */
/* t342 P6 — the drawer's vocabulary: static lists + what the engine declares */
/* -------------------------------------------------------------------------- */

/** The groups the drawer shows for one frame, and what an untick expands from. */
export interface DrawerVocab {
  typeGroups: { label: string; types: string[]; title?: string }[];
  portGroups: { label: string; ports: string[]; title?: string }[];
  /** Every type / port the drawer offers — the expand-from-all base of an untick. */
  allTypes: string[];
  allPorts: string[];
  /** Labels in the permitted fold that are the source port of no declared pair. */
  undeclaredPorts: string[];
  /** "engine": the frame's grammar came from the engine; "static": it did not. */
  source: "engine" | "static";
  /** One sentence for the drawer: where the extra groups came from, or why there are none. */
  note: string;
}

/**
 * t342 P6: the drawer's groups for a frame. The static TYPE_GROUPS / PORT_GROUPS (the lens
 * invariant, smoke:lens A-C) come first, unchanged; then, read at RUN TIME:
 *   - the node types and source ports the ENGINE declares (`/operad/node-types`,
 *     `/operad/rewrite-categories` + AdditionalPortPairs) that no static group names — one
 *     extra group each, named by the engine's ontology version. No mtdc-only name is written
 *     into this repo: on mtdc-2.1.0 this group is how all 56 types become reachable;
 *   - the labels and types of the permitted fold that neither the static lists nor the engine
 *     name — so a live label no operad declares (`tagged`, `summarizes`, `steers` on the
 *     laptop kernel) stays reachable; its relations draw as "undeclared pair" (P1).
 * Only SOURCE ports are offered from the engine: a relation's label is its src_port, so a
 * name that is only ever a target end labels nothing. A `{placeholder}` port is not a name
 * the engine group offers — unless the fold carries it as a label: then it is a declared
 * source port, in the engine group, not "undeclared pair" (t342 P6 review: one basis with the
 * graph's pair check, the source ports of `grammar.pairs`).
 * Without an engine grammar the static lists stand alone (plus the fold's own names), and
 * the note says so. `smoke:live` (d) checks the live fold through this same function.
 */
export function drawerVocab(
  grammar: EngineGrammar | null | undefined,
  foldVocab?: FoldVocab | null,
): DrawerVocab {
  const engine = grammar?.status === "engine" ? grammar : null;
  const foldPorts = Array.isArray(foldVocab?.ports) ? foldVocab.ports : [];
  const foldTypes = Array.isArray(foldVocab?.types) ? foldVocab.types : [];
  const staticTypes = new Set(ALL_TYPES);
  const staticPorts = new Set(ALL_PORTS);
  const engineTypes = engine ? engine.types.filter((t) => !staticTypes.has(t)) : [];
  // Every declared source port, placeholders included — the basis isDeclaredPair uses.
  const declaredSrc = new Set(engine ? engine.pairs.map((p) => p.src_port) : []);
  const foldPlaceholders = foldPorts.filter((p) => isPlaceholderPort(p) && declaredSrc.has(p));
  const enginePorts = engine
    ? [...new Set([...engine.src_ports, ...[...new Set(foldPlaceholders)].sort()])].filter(
        (p) => !staticPorts.has(p),
      )
    : [];
  const declaredTypes = new Set(engine ? engine.types : []);
  const foldOnlyTypes = [...new Set(foldTypes)]
    .filter((t) => !staticTypes.has(t) && !declaredTypes.has(t))
    .sort();
  const foldOnlyPorts = [...new Set(foldPorts)]
    .filter((p) => !staticPorts.has(p) && !declaredSrc.has(p))
    .sort();
  const ov = engine?.ontology_version ?? grammar?.ontology_version ?? "unknown";
  const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const typeGroups = [
    ...TYPE_GROUPS,
    ...(engineTypes.length
      ? [
          {
            label: `engine ${ov}`,
            types: engineTypes,
            title: `Node types the connected engine declares (/operad/node-types, ontology ${ov}) that the static groups above do not name.`,
          },
        ]
      : []),
    ...(foldOnlyTypes.length
      ? [
          {
            label: engine ? "in this fold, undeclared" : "in this fold",
            types: foldOnlyTypes,
            title: engine
              ? "Node types in the permitted fold that the engine's /operad/node-types does not declare."
              : "Node types in the permitted fold that the static groups above do not name.",
          },
        ]
      : []),
  ];
  const portGroups = [
    ...PORT_GROUPS,
    ...(enginePorts.length
      ? [
          {
            label: `engine ${ov}`,
            ports: enginePorts,
            title: `Source ports the connected engine declares (/operad/rewrite-categories with its additional pairs, ontology ${ov}) that the static groups above do not name.`,
          },
        ]
      : []),
    ...(foldOnlyPorts.length
      ? [
          {
            // t342 PIL-9: "port on no pair", the shared word (it was "undeclared pair").
            label: engine ? "port on no pair" : "in this fold",
            ports: foldOnlyPorts,
            title: engine
              ? "Relation labels in the permitted fold that are the source port of no pair the engine declares. The graph draws such a relation as a pair not declared (dotted, with a diamond midway)."
              : "Relation labels in the permitted fold that the static groups above do not name.",
          },
        ]
      : []),
  ];
  // Without an engine grammar the drawer is the static lists plus what the permitted fold adds
  // (the "in this fold" groups above); the note says which.
  const staticNote =
    foldOnlyTypes.length || foldOnlyPorts.length
      ? `static lists + ${plural(foldOnlyTypes.length, "type")} and ${plural(foldOnlyPorts.length, "port")} from the permitted fold`
      : "static lists only";
  const note = engine
    ? `+${plural(engineTypes.length, "type")} and ${plural(enginePorts.length, "port")} the engine declares (ontology ${ov})` +
      (foldOnlyPorts.length ? ` · ${plural(foldOnlyPorts.length, "label")} on no declared pair` : "")
    : grammar && grammar.status === "absent"
      ? `${grammarGap(grammar)} (${grammar.reason}) — ${staticNote}`
      : `no engine grammar on this frame — ${staticNote}`;
  return {
    typeGroups,
    portGroups,
    allTypes: typeGroups.flatMap((g) => g.types),
    allPorts: portGroups.flatMap((g) => g.ports),
    undeclaredPorts: engine ? foldOnlyPorts : [],
    source: engine ? "engine" : "static",
    note,
  };
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && b.every((x) => a.includes(x));

/** The lens id whose (types × ports) exactly matches — or "custom". */
export function matchLens(types: string[], ports: string[]): string {
  for (const l of LENSES) {
    if (sameSet(types, l.types) && sameSet(ports, l.ports)) return l.id;
  }
  return CUSTOM_LENS_ID;
}

/** Apply a lens preset to a spec (t and hops survive; types/ports are replaced). */
export function specWithLens(spec: SliceSpec, lensId: string): SliceSpec {
  const lens = lensById(lensId);
  if (!lens) return spec;
  return { ...spec, lens: lens.id, types: [...lens.types], ports: [...lens.ports] };
}

/**
 * Toggle one node type in a spec. The ["*"] sentinel concretizes to the full drawer
 * list first; re-completing the full list collapses back to ["*"]. The lens field is
 * re-derived (a deviation flips it to "custom"; landing exactly on a preset names it).
 *
 * The LAST remaining type cannot be unticked (Copilot #21 catch): an empty `types`
 * array is the transform's legacy "fall back to the default slice" signal, so a
 * 0-type UI state would silently request a 4-type frame. Refusing the final untick
 * keeps the UI and the request telling the same story.
 *
 * t342 P6: `all` is what the drawer offers for THIS frame (drawerVocab().allTypes — the
 * static groups plus the engine's and the fold's own types). Expanding ["*"] from the static
 * list alone would drop every engine-only type the moment one box is unticked.
 */
export function specToggleType(
  spec: SliceSpec,
  ty: string,
  all: readonly string[] = ALL_TYPES,
): SliceSpec {
  const base = spec.types.includes("*") ? [...all] : [...spec.types];
  const next = base.includes(ty) ? base.filter((t) => t !== ty) : [...base, ty];
  if (next.length === 0) return spec; // never emit [] — it would silently mean "default"
  const types = sameSet(next, [...all]) ? ["*"] : next;
  return { ...spec, types, lens: matchLens(types, spec.ports) };
}

/**
 * Toggle one relation port. [] (= all) concretizes first; full list collapses to [].
 * Same last-item guard as types (Copilot #21 catch, mirrored): [] means ALL ports in
 * the transform, so unticking the final port would silently flip the slice from
 * "one port" to "every port".
 *
 * t342 P6: `all` as for specToggleType (drawerVocab().allPorts).
 */
export function specTogglePort(
  spec: SliceSpec,
  p: string,
  all: readonly string[] = ALL_PORTS,
): SliceSpec {
  const base = spec.ports.length === 0 ? [...all] : [...spec.ports];
  const next = base.includes(p) ? base.filter((x) => x !== p) : [...base, p];
  if (next.length === 0) return spec; // never emit [] — it would silently mean "all"
  const ports = sameSet(next, [...all]) ? [] : next;
  return { ...spec, ports, lens: matchLens(spec.types, ports) };
}

/**
 * Build a FrameRequest from the slice spec + access posture + optional focus scope.
 * When `accessMode` is supplied the request always carries `view_filter.access` (mode
 * only) so the toggle flows; a non-empty `scopeUrns` pins the focus. Returns undefined
 * for the fully-default spec with no posture (legacy bare request ⇒ transform defaults).
 * Shared by the side panel and the harnesses.
 */
export function buildFrameRequest(
  spec: SliceSpec,
  accessMode?: AccessPosture,
  scopeUrns?: string[],
): FrameRequest | undefined {
  const def = defaultSliceSpec();
  const trimmed = spec.t.trim();
  const tNum = trimmed === "" ? null : Number(trimmed);
  const tValid = tNum !== null && Number.isFinite(tNum);
  const sameTypes =
    spec.types.length === def.types.length && def.types.every((t) => spec.types.includes(t));
  const samePorts =
    spec.ports.length === def.ports.length && def.ports.every((p) => spec.ports.includes(p));
  const isDefault = sameTypes && samePorts && !tValid && spec.hops === 1;
  const scoped = Array.isArray(scopeUrns) && scopeUrns.length > 0;
  if (isDefault && !accessMode && !scoped) return undefined;
  const view_filter: Partial<ViewFilter> = {};
  view_filter.types = [...spec.types];
  if (spec.ports.length > 0) view_filter.ports = [...spec.ports];
  if (tValid) view_filter.t = tNum as number;
  if (spec.hops !== 1) view_filter.scope_hops = spec.hops;
  if (spec.lens) view_filter.lens = spec.lens;
  if (accessMode) view_filter.access = panelAccessScope(accessMode);
  // Empty scope is the seat-grounded default ("All permitted") — only pin when a focus is chosen.
  if (scoped) view_filter.scope_urns = [...(scopeUrns as string[])];
  return { view_filter };
}

/* -------------------------------------------------------------------------- */
/* Focus options — the spine nodes the current frame offers to focus on       */
/* -------------------------------------------------------------------------- */

export interface FocusOption {
  urn: string;
  label: string;
  group: string;
}

const FOCUS_TYPE_GROUPS: Record<string, string> = {
  manifold: "manifold",
  group: "groups",
  session: "workspaces",
  channel: "channels",
};

/**
 * Focusable spine nodes from the CURRENT frame plus the permitted workspaces from
 * provenance (which may not be rendered as nodes under a narrow lens). Grouped
 * manifold → groups → workspaces → channels.
 */
export function collectFocusOptions(
  frame: HgFrame | null,
  permittedWorkspaces: string[],
): FocusOption[] {
  const seen = new Set<string>();
  const out: FocusOption[] = [];
  const push = (urn: string, group: string) => {
    if (seen.has(urn)) return;
    seen.add(urn);
    out.push({ urn, label: urn.split(":").pop() || urn, group });
  };
  for (const n of Array.isArray(frame?.nodes) ? frame!.nodes : []) {
    const group = FOCUS_TYPE_GROUPS[n.type_id];
    if (group) push(n.urn, group);
  }
  for (const u of permittedWorkspaces) push(u, "workspaces");
  const order = ["manifold", "groups", "workspaces", "channels"];
  return out.sort(
    (a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.label.localeCompare(b.label),
  );
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export interface GraphControlsProps {
  search: string;
  onSearchChange: (value: string) => void;
  /** A short hint under the search box (e.g. "no match", "3 matches"). */
  searchHint?: string | null;

  /** The full slice spec (lens + types + ports + t + hops). */
  spec: SliceSpec;
  /** Lens tap: parent sets spec to the lens's types/ports (or keeps custom edits). */
  onLensChange: (lensId: string) => void;
  /**
   * t342 P6: `all` is the drawer's expand-from-all base for this frame — pass it on to
   * specToggleType / specTogglePort.
   */
  onToggleType: (type: string, all: readonly string[]) => void;
  onTogglePort: (port: string, all: readonly string[]) => void;
  onTChange: (value: string) => void;
  onHopsChange: (hops: number) => void;
  onApplyFilter: () => void;
  onResetFilter: () => void;
  /** Whether the current frame is a live read (view_filter is honored). */
  filterHonored: boolean;

  /** FOCUS (scope). Options from collectFocusOptions; "" = All permitted. */
  focusOptions: FocusOption[];
  activeScope: string;
  onScopeChange: (scopeUrn: string) => void;
  /** The currently-selected node urn, offered as a one-tap focus target. */
  selectedUrn: string | null;

  /**
   * Access posture (A3). DEFAULT "anon". The toggle sends ONLY view_filter.access.mode; the
   * identity (user/workstation/role) is resolved by the worker from chrome.storage.local and
   * is unreachable here. Changing it re-requests the frame under the new posture.
   */
  accessMode: AccessPosture;
  onAccessModeChange: (mode: AccessPosture) => void;

  /** Whether a trusted identity is stored — drives the "open Settings" hint, nothing else. */
  identitySet: boolean;

  /** Inline-graph visibility (t264: OFF by default; mirrors carry the picture). */
  showGraph: boolean;
  onToggleGraphVisible: () => void;
  /**
   * Staged advanced-drawer edits (types/ports/t) that have NOT been applied yet.
   * Drives the Apply button's pending marker so a one-value axis change (lens / focus /
   * hops / posture) never silently commits them without the user noticing.
   */
  dirty?: boolean;
  /**
   * t342 P6: the current frame — its engine grammar and permitted-fold vocabulary feed the
   * drawer's extra groups (drawerVocab). Absent or without a grammar: static lists only.
   */
  frame?: HgFrame | null;
}

export function GraphControls({
  search,
  onSearchChange,
  searchHint,
  spec,
  onLensChange,
  onToggleType,
  onTogglePort,
  onTChange,
  onHopsChange,
  onApplyFilter,
  onResetFilter,
  filterHonored,
  focusOptions,
  activeScope,
  onScopeChange,
  selectedUrn,
  accessMode,
  onAccessModeChange,
  identitySet,
  showGraph,
  onToggleGraphVisible,
  dirty = false,
  frame = null,
}: GraphControlsProps) {
  const identified = accessMode === "identified";
  // t342 P6: the drawer's groups for this frame — static lists + what the engine declares.
  const vocab = drawerVocab(frame?.provenance?.grammar, frame?.provenance?.fold_vocab);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const typeSet = new Set(spec.types);
  const allTypes = typeSet.has("*");
  const portSet = new Set(spec.ports);
  const allPorts = portSet.size === 0;
  // The focus select must always DISPLAY the actual focus (Copilot #21 catch): a
  // "focus selection" target or a focus that dropped out of the spine options
  // (lens/posture change) gets a synthetic "(focused)" entry rather than the select
  // silently falling back to "All permitted" while the request stays pinned.
  const displayOptions =
    activeScope && !focusOptions.some((o) => o.urn === activeScope)
      ? [
          { urn: activeScope, label: activeScope.split(":").pop() || activeScope, group: "(focused)" },
          ...focusOptions,
        ]
      : focusOptions;
  const scopeValue = displayOptions.some((o) => o.urn === activeScope) ? activeScope : "";
  const groups = [...new Set(displayOptions.map((o) => o.group))];

  // t337: the knowledge lens selects ONE type — "1 type", not "1 types".
  const stateEcho = `${allTypes ? "all" : spec.types.length} type${
    !allTypes && spec.types.length === 1 ? "" : "s"
  } · ${allPorts ? "all" : spec.ports.length} port${
    !allPorts && spec.ports.length === 1 ? "" : "s"
  } · t ${spec.t.trim() === "" ? "latest" : spec.t.trim()} · ${spec.hops} hop${spec.hops > 1 ? "s" : ""}`;

  return (
    <div className="graph-controls" aria-label="Slice controls">
      <div className="gc-row gc-access-row">
        <span className="gc-label" title="Access posture — DEFAULT anon. Sends only the posture; the identity is resolved by the service worker from chrome.storage.local (page-inaccessible).">
          access
        </span>
        <div
          className="gc-access-toggle"
          role="group"
          aria-label="Access posture (default anon)"
        >
          <button
            type="button"
            className={`gc-seg ${!identified ? "is-on" : ""}`}
            data-testid="access-anon"
            aria-pressed={!identified}
            onClick={() => onAccessModeChange("anon")}
            title="Stay anon — see only public workspaces (the default, fail-closed)"
          >
            Stay anon
          </button>
          <button
            type="button"
            className={`gc-seg ${identified ? "is-on" : ""}`}
            data-testid="access-identified"
            aria-pressed={identified}
            onClick={() => onAccessModeChange("identified")}
            title="Bring me in — resolve my trusted identity (worker-only) and show my permitted workspaces"
          >
            Bring me in
          </button>
        </div>
        <button
          type="button"
          className={`gc-seg gc-graph-toggle ${showGraph ? "is-on" : ""}`}
          data-testid="graph-inline-toggle"
          aria-pressed={showGraph}
          onClick={onToggleGraphVisible}
          title={
            showGraph
              ? "Hide the inline graph (the PiP / pop-out / full-tab mirrors keep showing it; selection stays synced)"
              : "Show the graph inline in this panel (it also lives in the PiP / pop-out / full-tab mirrors)"
          }
        >
          {showGraph ? "graph: inline" : "graph: mirrors"}
        </button>
      </div>

      {identified && !identitySet && (
        <div className="gc-identity-hint" role="note">
          no identity set — open Settings to pick one, or you stay anon
        </div>
      )}

      {/* WHAT — the lens row. One tap per stratum; custom when the drawer deviates. */}
      <div className="gc-row gc-lens-row" role="group" aria-label="Lens">
        {LENSES.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`gc-seg gc-lens ${spec.lens === l.id ? "is-on" : ""}`}
            data-testid={`lens-${l.id}`}
            aria-pressed={spec.lens === l.id}
            onClick={() => onLensChange(l.id)}
            title={l.title}
          >
            {l.label}
          </button>
        ))}
        {spec.lens === CUSTOM_LENS_ID && (
          <span className="gc-lens-custom" title="The advanced selection deviates from every preset.">
            custom
          </span>
        )}
      </div>

      {/* WHERE — focus + hops. */}
      <div className="gc-row gc-filter-scope">
        <label className="gc-field gc-scope-field">
          <span className="gc-label">focus</span>
          <select
            className="gc-select gc-scope-select"
            value={scopeValue}
            onChange={(e) => onScopeChange(e.target.value)}
            title="Focus the slice on one spine node (manifold / group / workspace / channel), expanded `hops` steps out along the retained relations. All permitted = no focus."
          >
            <option value="">All permitted</option>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {displayOptions
                  .filter((o) => o.group === g)
                  .map((o) => (
                    <option key={o.urn} value={o.urn} title={o.urn}>
                      {o.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="gc-field">
          <span className="gc-label">hops</span>
          <select
            className="gc-select gc-hops-select"
            value={String(spec.hops)}
            onChange={(e) => onHopsChange(Number(e.target.value))}
            title="How many relation steps out from the focus to include (BFS along the retained ports)."
          >
            {[1, 2, 3, 4].map((h) => (
              <option key={h} value={String(h)}>
                {h}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="gc-btn gc-btn-ghost gc-focus-sel"
          data-testid="focus-selection"
          disabled={!selectedUrn}
          onClick={() => selectedUrn && onScopeChange(selectedUrn)}
          title={
            selectedUrn
              ? `Focus the slice on the selected node (${selectedUrn})`
              : "Select a node first (graph or log feed), then focus on it"
          }
        >
          focus selection
        </button>
      </div>

      <div className="gc-row">
        <label className="gc-field gc-search">
          <span className="gc-label">find</span>
          <input
            className="gc-input"
            type="search"
            data-testid="find"
            value={search}
            placeholder="urn, label or text…"
            onChange={(e) => onSearchChange(e.target.value)}
            title={
              "Applies as you type: select + center the best node matching this urn or label — " +
              "or, failing those, its text (label / title / name / text / pointer). Every node " +
              "that does not match fades in the graph; the match's own relations and their " +
              "other ends stay lit and are brought into view; clear the box to bring the rest back."
            }
          />
        </label>
        <button
          type="button"
          className="gc-btn gc-btn-ghost gc-reset"
          data-testid="reset"
          onClick={onResetFilter}
          title="Back to the opening view: the everything lens, no focus, 1 hop, latest t"
        >
          Reset
        </button>
      </div>

      {search.trim() !== "" && searchHint && (
        <div className="gc-hint">{searchHint}</div>
      )}

      {/* Advanced — the raw degrees of freedom behind the lens. */}
      <details
        className="gc-filter"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary
          className="gc-filter-summary"
          title="The raw view_filter axes. Every control in this block — posture, lens, focus, hops, t — composes the view_filter this frame was read under; the audit drawer echoes it verbatim."
        >
          view_filter <span className="gc-filter-sub">· advanced</span>{" "}
          <span className="gc-filter-state">
            {stateEcho}
            {dirty && " · staged edits — open to apply"}
          </span>
        </summary>
        <div className="gc-filter-body">
          {/* t342 PIL-7: Apply sits with what it applies — the staged edits of this drawer (the
              type and port ticks, and the t bound below). `find` needs no Apply: it works as
              you type, so Apply no longer stands beside it. */}
          <div className="gc-row gc-apply-row">
            <label className="gc-field">
              <span className="gc-label">t_day ≤</span>
              <input
                className="gc-input gc-t-input"
                type="number"
                data-testid="t-day"
                value={spec.t}
                placeholder="(all)"
                onChange={(e) => onTChange(e.target.value)}
                title={
                  "Drops nodes whose own `t_day` PROPERTY exceeds this value. It is NOT a fold-at-t " +
                  "time machine: nodes that carry no t_day are unaffected, and on a typical fold that " +
                  "is the large majority of them, so a bound can change nothing at all. A true time " +
                  "bound would replay the log to a sequence (GET /fold?to=<log_seq>) — not connected to " +
                  "this control. Blank = no bound. Staged until Apply."
                }
              />
            </label>
            <button
              type="button"
              className={`gc-btn${dirty ? " is-dirty" : ""}`}
              data-testid="apply"
              onClick={onApplyFilter}
              title={
                dirty
                  ? "Staged type/port/t edits are not in the frame yet — Apply to re-request"
                  : "Re-request the frame under the current slice (the ticks and the t bound here are staged until applied)"
              }
            >
              Apply{dirty ? " •" : ""}
            </button>
          </div>
          <div className="gc-adv-note">
            node types {allTypes && <em>(everything — untick to narrow)</em>}
          </div>
          <div
            className={`gc-adv-note gc-vocab-note${vocab.source === "engine" ? "" : " is-static"}`}
            title="t342: the groups after the static ones are read from the connected engine at run time (/operad/node-types, /operad/rewrite-categories) and from the permitted fold; none of them is written into the pilot."
          >
            {vocab.note}
          </div>
          {vocab.typeGroups.map((g) => (
            <div key={g.label} className="gc-types gc-type-group" title={g.title}>
              <span className="gc-group-label">{g.label}</span>
              {g.types.map((ty) => (
                <label key={ty} className="gc-check" title={ty}>
                  <input
                    type="checkbox"
                    checked={allTypes || typeSet.has(ty)}
                    onChange={() => onToggleType(ty, vocab.allTypes)}
                  />
                  <span>{ty}</span>
                </label>
              ))}
            </div>
          ))}
          <div className="gc-adv-note">
            relation ports {allPorts && <em>(everything — untick to narrow)</em>}
          </div>
          {vocab.portGroups.map((g) => (
            <div key={g.label} className="gc-types gc-type-group" title={g.title}>
              <span className="gc-group-label">{g.label}</span>
              {g.ports.map((p) => (
                <label key={p} className="gc-check" title={p}>
                  <input
                    type="checkbox"
                    checked={allPorts || portSet.has(p)}
                    onChange={() => onTogglePort(p, vocab.allPorts)}
                  />
                  <span>{p}</span>
                </label>
              ))}
            </div>
          ))}
          {!filterHonored && (
            <div className="gc-note">
              Mock frame — the slice is inert until a live engine read.
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
