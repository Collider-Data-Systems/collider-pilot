/**
 * Collider Pilot - Cytoscape frame inspector
 * ==========================================
 * Renders the projected frame. Cytoscape is bundled locally (npm dep, not CDN).
 *
 * TRANSLATION DISCIPLINE (#158):
 *   - Cytoscape's internal API calls binary connections "edges". That word stays
 *     inside this file. Everywhere the user reads text, they are "relations"
 *     (see the legend + NodeInspector).
 *   - Node ids ARE the URNs (stable semantic ids) — never synthetic ids.
 *   - Layout coordinates and selection are browser scratch: positions come from the
 *     layout run and live only in the Cytoscape instance; selection is lifted to
 *     React state / chrome.storage.session. Neither is written back into node data.
 *
 * KNOWLEDGE DRAWING (t337): relation colour / dash / width, the relation that NESTS and
 * the claim-kind colours are READ from the Lean-emitted vocabulary through
 * `src/ui/kb-vocab.js` — no port name and no vocabulary colour is restated here. A frame
 * without knowledge relations keeps its layout, its relation styles and Cytoscape's drag
 * behaviour. What every frame got is the bar under the canvas, and a `fit` that always
 * fits (the 0.2 zoom floor used to cut a wide frame off in a narrow panel).
 *
 * WHOLE-FOLD DRAWING (t342, Sam: "I need the view not narrowed at opening"): the panel now
 * opens on every node, so two things keep that first picture readable. Node and relation
 * labels are cut below a zoom step at or under LABEL_ZOOM — 0.5 at 100 % and 200 % display
 * scaling, 0.8 at 125 %, 0.67 at 150 % (labelFloor says why) — while box titles draw at every
 * zoom and the selection, `find` matches and the hovered node keep a label enlarged to stay
 * readable (EXEMPT_LABELS). The nodes no relation of the frame touches sit in one band under
 * the linked drawing — the `unlinked N` chip in the bar hides or shows it.
 *
 * PORT COLOUR (t342 P1, decision 2): by default every relation END is coloured by κ(port),
 * the colour family the engine's `/operad/port-colors` gives it — one hue when both ends
 * share a family, two tones when they do not; exempt, uncoloured and undeclared-pair ends
 * carry glyphs, never a hue (src/ui/port-colour.js). κ comes from the frame's grammar, read
 * from the engine at run time; nothing of it is written here. The legend's "colour by" switch
 * goes back to the RELATION KIND palette — the knowledge vocabulary's colours and the default
 * line — which is also what a frame without an engine grammar draws, and the legend says so.
 * Node fills stay the type palette, which shares no colour with the eight κ hues.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { EngineGrammar, HgFrame, HgNode } from "../mcp/types";
import type { GraphLayoutName } from "../state/prefs";
import { DEFAULT_GRAPH_LAYOUT } from "../state/prefs";
import {
  KB_CLAIM_KINDS,
  KB_NESTING_PORT,
  KB_PORTS,
  isKbPort,
  kbClaimKindColor,
  kbConversePort,
  kbPortStyle,
  kbRelation,
  KB_VOCAB_VERSION,
} from "../ui/kb-vocab.js";
import {
  KAPPA_NEUTRAL,
  KAPPA_STATES,
  UNDECLARED_MARKER,
  hasPortColours,
  kappaCensus,
  kappaRelationData,
  kappaFamilies,
  paintRelation,
} from "../ui/port-colour.js";
import { grammarGap, grammarSummary } from "../mcp/engine-grammar.js";

/** t342 P1 (decision 2): the relation palette — port colour (the default) or relation kind. */
export type RelationPalette = "port" | "kind";

// t264: the slice can now render EVERY fold type (lenses/advanced) — color the spine
// and content families distinctly; anything unlisted gets the neutral default.
const TYPE_COLOR: Record<string, string> = {
  // content
  knowledge_item: "#6366f1",
  derivation: "#22c55e",
  purpose: "#eab308",
  session: "#38bdf8",
  program: "#a855f7",
  grammar_fragment: "#8b5cf6",
  domain_tag: "#64748b",
  // t337: `claim` is the colour of a claim WITHOUT a vocabulary kind — one with a kind
  // takes that kind's colour from the vocabulary (see STYLE).
  claim: "#ec4899",
  classification_scheme: "#f59e0b",
  // principals (A1)
  user: "#f97316",
  group: "#fb923c",
  agent: "#f43f5e",
  role: "#fda4af",
  manifold: "#facc15",
  // places
  kernel: "#14b8a6",
  workstation: "#0ea5e9",
  router: "#2dd4bf",
  channel: "#84cc16",
  twin_link: "#5eead4",
  endpoint: "#67e8f9",
};
const DEFAULT_COLOR = "#a0a0b0";
/**
 * t342 P1: every colour a node is filled with by type (claims add their vocabulary kind
 * colours). `smoke:lens` H holds these apart from the eight κ hues of the relation ends.
 */
export const NODE_FILLS: readonly string[] = [...Object.values(TYPE_COLOR), DEFAULT_COLOR];
/** The default relation line colour (also the legend swatch of a non-vocabulary port). */
const RELATION_COLOR = "#3a3a48";

// Semantic concentric ranking: identity/topology anchors read best toward the center,
// content on the rim (higher = closer to center). A degree fallback keeps unknown
// types sensible.
const TYPE_RANK: Record<string, number> = {
  manifold: 7,
  group: 6,
  user: 6,
  purpose: 4,
  session: 3,
  kernel: 3,
  workstation: 3,
  channel: 2,
  agent: 2,
  derivation: 2,
  knowledge_item: 1,
};

/** A layout that is actually drawn — `auto` is a choice, never a drawing (t337). */
type DrawnLayout = Exclude<GraphLayoutName, "auto">;

// The zoom floor — until a fit needs less (t337): a packed hierarchy, or a wide lens in a
// narrow panel, does not fit at 0.2, and then the floor drops to what the fit needs
// (see fitShown), so `fit` always shows everything.
const MIN_ZOOM = 0.2;
const FIT_PADDING = 16;
// t337: the zoom at which a label can be read (9 px text is 9 px on screen), and the step
// of the bar's zoom buttons.
const READ_ZOOM = 1;
const ZOOM_STEP = 1.5;
// t342: the zoom under which a 9 px label is a smear — on a whole-fold fit it buried the
// drawing. Cytoscape can only cut at zoom 2^k / devicePixelRatio, so the cut falls at the last
// such step at or below this: 0.5 at 100 % and 200 % display scaling (see labelFloor).
const LABEL_ZOOM = 0.9;
// t342: the plain label sizes, shared by STYLE and the enlarged exempt labels (labelBase).
const NODE_FONT = 9;
const BOX_FONT = 10;
const RELATION_FONT = 8;
const NODE_LABEL_WIDTH = 90;
const SOURCE_LABEL_WIDTH = 230;

/**
 * t342: the `min-zoomed-font-size` that hides a `fontPx` label at and under the cut (labelCut),
 * the zoom step nearest below LABEL_ZOOM. Built in, so it costs nothing per frame.
 * Cytoscape compares it with the font size times the TEXTURE
 * scale, 2^ceil(log2(zoom × devicePixelRatio)), not with the zoom itself, so the cut can only
 * fall at zoom 2^k / devicePixelRatio: this takes the last such step at or below LABEL_ZOOM
 * (0.5 at 100 % and 200 % display scaling, 0.8 at 125 %, 0.67 at 150 %). A label therefore
 * always draws at READ_ZOOM.
 */
function labelFloor(fontPx: number) {
  return (ele: cytoscape.NodeSingular | cytoscape.EdgeSingular): number =>
    fontPx * 2 ** (Math.floor(Math.log2(LABEL_ZOOM * pixelRatio(ele.cy()))) + 1);
}

/** The display scaling of the window the canvas lives in (a Document PiP has its own). */
function pixelRatio(cy: cytoscape.Core): number {
  return cy.container()?.ownerDocument.defaultView?.devicePixelRatio || 1;
}

/** t342: the zoom at and under which labelFloor hides a label (0.5 at 100 % scaling). */
function labelCut(cy: cytoscape.Core): number {
  const ratio = pixelRatio(cy);
  return 2 ** Math.floor(Math.log2(LABEL_ZOOM * ratio)) / ratio;
}

/**
 * t342 EXEMPT LABELS: the selection, a `find` match (class `found`) and the node under the
 * pointer (class `hovered`) keep their label below the cut. At the side panel's fit of the
 * whole fold (zoom about 0.05) a 9 px label is half a pixel, so below the cut these are also
 * ENLARGED with the zoom to stay 9 to 13 px on screen. The factor moves in half-octave steps,
 * so a zoom gesture restyles a handful of times, not every frame; above the cut it is 1.
 *   - Layout and fit measure every label at its plain size (withPlainLabels), so an enlarged
 *     label never moves the packing or widens the fit.
 *   - While it is above 1 a box is sized around its nodes without their labels — the other
 *     labels are not drawn then, and an enlarged one would otherwise swell its box.
 */
const EXEMPT_LABELS = "node:selected, node.found, node.hovered, edge:selected";
// cy.scratch keys: the current enlargement, and "a layout or fit is measuring".
const EXEMPT_SCALE = "pilotExemptScale";
const LABELS_PLAIN = "pilotLabelsPlain";

function exemptScaleAt(cy: cytoscape.Core, zoom: number): number {
  return zoom > labelCut(cy) ? 1 : 2 ** (Math.ceil(2 * Math.log2(READ_ZOOM / zoom)) / 2);
}

function exemptScale(cy: cytoscape.Core): number {
  const k: unknown = cy.scratch(EXEMPT_SCALE);
  return typeof k === "number" ? k : 1;
}

function setExemptScale(cy: cytoscape.Core, k: number): void {
  if (exemptScale(cy) === k) return;
  cy.scratch(EXEMPT_SCALE, k);
  // `eles.updateStyle()` (Cytoscape 3, missing from @types/cytoscape) re-runs the style of
  // just these elements and the boxes (see EXEMPT_LABELS).
  const restyle = cy.elements(EXEMPT_LABELS).union(cy.nodes(":parent"));
  (restyle as unknown as { updateStyle(): void }).updateStyle();
}

/** Enlarge the exempt labels for the current zoom — unless a layout or fit is measuring. */
function followZoom(cy: cytoscape.Core): void {
  if (cy.scratch(LABELS_PLAIN) !== true) setExemptScale(cy, exemptScaleAt(cy, cy.zoom()));
}

/** Run a measurement (layout, fit, readZoom) with every label at its plain size. */
function withPlainLabels<T>(cy: cytoscape.Core, run: () => T): T {
  const outer = cy.scratch(LABELS_PLAIN) === true;
  cy.scratch(LABELS_PLAIN, true);
  setExemptScale(cy, 1);
  try {
    return run();
  } finally {
    if (!outer) {
      cy.scratch(LABELS_PLAIN, false);
      followZoom(cy);
    }
  }
}

/** An element's plain label font and wrap width, as STYLE sets them. */
function labelBase(ele: cytoscape.NodeSingular | cytoscape.EdgeSingular): { font: number; width: number } {
  if (ele.isEdge()) return { font: RELATION_FONT, width: NODE_LABEL_WIDTH };
  if (ele.isParent()) return { font: BOX_FONT, width: NODE_LABEL_WIDTH };
  return {
    font: NODE_FONT,
    width: ele.hasClass("source-column") ? SOURCE_LABEL_WIDTH : NODE_LABEL_WIDTH,
  };
}

/**
 * Per-layout Cytoscape options. All layouts ship in cytoscape core (no new dep). Every
 * one is `animate:false` (deterministic, snappy on a narrow panel) with consistent
 * padding. `concentric` is the default — it lays the DAG-ish frame out in semantic rings
 * and eliminates the cose label-overlap on a narrow side panel. (`nested` is not a
 * cytoscape layout: see runNestedLayout.)
 */
function layoutOptions(name: DrawnLayout): cytoscape.LayoutOptions {
  const base = { animate: false as const, padding: 12, fit: true };
  switch (name) {
    case "breadthfirst":
      // Directed BFS tree — follows relation direction; good for provenance chains.
      return { name: "breadthfirst", directed: true, spacingFactor: 1.1, ...base };
    case "grid":
      return { name: "grid", avoidOverlap: true, ...base };
    case "concentric":
    default:
      return {
        name: "concentric",
        minNodeSpacing: 24,
        // Rank rings by node type (fall back to raw degree for untyped nodes).
        concentric: (node: cytoscape.NodeSingular) =>
          TYPE_RANK[String(node.data("type_id"))] ?? node.degree(false),
        levelWidth: () => 1,
        ...base,
      };
  }
}

// Defensive: a frame delivered via the worker message channel or restored from
// stale scratch may be missing an array. Never let a bad shape reach Cytoscape
// (whose init throws a "non-array … Symbol.iterator" TypeError on non-arrays).
const nodesOf = (frame: HgFrame | null) => (Array.isArray(frame?.nodes) ? frame.nodes : []);
const relationsOf = (frame: HgFrame | null) =>
  Array.isArray(frame?.relations) ? frame.relations : [];

/**
 * t337 NESTING. The vocabulary names the one relation that nests (KB_NESTING_PORT): its
 * source is drawn INSIDE its target, as a box, instead of as a line. A node gets ONE box.
 * When it has several targets the field/topic wins over the module (domain_tag, then
 * program — as kb-view does); a target of any other type — the classification_scheme
 * included — is never a box, and that relation stays a line.
 */
const NEST_PARENT_RANK: Record<string, number> = { domain_tag: 2, program: 1 };

/** Which box each node is drawn inside: node urn -> parent urn (empty = nothing nests). */
export function nestingParents(frame: HgFrame | null): Map<string, string> {
  const parents = new Map<string, string>();
  if (!KB_NESTING_PORT) return parents;
  const typeOf = new Map(nodesOf(frame).map((n) => [n.urn, n.type_id]));
  const rankOf = new Map<string, number>();
  for (const r of relationsOf(frame)) {
    if (r.label !== KB_NESTING_PORT || r.source_urn === r.target_urn) continue;
    if (!typeOf.has(r.source_urn)) continue;
    const rank = NEST_PARENT_RANK[typeOf.get(r.target_urn) ?? ""] ?? 0;
    if (!rank) continue;
    const prevRank = rankOf.get(r.source_urn) ?? 0;
    // Equal rank: the smaller urn wins, so the box does not depend on the order the
    // engine returned its relations in (REST /fold order differs per request).
    if (rank > prevRank || (rank === prevRank && r.target_urn < parents.get(r.source_urn)!)) {
      parents.set(r.source_urn, r.target_urn);
      rankOf.set(r.source_urn, rank);
    }
  }
  // A cycle (a inside b inside a) cannot be drawn as boxes: cut it; the line remains.
  for (const start of [...parents.keys()].sort()) {
    const seen = new Set<string>();
    for (let at = parents.get(start); at !== undefined && !seen.has(at); at = parents.get(at)) {
      if (at === start) {
        parents.delete(start);
        break;
      }
      seen.add(at);
    }
  }
  return parents;
}

/**
 * The layout actually drawn for a layout choice on this frame (t337). An explicit choice
 * is always honoured. `auto` — no explicit choice — is `nested` when the frame has
 * nesting relations that draw a box, and `concentric` (the previous default) otherwise.
 */
export function resolveGraphLayout(layout: GraphLayoutName, frame: HgFrame | null): DrawnLayout {
  if (layout !== "auto") return layout;
  return nestingParents(frame).size > 0 ? "nested" : "concentric";
}

/**
 * t342 UNLINKED: the nodes of this frame that no relation of this frame touches (a relation
 * counts when both its ends are in the frame). They are laid out in one band of their own
 * under the linked drawing, not interleaved in its grid. A node can be linked in the whole
 * fold and unlinked here, when the lens, focus or access posture left out its neighbours.
 */
export function unlinkedUrns(frame: HgFrame | null): Set<string> {
  const urns = new Set(nodesOf(frame).map((n) => n.urn));
  const linked = new Set<string>();
  for (const r of relationsOf(frame)) {
    if (!urns.has(r.source_urn) || !urns.has(r.target_urn)) continue;
    linked.add(r.source_urn);
    linked.add(r.target_urn);
  }
  return new Set([...urns].filter((urn) => !linked.has(urn)));
}

/** A claim's `kind` when the vocabulary declares it (the only kinds that carry a colour). */
function claimKind(node: HgNode): string | null {
  const kind = node.type_id === "claim" ? node.properties?.kind : null;
  return typeof kind === "string" && kbClaimKindColor(kind) ? kind : null;
}

/** The legend's name for a node kind: its type, plus the claim kind when it has one. */
const nodeKindKey = (typeId: string, kind?: string | null) =>
  kind ? `${typeId} · ${kind}` : typeId;

/** Exported (t342 P1 review) so the smokes draw exactly these elements with STYLE. */
export function toElements(
  frame: HgFrame,
  parents: Map<string, string>,
  unlinked: ReadonlySet<string>,
): cytoscape.ElementDefinition[] {
  const frameNodes = nodesOf(frame);
  // t337: in a drawing with boxes, a drag that starts on a box or on a relation line pans
  // the view, as on the background. Zoomed in to read, boxes and lines cover the canvas:
  // a drag moved a box with everything in it, or did nothing. A drawing without boxes
  // keeps Cytoscape's defaults.
  const boxes = new Set(parents.values());
  const nodes: cytoscape.ElementDefinition[] = frameNodes.map((n) => {
    const kind = claimKind(n);
    const parent = parents.get(n.urn);
    return {
      group: "nodes",
      // Node id === URN (stable semantic id). Only semantic fields go in data — plus, since
      // t337, the two things styling needs: a claim's vocabulary kind and the node's box.
      data: {
        id: n.urn,
        label: n.label,
        type_id: n.type_id,
        ...(kind ? { kind } : {}),
        ...(parent ? { parent } : {}),
      },
      ...(boxes.has(n.urn) ? { grabbable: false, pannable: true } : {}),
      // t342: a class, not data — it places the node in the unlinked band.
      ...(unlinked.has(n.urn) ? { classes: "unlinked" } : {}),
    };
  });
  // Cytoscape "edges" == mo:os relations. Guard against dangling endpoints.
  const nodeUrns = new Set(frameNodes.map((n) => n.urn));
  // t342 P1: each end's κ hue and glyph, and the pair state, from the frame's engine grammar
  // (port-colour.js). Carried on every drawn relation; the `kappa` class decides whether they draw.
  const grammar = frame.provenance?.grammar;
  const edges: cytoscape.ElementDefinition[] = relationsOf(frame)
    .filter((r) => nodeUrns.has(r.source_urn) && nodeUrns.has(r.target_urn))
    // t337: a nesting relation the box already shows is not drawn again as a line.
    .filter((r) => !(r.label === KB_NESTING_PORT && parents.get(r.source_urn) === r.target_urn))
    .map((r) => ({
      group: "edges",
      data: {
        id: r.urn,
        source: r.source_urn,
        target: r.target_urn,
        label: r.label,
        type_id: r.type_id,
        ...(kappaRelationData(paintRelation(r, grammar)) ?? {}),
      },
      ...(boxes.size > 0 ? { pannable: true } : {}),
    }));
  return [...nodes, ...edges];
}

/**
 * What decides a rebuild + relayout (t337): the SET of node and relation ids, each
 * relation's ends and each node's box. Order-independent, so a re-read that returns the
 * same fold in another order — or with other property values — is not a new drawing.
 */
function structureKey(elements: cytoscape.ElementDefinition[]): string {
  return elements
    .map(({ group, data }) =>
      group === "nodes"
        ? `${data.id}\t${data.parent ?? ""}`
        : `${data.id}\t${data.source}\t${data.target}`,
    )
    .sort()
    .join("\n");
}

/** t342 P1: the relation data the port-colour style reads (port-colour.js kappaRelationData). */
const KAPPA_KEYS = ["ks", "kt", "kss", "kts", "kpair"];

/** Update the data styling reads, in place — no element is added, removed or moved. */
function syncData(cy: cytoscape.Core, el: cytoscape.ElementDefinition): void {
  const ele = cy.getElementById(String(el.data.id));
  if (ele.empty()) return;
  // t342 P1: the κ data too — a re-read under another grammar recolours in place.
  const keys = el.group === "nodes" ? ["label", "type_id", "kind"] : ["label", "type_id", ...KAPPA_KEYS];
  for (const key of keys) {
    const next = el.data[key];
    if (ele.data(key) === next) continue;
    if (next === undefined) ele.removeData(key);
    else ele.data(key, next);
  }
}

interface LegendRelationRow {
  port: string;
  count: number;
  /** How many of them are shown as a box instead of a line. */
  boxed: number;
  /** t342 P1: the port-colour hues of the row's first relation (null: relation kind only). */
  ks: string | null;
  kt: string | null;
  /** t342 P1: how many of them sit on a pair the engine does not declare. */
  undeclared: number;
}
interface LegendNodeRow {
  key: string;
  count: number;
  color: string;
  /** This type draws at least one box in the current drawing. */
  box: boolean;
}

/**
 * The legend's rows, derived from what is ACTUALLY in the frame (never a hardcoded
 * list): every relation port and every node kind present, with counts. Ranked by count —
 * an alphabetical cut hid the dominant types under the wide lenses. A claim type is
 * listed per vocabulary kind, in vocabulary order.
 */
function legendOf(
  frame: HgFrame,
  parents: Map<string, string>,
): { relations: LegendRelationRow[]; nodes: LegendNodeRow[] } {
  const frameNodes = nodesOf(frame);
  const typeOf = new Map(frameNodes.map((n) => [n.urn, n.type_id]));
  const ports = new Map<string, LegendRelationRow>();
  const grammar = frame.provenance?.grammar;
  for (const r of relationsOf(frame)) {
    if (!typeOf.has(r.source_urn) || !typeOf.has(r.target_urn)) continue;
    const paint = kappaRelationData(paintRelation(r, grammar));
    const row =
      ports.get(r.label) ??
      { port: r.label, count: 0, boxed: 0, ks: paint?.ks ?? null, kt: paint?.kt ?? null, undeclared: 0 };
    row.count += 1;
    if (paint?.kpair === "undeclared") row.undeclared += 1;
    if (r.label === KB_NESTING_PORT && parents.get(r.source_urn) === r.target_urn) row.boxed += 1;
    ports.set(r.label, row);
  }
  const boxTypes = new Set([...parents.values()].map((urn) => typeOf.get(urn)));
  const byType = new Map<string, Map<string, number>>();
  for (const n of frameNodes) {
    const kinds = byType.get(n.type_id) ?? new Map<string, number>();
    const kind = claimKind(n) ?? "";
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    byType.set(n.type_id, kinds);
  }
  const total = (kinds: Map<string, number>) => [...kinds.values()].reduce((a, b) => a + b, 0);
  const kindOrder = (kind: string) => {
    const at = KB_CLAIM_KINDS.findIndex((k) => k.name === kind);
    return at < 0 ? KB_CLAIM_KINDS.length : at;
  };
  return {
    relations: [...ports.values()].sort(
      (a, b) => b.count - a.count || a.port.localeCompare(b.port),
    ),
    nodes: [...byType.entries()]
      .sort((a, b) => total(b[1]) - total(a[1]) || a[0].localeCompare(b[0]))
      .flatMap(([type, kinds]) =>
        [...kinds.entries()]
          .sort((a, b) => kindOrder(a[0]) - kindOrder(b[0]))
          .map(([kind, count]) => ({
            key: nodeKindKey(type, kind),
            count,
            color: kbClaimKindColor(kind) ?? TYPE_COLOR[type] ?? DEFAULT_COLOR,
            box: boxTypes.has(type),
          })),
      ),
  };
}

/**
 * t337: Cytoscape applies a class change lazily. Until it does, `:visible` and the label
 * boxes are still those of the PREVIOUS style — a legend row ticked back was laid out as
 * if it were still hidden, and a second `re-layout` gave another picture than the first.
 * Reading a style value applies the change now; a layout or a fit starts with this.
 */
function applyStyles(cy: cytoscape.Core): void {
  cy.elements().forEach((ele) => void ele.style("display"));
}

/**
 * t342: the key the `unlinked N` chip puts in the hidden kinds to hide the unlinked band —
 * no type or claim kind can be spelled this way. Riding with the legend's kinds, it gets
 * `show all` and the re-layout on showing again for free.
 */
const UNLINKED_KEY = "(unlinked)";

/**
 * Hide what the legend has unticked: nodes and relations `display: none`, a box only its own
 * outline and title (t342). Client-side only — no frame re-read.
 */
function applyHidden(
  cy: cytoscape.Core,
  hiddenPorts: ReadonlySet<string>,
  hiddenKinds: ReadonlySet<string>,
): void {
  const bandHidden = hiddenKinds.has(UNLINKED_KEY);
  cy.batch(() => {
    cy.nodes().forEach((n) => {
      n.toggleClass(
        "hidden",
        hiddenKinds.has(nodeKindKey(n.data("type_id"), n.data("kind"))) ||
          (bandHidden && n.hasClass("unlinked")),
      );
    });
    // A box that is hidden stays displayed (STYLE `:parent.hidden`), so its own relations
    // would still draw — hide every relation that touches a hidden node explicitly.
    cy.edges().forEach((e) => {
      e.toggleClass(
        "hidden",
        hiddenPorts.has(String(e.data("label"))) ||
          e.source().hasClass("hidden") ||
          e.target().hasClass("hidden"),
      );
    });
  });
}

// t337 NESTED LAYOUT geometry, in model px.
const PACK = {
  cellGapX: 14, // between two leaf cells of a box
  cellGapY: 10,
  pad: 16, // inside a box, around its content (the drawn box sits 12 in: STYLE `:parent`)
  title: 22, // room above a box's content for its title
  gap: 26, // between boxes, and between a box's own leaves and its sub-boxes
  minBox: 120,
  columnGap: 140, // between the packed boxes and the source column
  columnPitch: 4, // between two sources in the column
  bandGap: 60, // t342: between the linked drawing and the unlinked band under it
};
/** The node type that stands in the source column (the target of provenance relations). */
const SOURCE_TYPE = "knowledge_item";
// Candidate shapes [shelf width, leaf-grid aspect]. The first is kb-view's own; the rest
// let a narrow side panel and a wide tab each get the packing that fits them largest.
const PACK_SHAPES: [number, number][] = [2000, 1600, 1300, 1000, 800, 600, 2500, 3200, 4200].flatMap(
  (maxW) => [5, 8, 3, 1.8, 1].map((aspect): [number, number] => [maxW, aspect]),
);

interface Packed {
  w: number;
  h: number;
  place: (x0: number, y0: number, out: Map<string, cytoscape.Position>) => void;
}

/** A node's drawn box INCLUDING its label, and where its position sits inside that box. */
interface LabelBox {
  w: number;
  h: number;
  dx: number;
  dy: number;
}

function labelBox(n: cytoscape.NodeSingular): LabelBox {
  const bb = n.boundingBox({ includeLabels: true, includeOverlays: false });
  const at = n.position();
  return { w: bb.w, h: bb.h, dx: at.x - bb.x1, dy: at.y - bb.y1 };
}

/**
 * Nodes on a grid of equal-width cells, in the order given, each row as tall as its tallest
 * label — a box's own leaves (t337) and, since t342, the unlinked band. `colsFor` picks the
 * column count from the cell width and the mean row height.
 */
function cellGrid(
  nodes: cytoscape.NodeSingular[],
  sizeOf: (n: cytoscape.NodeSingular) => LabelBox,
  colsFor: (cellW: number, meanH: number) => number,
): Packed {
  const sizes = nodes.map(sizeOf);
  const cellW = Math.max(0, ...sizes.map((s) => s.w)) + PACK.cellGapX;
  const meanH = sizes.reduce((t, s) => t + s.h + PACK.cellGapY, 0) / (nodes.length || 1);
  const cols = Math.max(1, Math.min(nodes.length, colsFor(cellW, meanH)));
  const rowH: number[] = [];
  sizes.forEach((s, i) => {
    const r = Math.floor(i / cols);
    rowH[r] = Math.max(rowH[r] ?? 0, s.h + PACK.cellGapY);
  });
  return {
    w: nodes.length ? cols * cellW : 0,
    h: rowH.reduce((t, h) => t + h, 0),
    place(x0, y0, out) {
      let y = y0;
      nodes.forEach((n, i) => {
        const s = sizes[i];
        const c = i % cols;
        if (c === 0 && i > 0) y += rowH[Math.floor(i / cols) - 1];
        out.set(n.id(), { x: x0 + c * cellW + (cellW - s.w) / 2 + s.dx, y: y + s.dy });
      });
    },
  };
}

/** t342: the shown nodes of class `unlinked` (see toElements), type first, then urn. */
function shownUnlinked(cy: cytoscape.Core): cytoscape.NodeSingular[] {
  const key = (n: cytoscape.NodeSingular) => `${n.data("type_id")}\t${n.id()}`;
  return cy
    .nodes(".unlinked")
    .toArray()
    .filter((n) => n.visible())
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/**
 * t342 UNLINKED BAND: those nodes on one grid of their own, at least `minW` wide (the linked
 * drawing's width) and never narrower than square. It goes under the linked drawing; node
 * ids stay the urns and no box is made for it.
 */
function bandGrid(
  band: cytoscape.NodeSingular[],
  sizeOf: (n: cytoscape.NodeSingular) => LabelBox,
  minW: number,
): Packed {
  return cellGrid(band, sizeOf, (cellW) =>
    Math.floor(Math.max(minW, cellW * Math.ceil(Math.sqrt(band.length))) / cellW),
  );
}

/**
 * t337 NESTED layout — deterministic and packed, never simulated (ported from
 * kb-view.html's pack()/layout()). Each box lays its own leaves on a grid and its
 * sub-boxes below them in shelf rows; un-nested sources (knowledge_item) that a knowledge
 * relation ties to the packed nodes form a separate column, each at the mean height of
 * what it supports, so provenance lines run roughly level.
 *
 * Cells are sized from the MEASURED label boxes, so labels do not overlap inside a box,
 * and nodes are taken in urn order, so the same frame always packs the same way. Only
 * what is shown is packed: a re-layout after a legend untick closes the gaps.
 */
function runNestedLayout(cy: cytoscape.Core): void {
  type Node = cytoscape.NodeSingular;
  const byId = (a: Node, b: Node) => (a.id() < b.id() ? -1 : a.id() > b.id() ? 1 : 0);
  // Shown nodes of a collection, in urn order.
  const shownOf = (nodes: cytoscape.NodeCollection): Node[] =>
    nodes
      .toArray()
      .filter((n) => n.visible())
      .sort(byId);
  const isBox = (n: Node) => n.isParent() && shownOf(n.children()).length > 0;
  const loose = (n: Node) => n.data("type_id") === SOURCE_TYPE && n.isOrphan() && !n.isParent();
  // What a loose source supports: the packed nodes a knowledge relation ties it to.
  const supports = new Map<string, Node[]>();
  for (const n of shownOf(cy.nodes()).filter(loose)) {
    const tied = new Map<string, Node>();
    for (const e of n.connectedEdges().toArray()) {
      if (!e.visible() || !isKbPort(e.data("label"))) continue;
      for (const m of [e.source(), e.target()]) if (!loose(m)) tied.set(m.id(), m);
    }
    if (tied.size > 0) supports.set(n.id(), [...tied.values()]);
  }
  const column = shownOf(cy.nodes()).filter((n) => supports.has(n.id()));
  cy.batch(() => {
    cy.nodes().removeClass("source-column");
    for (const n of column) n.addClass("source-column");
  });

  applyStyles(cy); // the class just set changes the label box measured below

  // A node's drawn box INCLUDING its label, measured once per layout run.
  const sizes = new Map<string, LabelBox>();
  const measure = (n: Node) => {
    let size = sizes.get(n.id());
    if (!size) {
      size = labelBox(n);
      sizes.set(n.id(), size);
    }
    return size;
  };
  const titleWidth = (box: Node) =>
    box.boundingBox({ includeNodes: false, includeLabels: true, includeOverlays: false }).w;
  // t342: the unlinked nodes are not packed with the rest — they form the band under it.
  const unlinked = shownUnlinked(cy);

  const pack = (box: Node | null, maxW: number, subW: number, aspect: number): Packed => {
    const kids = shownOf(box ? box.children() : cy.nodes().orphans()).filter(
      (n) => !supports.has(n.id()) && !n.hasClass("unlinked"),
    );
    const leaves = kids.filter((n) => !isBox(n));
    const subs = kids
      .filter(isBox)
      .map((n) => pack(n, subW, subW, aspect))
      .sort((a, b) => b.h - a.h);
    // Own leaves: a grid of equal-width cells, each row as tall as its tallest label.
    const grid = cellGrid(leaves, measure, (cellW, meanH) =>
      Math.min(
        Math.floor(maxW / cellW),
        Math.round(Math.sqrt((leaves.length * aspect * meanH) / cellW)),
      ),
    );
    const leafW = grid.w;
    const leafH = grid.h;
    // Sub-boxes: shelf rows, tallest first.
    const rows: { w: number; h: number; items: Packed[] }[] = [];
    let row: { w: number; h: number; items: Packed[] } = { w: 0, h: 0, items: [] };
    for (const s of subs) {
      if (row.items.length && row.w + s.w > maxW) {
        rows.push(row);
        row = { w: 0, h: 0, items: [] };
      }
      row.items.push(s);
      row.w += s.w + PACK.gap;
      row.h = Math.max(row.h, s.h);
    }
    if (row.items.length) rows.push(row);
    const shelfW = Math.max(0, ...rows.map((r) => r.w - PACK.gap));
    const shelfH = rows.reduce((t, r) => t + r.h + PACK.gap, 0) - (rows.length ? PACK.gap : 0);
    // The box around them: room for its title on top, never narrower than that title.
    const inner = box ? PACK.pad : 0;
    const top = box ? PACK.title + PACK.pad : 0;
    const between = leafH && shelfH ? PACK.gap : 0;
    const contentW = Math.max(leafW, shelfW, box ? Math.max(PACK.minBox, titleWidth(box)) : 0);
    const indent = inner + (contentW - Math.max(leafW, shelfW)) / 2;
    return {
      w: contentW + 2 * inner,
      h: top + leafH + between + shelfH + inner,
      place(x0, y0, out) {
        grid.place(x0 + indent, y0 + top, out);
        let y = y0 + top + leafH + between;
        for (const r of rows) {
          let x = x0 + indent;
          for (const s of r.items) {
            s.place(x, y, out);
            x += s.w + PACK.gap;
          }
          y += r.h + PACK.gap;
        }
      },
    };
  };

  const arrange = (maxW: number, aspect: number) => {
    const out = new Map<string, cytoscape.Position>();
    const root = pack(null, maxW, maxW * 0.65, aspect);
    root.place(0, 0, out);
    let w = root.w;
    let h = root.h;
    // Where a supported node sits: its own place, or the middle of its box's content.
    const yOf = (m: Node): number | null => {
      const own = out.get(m.id());
      if (own) return own.y;
      const ys = m
        .descendants()
        .toArray()
        .flatMap((d) => out.get(d.id())?.y ?? []);
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
    };
    const x = root.w + PACK.columnGap;
    const wanted = column
      .map((n) => {
        const ys = (supports.get(n.id()) ?? []).flatMap((m) => yOf(m) ?? []);
        return { n, y: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0 };
      })
      .sort((a, b) => a.y - b.y);
    let next = 0;
    for (const { n, y } of wanted) {
      const s = measure(n);
      const topY = Math.max(y - s.h / 2, next);
      out.set(n.id(), { x: x + s.dx, y: topY + s.dy });
      next = topY + s.h + PACK.columnPitch;
      w = Math.max(w, x + s.w);
      h = Math.max(h, topY + s.h);
    }
    // t342: the unlinked band, under everything linked and at least as wide.
    const band = bandGrid(unlinked, measure, w);
    if (band.h > 0) {
      const y0 = h > 0 ? h + PACK.bandGap : 0;
      band.place(0, y0, out);
      w = Math.max(w, band.w);
      h = y0 + band.h;
    }
    return { out, w, h };
  };

  // Of the candidate shapes, keep the one that comes out LARGEST once fitted to this
  // container (the first — kb-view's — when the container has no size yet).
  const cw = cy.width();
  const ch = cy.height();
  let best: ReturnType<typeof arrange> | null = null;
  let bestScale = -Infinity;
  for (const [maxW, aspect] of PACK_SHAPES) {
    const candidate = arrange(maxW, aspect);
    const scale =
      cw > 0 && ch > 0 && candidate.w > 0 && candidate.h > 0
        ? Math.min(cw / candidate.w, ch / candidate.h)
        : 0;
    if (scale > bestScale) {
      best = candidate;
      bestScale = scale;
    }
  }
  const positions = best?.out ?? new Map<string, cytoscape.Position>();
  cy.batch(() => {
    positions.forEach((at, id) => {
      cy.getElementById(id).position(at);
    });
  });
}

/** The viewport a fit left behind — compared later to tell whether the user has moved it. */
interface FittedView {
  zoom: number;
  x: number;
  y: number;
}

/**
 * Fit everything shown into the view (t337). Cytoscape clamps a fit at the zoom floor and
 * then cuts nodes off, so the floor is lowered first when this fit needs less than MIN_ZOOM.
 */
function fitShown(cy: cytoscape.Core): FittedView {
  return withPlainLabels(cy, () => fitPlain(cy));
}

function fitPlain(cy: cytoscape.Core): FittedView {
  applyStyles(cy);
  const shown = cy.elements(":visible");
  const bb = shown.boundingBox();
  const needed = Math.min(
    (cy.width() - 2 * FIT_PADDING) / bb.w,
    (cy.height() - 2 * FIT_PADDING) / bb.h,
  );
  cy.minZoom(needed > 0 && needed < MIN_ZOOM ? needed : MIN_ZOOM);
  cy.fit(shown, FIT_PADDING);
  const pan = cy.pan();
  return { zoom: cy.zoom(), x: pan.x, y: pan.y };
}

/** Run the drawn layout over what is shown, then fit. */
function runLayout(cy: cytoscape.Core, drawn: DrawnLayout): FittedView {
  return withPlainLabels(cy, () => layoutPlain(cy, drawn));
}

function layoutPlain(cy: cytoscape.Core, drawn: DrawnLayout): FittedView {
  cy.resize(); // re-measure the container: the legend under the canvas may just have moved
  applyStyles(cy);
  if (drawn === "nested") runNestedLayout(cy);
  else {
    // t342: the ring / tree / grid draws the linked part; the unlinked band goes under it.
    const linked = cy.elements(":visible").not(".unlinked");
    if (linked.nonempty()) linked.layout(layoutOptions(drawn)).run();
    const bb = linked.nonempty()
      ? linked.boundingBox({ includeLabels: true, includeOverlays: false })
      : null;
    const out = new Map<string, cytoscape.Position>();
    bandGrid(shownUnlinked(cy), labelBox, bb ? bb.w : 0).place(
      bb ? bb.x1 : 0,
      bb ? bb.y2 + PACK.bandGap : 0,
      out,
    );
    cy.batch(() => out.forEach((at, id) => cy.getElementById(id).position(at)));
  }
  return fitShown(cy);
}

/**
 * Where an element can be read (t337): a node at READ_ZOOM or closer, never further out; a
 * box at the zoom its whole content fits, at most READ_ZOOM.
 */
function readZoom(cy: cytoscape.Core, el: cytoscape.NodeSingular): number {
  if (!el.isParent()) return Math.max(cy.zoom(), READ_ZOOM);
  // t342: a hovered or selected box's title is enlarged — measure it at its plain size.
  const bb = withPlainLabels(cy, () => el.boundingBox());
  return Math.min(
    READ_ZOOM,
    (cy.width() - 2 * FIT_PADDING) / bb.w,
    (cy.height() - 2 * FIT_PADDING) / bb.h,
  );
}

// Relation line width by the vocabulary's `emphasis` (0..2); a dashed relation is thin.
const KB_RELATION_WIDTH = [1.6, 2.4, 3];

// Type coloring via attribute selectors keeps color OUT of node data (derived, not
// stored). Base rule first; per-type rules have higher specificity and win.
/** Exported (t342 P1 review): `smoke:lens` H and `smoke:live` (i) draw headless with it. */
export const STYLE: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      "background-color": DEFAULT_COLOR,
      label: "data(label)",
      color: "#f0f0f5",
      "font-size": `${NODE_FONT}px`,
      // t342: no label below the cut (labelFloor) — the exceptions follow below.
      "min-zoomed-font-size": labelFloor(NODE_FONT),
      "text-wrap": "wrap",
      "text-max-width": `${NODE_LABEL_WIDTH}px`,
      "text-valign": "bottom",
      "text-margin-y": 4,
      width: 26,
      height: 26,
      "border-width": 2,
      "border-color": "#0f0f12",
    },
  },
  ...Object.entries(TYPE_COLOR).map(([type, color]) => ({
    selector: `node[type_id = "${type}"]`,
    style: { "background-color": color },
  })),
  // t337: a claim is coloured by its kind — names and colours from the vocabulary.
  ...KB_CLAIM_KINDS.map((k) => ({
    selector: `node[type_id = "claim"][kind = "${k.name}"]`,
    style: { "background-color": k.display },
  })),
  {
    // t337: a box (cytoscape compound parent) — outlined in its own type colour, with a
    // faint fill and its title on top. Only the `nested` layout creates boxes.
    selector: ":parent",
    style: {
      shape: "round-rectangle",
      "background-opacity": 0.07,
      "border-width": 1.5,
      padding: "12px",
      "font-size": `${BOX_FONT}px`,
      "min-zoomed-font-size": 0, // t342: a box title draws at every zoom
      "font-weight": 600,
      "text-wrap": "none",
      "text-valign": "top",
      "text-halign": "center",
      "text-margin-y": -3,
    },
  },
  {
    // t342: below the label cut, with exempt labels enlarged, a box hugs its nodes (see
    // EXEMPT_LABELS). Missing from @types/cytoscape, hence the cast.
    selector: ":parent",
    style: {
      "compound-sizing-wrt-labels": (ele: cytoscape.NodeSingular) =>
        exemptScale(ele.cy()) > 1 ? "exclude" : "include",
    } as unknown as cytoscape.Css.Node,
  },
  ...Object.keys(NEST_PARENT_RANK).map((type) => ({
    selector: `node[type_id = "${type}"]:parent`,
    style: { "border-color": TYPE_COLOR[type] ?? DEFAULT_COLOR },
  })),
  {
    // t337: a label inside a box gets a backing, so the relation lines that cross a box
    // (provenance runs to the source column) do not strike out the text.
    selector: "node:child:childless",
    style: {
      "text-background-color": "#0f0f12",
      "text-background-opacity": 0.7,
      "text-background-shape": "roundrectangle",
      "text-background-padding": "1px",
    },
  },
  {
    // t337 nested layout: a source in the column — small, its label beside it on one line.
    selector: "node.source-column",
    style: {
      width: 12,
      height: 12,
      "border-width": 1,
      "text-wrap": "ellipsis",
      "text-max-width": `${SOURCE_LABEL_WIDTH}px`,
      "text-valign": "center",
      "text-halign": "right",
      "text-margin-x": 4,
      "text-margin-y": 0,
      color: "#a0a0b0",
    },
  },
  {
    selector: "node:selected",
    style: {
      "border-width": 3,
      "border-color": "#ffffff",
      "background-blacken": -0.2,
    },
  },
  {
    // Cytoscape "edge" === mo:os relation.
    selector: "edge",
    style: {
      width: 1.5,
      "line-color": RELATION_COLOR,
      "target-arrow-color": RELATION_COLOR,
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.8,
      "curve-style": "bezier",
      label: "data(label)",
      color: "#a0a0b0",
      "font-size": `${RELATION_FONT}px`,
      // t342: a port name on a line is held to the same zoom as the node labels.
      "min-zoomed-font-size": labelFloor(RELATION_FONT),
      "text-rotation": "autorotate",
      "text-background-color": "#0f0f12",
      "text-background-opacity": 0.85,
      "text-background-padding": "2px",
    },
  },
  // t337: a knowledge relation is drawn from the vocabulary — colour, dashed, width by
  // emphasis — with no port text on the line (the legend names it) and no arrowhead when
  // it is self-converse (it reads the same from both ends). Every other relation keeps
  // the rule above.
  ...KB_PORTS.flatMap((port) => {
    const s = kbPortStyle(port);
    if (!s) return [];
    return {
      selector: `edge[label = "${port}"]`,
      style: {
        "line-color": s.color,
        "target-arrow-color": s.color,
        "line-style": s.dashed ? ("dashed" as const) : ("solid" as const),
        width: s.dashed ? 1 : (KB_RELATION_WIDTH[s.emphasis] ?? KB_RELATION_WIDTH[0]),
        "target-arrow-shape": s.selfConverse ? ("none" as const) : ("triangle" as const),
        label: "",
      },
    };
  }),
  // t342 P1 PORT COLOUR (the default palette, decision 2): each end in κ(port) — one hue, or
  // two tones split at the middle — and the three non-colour states as glyphs on a neutral
  // grey, never a hue (port-colour.js: source ⊣ / ○, target ▸⊣ / ○▸, undeclared pair dotted
  // with a hollow ◇ midway). The class `kappa` is on every relation while the palette is port
  // colour; without it the relation-kind rules above draw. The port name is on the line here
  // (the colour no longer names a knowledge port), held to the label cut like every label.
  {
    selector: "edge.kappa",
    style: {
      width: 1.6,
      label: "data(label)",
      "line-color": "data(ks)",
      "line-fill": (e: cytoscape.EdgeSingular) =>
        e.data("ks") === e.data("kt") ? "solid" : "linear-gradient",
      "line-gradient-stop-colors": (e: cytoscape.EdgeSingular) =>
        `${e.data("ks")} ${e.data("ks")} ${e.data("kt")} ${e.data("kt")}`,
      "line-gradient-stop-positions": "0 50 50 100",
      "line-style": (e: cytoscape.EdgeSingular) =>
        e.data("kpair") === "undeclared" ? UNDECLARED_MARKER.lineStyle : "solid",
      "source-arrow-shape": "data(kss)",
      "source-arrow-color": "data(ks)",
      "source-arrow-fill": (e: cytoscape.EdgeSingular) =>
        e.data("kss") === "circle" ? "hollow" : "filled",
      "target-arrow-shape": "data(kts)",
      "target-arrow-color": "data(kt)",
      // the uncoloured state is hollow at both ends (Cytoscape fills every arrow by default)
      "target-arrow-fill": (e: cytoscape.EdgeSingular) =>
        e.data("kts") === "circle-triangle" ? "hollow" : "filled",
      "mid-target-arrow-shape": (e: cytoscape.EdgeSingular) =>
        e.data("kpair") === "undeclared" ? UNDECLARED_MARKER.midGlyph : "none",
      "mid-target-arrow-color": KAPPA_NEUTRAL,
      "mid-target-arrow-fill": "hollow",
    } as unknown as cytoscape.Css.Edge,
  },
  {
    selector: "edge:selected",
    style: {
      "line-color": "#6366f1",
      "target-arrow-color": "#6366f1",
      "line-fill": "solid", // t342 P1: a two-tone relation is selected in one colour too
    },
  },
  {
    // t342: below the cut these still carry their label — the selection, a `find` match
    // (class `found`) and the node under the pointer (class `hovered`) — enlarged with the
    // zoom so it can be read (EXEMPT_LABELS).
    selector: EXEMPT_LABELS,
    style: {
      "min-zoomed-font-size": 0,
      "font-size": (ele: cytoscape.NodeSingular | cytoscape.EdgeSingular) =>
        labelBase(ele).font * exemptScale(ele.cy()),
      "text-max-width": (ele: cytoscape.NodeSingular | cytoscape.EdgeSingular) =>
        `${labelBase(ele).width * exemptScale(ele.cy())}px`,
    },
  },
  // t337: a node outside the highlighted set (see `highlightUrns`) and the relations that
  // touch one. A box fades its own outline and title only — `opacity` on a compound
  // parent would also fade the nodes inside it, lit or not.
  { selector: ".faded", style: { opacity: 0.12 } },
  {
    selector: ":parent.faded",
    style: { opacity: 1, "border-opacity": 0.25, "background-opacity": 0.02, "text-opacity": 0.3 },
  },
  // t337: unticked in the legend.
  { selector: ".hidden", style: { display: "none" } },
  // t342: an unticked box kind hides the box — outline, fill, title — not what it holds.
  // `display: none` on a compound parent also hides every child, so unticking `domain_tag`
  // took all still-ticked claims with it (Copilot, #45). The box stays in the layout.
  {
    selector: ":parent.hidden",
    style: {
      display: "element",
      "background-opacity": 0,
      "border-width": 0,
      "text-opacity": 0,
      events: "no",
    },
  },
];

/**
 * t342 P1: the palette — every relation drawn in port colour (the `kappa` class, STYLE
 * `edge.kappa`), or none (relation kind). Exported (t342 P1 review): the smokes draw with it.
 */
export function applyPalette(cy: cytoscape.Core, portColour: boolean): void {
  cy.batch(() => {
    cy.edges().toggleClass("kappa", portColour);
  });
}

/** A legend line swatch: the relation's colour and dash, as the graph draws it. */
function relationSwatch(
  row: LegendRelationRow,
  portColour: boolean,
): { background: string; height: number } {
  // t342 P1: in port colour, the row's first relation — one hue, or its two tones.
  if (portColour && row.ks && row.kt) {
    return {
      background:
        row.ks === row.kt ? row.ks : `linear-gradient(90deg, ${row.ks} 0 50%, ${row.kt} 50% 100%)`,
      height: 2,
    };
  }
  const port = row.port;
  const s = kbPortStyle(port);
  if (!s) return { background: RELATION_COLOR, height: 2 };
  return {
    background: s.dashed
      ? `repeating-linear-gradient(90deg, ${s.color} 0 4px, transparent 4px 7px)`
      : s.color,
    height: s.dashed ? 1 : Math.round(KB_RELATION_WIDTH[s.emphasis] ?? KB_RELATION_WIDTH[0]),
  };
}

/** The legend tooltip for a port: both port names, the count, what the vocabulary says. */
function relationTitle({ port, count, boxed, undeclared }: LegendRelationRow): string {
  const converse = kbConversePort(port);
  const names = converse && converse !== port ? `${port} / ${converse}` : port;
  const drawn = boxed > 0 ? ` (${boxed} drawn as boxes, ${count - boxed} as lines)` : "";
  const says = kbRelation(port)?.description;
  // t342 P1: the pair state, a pair check only (the workbench's check 8 rules on admission).
  const pairs = undeclared > 0 ? ` · ${undeclared} on a pair the engine does not declare` : "";
  return `${names} · ${count}${drawn}${pairs}${says ? ` — ${says}` : ""}`;
}

/** t342 P1: the legend's palette rows — the κ families present and the three states. */
function kappaLegend(frame: HgFrame, grammar: EngineGrammar | undefined) {
  const typeOf = new Set(nodesOf(frame).map((n) => n.urn));
  const drawn = relationsOf(frame).filter(
    (r) => typeOf.has(r.source_urn) && typeOf.has(r.target_urn),
  );
  const census = kappaCensus(drawn, grammar);
  return {
    census,
    families: kappaFamilies(grammar).map(({ family, hue }) => ({
      family,
      hue,
      ends: census.families[family] ?? 0,
    })),
  };
}

/** The legend opens by itself only where it has the room (a tab, not the side panel). */
const LEGEND_OPEN_MIN_WIDTH = 640;

export function FrameGraph({
  frame,
  selectedUrn,
  onSelect,
  layout = DEFAULT_GRAPH_LAYOUT,
  focusUrn = null,
  focusSignal = 0,
  highlightUrns = null,
  palette: paletteProp,
  onPaletteChange,
}: {
  frame: HgFrame;
  selectedUrn: string | null;
  onSelect: (urn: string | null) => void;
  /**
   * The layout CHOICE. `auto` (the default) draws `nested` on a frame with nesting
   * relations and `concentric` otherwise; any other value is drawn as chosen.
   */
  layout?: GraphLayoutName;
  /** A node to center on when `focusSignal` bumps (used by node search). */
  focusUrn?: string | null;
  /** Increment to re-center on `focusUrn` (lets a repeat search re-center the same node). */
  focusSignal?: number;
  /**
   * t337 search support: when non-empty, every node NOT in this set of URNs is faded,
   * with every relation that touches a faded node. Empty / null / absent fades nothing.
   */
  highlightUrns?: readonly string[] | ReadonlySet<string> | null;
  /**
   * t342 P1 (review): the palette, when the surface holds it, so the inspector beside the
   * graph colours its relation rows as the graph draws them. Absent, the graph keeps its own.
   */
  palette?: RelationPalette;
  onPaletteChange?: (palette: RelationPalette) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // Keep the latest focus target reachable from the focusSignal effect without making it
  // a dependency (searching the SAME urn twice still re-centers, driven by the signal).
  const focusUrnRef = useRef(focusUrn);
  focusUrnRef.current = focusUrn;
  const [graphError, setGraphError] = useState<string | null>(null);

  // t337: what is drawn. `auto` is resolved against the frame; boxes exist only under
  // `nested` (a ring / tree / grid layout cannot place them), so under any other layout
  // the nesting relation is a line like the rest.
  const drawn = useMemo(() => resolveGraphLayout(layout, frame), [layout, frame]);
  // t337 legend state: what is unticked (by port name / node-kind key), and whether the
  // legend is open. Unticking only hides — the frame is not re-requested.
  const [hiddenPorts, setHiddenPorts] = useState<ReadonlySet<string>>(() => new Set());
  const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<string>>(() => new Set());
  // t342 (Copilot on #45): a nesting relation that draws a box is not an edge, so hiding
  // edges by port cannot hide it. Unticking the nesting port therefore draws no boxes: its
  // relations become lines again, and applyHidden hides those like any other port.
  const nestingHidden = !!KB_NESTING_PORT && hiddenPorts.has(KB_NESTING_PORT);
  const plan = useMemo(() => {
    const parents =
      drawn === "nested" && !nestingHidden ? nestingParents(frame) : new Map<string, string>();
    const unlinked = unlinkedUrns(frame);
    const elements = toElements(frame, parents, unlinked);
    return {
      elements,
      key: structureKey(elements),
      legend: legendOf(frame, parents),
      unlinked: unlinked.size,
    };
  }, [frame, drawn, nestingHidden]);
  /** `${layout}\n${structure}` of what the Cytoscape instance currently holds. */
  const builtRef = useRef<string | null>(null);

  const hiddenRef = useRef({ ports: hiddenPorts, kinds: hiddenKinds });
  hiddenRef.current = { ports: hiddenPorts, kinds: hiddenKinds };
  // The node kinds that were unticked when the layout last ran. It places only what is
  // shown, so ticking one of them back runs it again (the legend effect below).
  const laidOutHiddenRef = useRef<ReadonlySet<string>>(new Set());
  // The viewport as the last fit left it. While that still is the viewport the user has
  // not zoomed or panned, and a change of the canvas size fits again (the init effect).
  const fittedRef = useRef<FittedView | null>(null);
  // null until the container has been measured (the init effect): the first build waits
  // for it, so the first layout runs against the canvas size the legend leaves it. The
  // effects below list `legendDecided` so they run again right after that first build.
  const [wide, setWide] = useState<boolean | null>(null);
  const legendDecided = wide !== null;
  // The legend opens by itself only where it has the room AND the frame needs it to be
  // read — knowledge relations are drawn without port text. On every other frame it
  // starts closed, so the canvas keeps its height. The toggle overrides this either way
  // (null = not toggled yet).
  const [legendChoice, setLegendChoice] = useState<boolean | null>(null);
  // t342 P1 (decision 2): the palette — port colour by default, relation kind on the
  // legend's switch. Not saved, like the legend ticks (decision 4: chip state unsaved).
  // Without an engine grammar the frame can only be drawn by relation kind.
  const grammar = frame.provenance?.grammar;
  const portColourAvailable = hasPortColours(grammar);
  const [ownPalette, setOwnPalette] = useState<RelationPalette>("port");
  const palette = paletteProp ?? ownPalette;
  const setPalette = (next: RelationPalette) => {
    setOwnPalette(next);
    onPaletteChange?.(next);
  };
  const portColour = palette === "port" && portColourAvailable;
  const kappa = useMemo(() => kappaLegend(frame, grammar), [frame, grammar]);
  const legendOpen =
    legendChoice ?? (wide === true && plan.legend.relations.some((row) => isKbPort(row.port)));

  // Init once. Cytoscape init runs in an effect, so a throw here escapes React
  // error boundaries — catch it and surface a clean message instead of a blank
  // panel + a cryptic extension-card error.
  useEffect(() => {
    if (!containerRef.current) return;
    let cy: cytoscape.Core;
    try {
      cy = cytoscape({
        container: containerRef.current,
        elements: [],
        style: STYLE,
        // Init runs with no elements, so the concrete layout runs in the rebuild effect
        // below (which reads the live `layout` prop). `grid` here is just a cheap no-op
        // on the empty graph.
        layout: { name: "grid", animate: false, padding: 12 },
        // wheelSensitivity left at the default (1) — a custom value both warns in
        // the console and is discouraged by Cytoscape for portability.
        minZoom: MIN_ZOOM,
        maxZoom: 3,
      });
    } catch (err) {
      setGraphError(`graph init failed: ${String(err)}`);
      return;
    }

    cy.on("tap", "node", (evt: cytoscape.EventObject) => {
      onSelectRef.current((evt.target as cytoscape.NodeSingular).id());
    });
    cy.on("tap", (evt: cytoscape.EventObject) => {
      if (evt.target === cy) onSelectRef.current(null);
    });
    // t342: the node under the pointer shows its label at any zoom (STYLE `node.hovered`).
    cy.on("mouseover", "node", (evt: cytoscape.EventObject) => {
      (evt.target as cytoscape.NodeSingular).addClass("hovered");
    });
    cy.on("mouseout", "node", (evt: cytoscape.EventObject) => {
      (evt.target as cytoscape.NodeSingular).removeClass("hovered");
    });
    // t342: leaving the canvas straight from a node fires no node `mouseout` (Cytoscape emits
    // the container's mouseout on the core only), so the core clears the hover itself — but
    // not for a move between the container's own layers.
    cy.on("mouseout", (evt: cytoscape.EventObject) => {
      if (evt.target !== cy) return;
      const to = (evt.originalEvent as MouseEvent | undefined)?.relatedTarget as Node | null;
      if (to && containerRef.current?.contains(to)) return;
      cy.nodes(".hovered").removeClass("hovered");
    });
    // t342: the exempt labels follow the zoom (EXEMPT_LABELS).
    cy.on("zoom", () => followZoom(cy));
    // t337: a double-click on a box brings that whole box into view (see readZoom).
    cy.on("dbltap", "node:parent", (evt: cytoscape.EventObject) => {
      const box = evt.target as cytoscape.NodeSingular;
      cy.animate({ center: { eles: box }, zoom: readZoom(cy, box) }, { duration: 200 });
    });

    // t337: the canvas changes size after the first drawing — the legend opens, the window
    // is resized, a neighbour mounts late. Cytoscape is told, and the picture is fitted
    // again UNLESS the user has zoomed or panned since the last fit: that view is theirs.
    // The observer comes from the container's own window (a Document PiP mount lives in
    // another one).
    const container = containerRef.current;
    const Observer = container.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    const observer = new Observer(() => {
      const fitted = fittedRef.current;
      const pan = cy.pan();
      const untouched =
        fitted !== null && cy.zoom() === fitted.zoom && pan.x === fitted.x && pan.y === fitted.y;
      cy.resize();
      if (untouched) fittedRef.current = fitShown(cy);
    });
    observer.observe(container);

    cyRef.current = cy;
    builtRef.current = null;
    setWide(container.clientWidth >= LEGEND_OPEN_MIN_WIDTH);
    return () => {
      observer.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Rebuild elements + relayout ONLY when the drawing's structure changes — the set of
  // node / relation ids, the nesting, or the drawn layout (t337). The panel re-reads the
  // frame on every fold-stream event; a re-read with the same structure updates the data
  // in place and leaves the user's zoom and pan alone.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !legendDecided) return;
    const built = `${drawn}\n${plan.key}`;
    try {
      if (builtRef.current === built) {
        cy.batch(() => {
          for (const el of plan.elements) syncData(cy, el);
        });
      } else {
        cy.elements().remove();
        cy.add(plan.elements);
        applyHidden(cy, hiddenRef.current.ports, hiddenRef.current.kinds);
        fittedRef.current = runLayout(cy, drawn);
        laidOutHiddenRef.current = hiddenRef.current.kinds;
        builtRef.current = built;
      }
      setGraphError(null);
    } catch (err) {
      builtRef.current = null;
      setGraphError(`graph render failed: ${String(err)}`);
    }
  }, [plan, drawn, legendDecided]);

  // t342 P1: the palette — every relation drawn in port colour, or none (relation kind).
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    applyPalette(cy, portColour);
  }, [portColour, plan, drawn, legendDecided]);

  // Apply the legend's unticked ports / kinds (and re-apply after any frame change: an
  // in-place data update can move a node to another kind).
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    applyHidden(cy, hiddenPorts, hiddenKinds);
    // A kind the layout last ran without has no place of its own yet (its nodes sit where
    // an earlier layout left them, or all on one point): shown again, the layout runs again.
    if ([...laidOutHiddenRef.current].some((kind) => !hiddenKinds.has(kind))) {
      try {
        fittedRef.current = runLayout(cy, drawn);
      } catch (err) {
        setGraphError(`graph render failed: ${String(err)}`);
      }
      laidOutHiddenRef.current = hiddenKinds;
    }
  }, [plan, drawn, legendDecided, hiddenPorts, hiddenKinds]);

  // t337: fade everything outside `highlightUrns`. Keyed on the urns themselves, so a
  // caller passing a fresh array with the same content does not re-run it.
  const highlightKey = useMemo(
    () => (highlightUrns ? [...highlightUrns].sort().join("\n") : ""),
    [highlightUrns],
  );
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const lit = new Set(highlightKey ? highlightKey.split("\n") : []);
    cy.batch(() => {
      cy.elements().removeClass("faded found");
      const hits = cy.nodes().filter((n) => lit.has(n.id()));
      // A set that names no node of THIS frame fades nothing — a mirror gets the frame and
      // the search through two store keys, and the two can be of different frames.
      if (hits.empty()) return;
      hits.addClass("found"); // t342: a match keeps its label at any zoom
      // The boxes a match sits in stay lit, so the match can be placed at a glance.
      const out = cy.nodes().not(hits.union(hits.ancestors()));
      out.addClass("faded");
      out.connectedEdges().addClass("faded");
    });
  }, [highlightKey, plan, drawn, legendDecided]);

  // Reflect external selection (e.g. restored from scratch, or a search hit) into the
  // graph. Also re-runs after a layout change so the highlight survives a relayout.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements(":selected").unselect();
      if (selectedUrn) {
        const el = cy.getElementById(selectedUrn);
        if (el.nonempty()) el.select();
      }
    });
  }, [selectedUrn, plan, drawn, legendDecided]);

  // Center on a searched node when the search bumps `focusSignal`. Kept separate from
  // selection so clicking a node in the graph never yanks the viewport.
  useEffect(() => {
    if (!focusSignal) return;
    const cy = cyRef.current;
    const urn = focusUrnRef.current;
    if (!cy || !urn) return;
    try {
      const el = cy.getElementById(urn);
      // t337: a node the legend hides has no place to centre on (Cytoscape would go to the
      // model origin).
      if (el.empty() || !el.visible()) return;
      // t337: in a drawing with boxes the fitted view is an overview — labels of a few
      // px — so centring there also zooms in to where the node can be read. A drawing
      // without boxes centres at the current zoom, as before.
      const boxed = cy.nodes(":parent").nonempty();
      cy.animate(
        boxed ? { center: { eles: el }, zoom: readZoom(cy, el) } : { center: { eles: el } },
        { duration: 200 },
      );
    } catch {
      // centering is a best-effort nicety — never let it surface as a graph error
    }
  }, [focusSignal]);

  // t337 graph controls: fit what is shown; run the layout again (over what is shown);
  // zoom in / out one step about the middle of the canvas.
  const handleFit = useCallback(() => {
    const cy = cyRef.current;
    if (cy) fittedRef.current = fitShown(cy);
  }, []);
  const handleRelayout = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    try {
      fittedRef.current = runLayout(cy, drawn);
      laidOutHiddenRef.current = hiddenRef.current.kinds;
    } catch (err) {
      setGraphError(`graph render failed: ${String(err)}`);
    }
  }, [drawn]);
  const handleZoom = useCallback((factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({
      level: cy.zoom() * factor,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  }, []);
  const handleShowAll = useCallback(() => {
    setHiddenPorts(new Set());
    setHiddenKinds(new Set());
  }, []);

  const toggleIn = (set: ReadonlySet<string>, key: string): ReadonlySet<string> => {
    const next = new Set(set);
    if (!next.delete(key)) next.add(key);
    return next;
  };
  const countOf = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const { relations: relationRows, nodes: nodeRows } = plan.legend;
  const nodeTotal = nodeRows.reduce((sum, row) => sum + row.count, 0);
  const relationTotal = relationRows.reduce((sum, row) => sum + row.count, 0);
  // Every unticked row, on this lens or another: a tick stays off across lenses (rows are
  // matched by name), so the count and `show all` must not depend on the rows in view.
  const hiddenCount = hiddenPorts.size + hiddenKinds.size;
  // t342: the unlinked band is shown unless its chip has hidden it.
  const bandShown = !hiddenKinds.has(UNLINKED_KEY);

  return (
    <div className={`graph-wrap${legendOpen ? " legend-open" : ""}`}>
      {graphError && <div className="pilot-state error">{graphError}</div>}
      <div className="graph-canvas" ref={containerRef} />
      {/* t337: an empty canvas says why — under anon it is the posture, not a fault. */}
      {nodeTotal === 0 && !graphError && (
        <div className="graph-empty">
          no nodes in this slice
          {frame.provenance?.access?.scope?.mode === "anon" &&
            " — the anon posture shows public nodes only"}
        </div>
      )}
      {/* t337: the bar and the legend sit UNDER the canvas, in flow — the old overlay
          covered the last row of the graph. */}
      <div className="graph-bar">
        <button
          type="button"
          className="graph-legend-toggle"
          aria-expanded={legendOpen}
          onClick={() => setLegendChoice(!legendOpen)}
          title={
            `Legend: the relation ports (${relationRows.length}) and node kinds ` +
            `(${nodeRows.length}) in this frame — untick one to hide it (the frame is not re-read)`
          }
        >
          legend · {countOf(nodeTotal, "node")} · {countOf(relationTotal, "relation")}
          {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
        </button>
        {hiddenCount > 0 && (
          <button
            type="button"
            className="mini-btn"
            onClick={handleShowAll}
            title="Tick every legend row again and show the unlinked band — a row unticked on one lens stays unticked on the others"
          >
            show all
          </button>
        )}
        {plan.unlinked > 0 && (
          <button
            type="button"
            className={`mini-btn graph-unlinked${bandShown ? " is-on" : ""}`}
            aria-pressed={bandShown}
            onClick={() => setHiddenKinds((prev) => toggleIn(prev, UNLINKED_KEY))}
            title={
              `${countOf(plan.unlinked, "node")} without a relation in this frame, drawn in one ` +
              `band under the linked graph — ${bandShown ? "hide" : "show"} the band (the frame ` +
              "is not re-read)"
            }
          >
            unlinked {plan.unlinked}
          </button>
        )}
        <button
          type="button"
          className="mini-btn"
          onClick={() => handleZoom(1 / ZOOM_STEP)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="mini-btn"
          onClick={() => handleZoom(ZOOM_STEP)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="mini-btn"
          onClick={handleFit}
          title="Fit everything shown into the view (double-click a box to bring just that box into view)"
        >
          fit
        </button>
        <button
          type="button"
          className="mini-btn"
          onClick={handleRelayout}
          title={`Run the ${drawn} layout again over what is shown, then fit`}
        >
          re-layout
        </button>
      </div>
      {/* t264: legend derived from what is ACTUALLY in the frame, never a stale hardcoded
          list. t337: interactive — every relation port and node kind present, with its
          count and a checkbox that hides it client-side. */}
      {legendOpen && (
        <div className="graph-legend">
          {/* t342 P1: which palette draws the relations, and what its colours and glyphs mean. */}
          <div className="legend-group legend-palette" role="group" aria-label="Colour relations by">
            <span className="legend-title">colour by</span>
            <button
              type="button"
              className={`mini-btn legend-palette-btn${portColour ? " is-on" : ""}`}
              aria-pressed={portColour}
              disabled={!portColourAvailable}
              onClick={() => setPalette("port")}
              title={
                portColourAvailable
                  ? `Port colour: each relation end in the colour family κ(port) the engine gives its port — ${grammarSummary(grammar)}`
                  : `Port colours are not available: ${grammarSummary(grammar)}`
              }
            >
              port colour
            </button>
            <button
              type="button"
              className={`mini-btn legend-palette-btn${portColour ? "" : " is-on"}`}
              aria-pressed={!portColour}
              onClick={() => setPalette("kind")}
              title={`Relation kind: the knowledge vocabulary's colours (kb-vocab ${KB_VOCAB_VERSION}) for the knowledge ports, the default line for every other port`}
            >
              relation kind
            </button>
            {!portColourAvailable && (
              <span className="legend-note" title={grammarSummary(grammar)}>
                {`${grammarGap(grammar) ?? "no port colours"} — drawn by relation kind`}
              </span>
            )}
          </div>
          {portColour && (
            <div className="legend-group" title={grammarSummary(grammar)}>
              <span className="legend-title">end colour</span>
              {kappa.families.map((f) => (
                <span
                  key={f.family}
                  className={`legend-item legend-kappa${f.ends === 0 ? " is-empty" : ""}`}
                  title={`${f.family} · ${f.ends} relation end${f.ends === 1 ? "" : "s"} in this frame${f.hue ? "" : " · no hue left (more than eight colour families)"}`}
                >
                  <i className="legend-dot" style={{ background: f.hue ?? KAPPA_NEUTRAL }} />
                  {f.family}
                  <span className="legend-count">{f.ends}</span>
                </span>
              ))}
              {KAPPA_STATES.map((st) => {
                const n =
                  st.state === "exempt"
                    ? kappa.census.exempt
                    : st.state === "uncoloured"
                      ? kappa.census.uncoloured
                      : kappa.census.undeclared;
                return (
                  <span
                    key={st.state}
                    className="legend-item legend-kappa-state"
                    title={`${st.label} · ${n} ${st.state === "undeclared" ? "relation" : "relation end"}${n === 1 ? "" : "s"} — ${st.title}`}
                  >
                    <span className="legend-glyph" aria-hidden="true">
                      {st.glyph}
                    </span>
                    {st.label}
                    <span className="legend-count">{n}</span>
                  </span>
                );
              })}
            </div>
          )}
          <div className="legend-group">
            <span className="legend-title">relations</span>
            {relationRows.map((row) => (
              <label key={row.port} className="legend-item" title={relationTitle(row)}>
                <input
                  type="checkbox"
                  checked={!hiddenPorts.has(row.port)}
                  onChange={() => setHiddenPorts((prev) => toggleIn(prev, row.port))}
                />
                <i className="legend-line" style={relationSwatch(row, portColour)} />
                {row.port}
                {portColour && row.undeclared > 0 && (
                  <span className="legend-glyph" aria-label="undeclared pair">
                    ◇
                  </span>
                )}
                <span className="legend-count">{row.count}</span>
              </label>
            ))}
            {relationRows.length === 0 && <span className="legend-note">none in this frame</span>}
            {!portColour && (
              <span className="legend-note">
                relation kind · knowledge ports in the kb-vocab {KB_VOCAB_VERSION} colours
              </span>
            )}
          </div>
          <div className="legend-group">
            <span className="legend-title">nodes</span>
            {nodeRows.map((row) => (
              <label key={row.key} className="legend-item" title={`${row.key} · ${row.count}`}>
                <input
                  type="checkbox"
                  checked={!hiddenKinds.has(row.key)}
                  onChange={() => setHiddenKinds((prev) => toggleIn(prev, row.key))}
                />
                <i
                  className={row.box ? "legend-box" : "legend-dot"}
                  style={row.box ? { borderColor: row.color } : { background: row.color }}
                />
                {row.key}
                <span className="legend-count">{row.count}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
