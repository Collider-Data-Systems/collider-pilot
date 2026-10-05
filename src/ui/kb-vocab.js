/**
 * Collider Pilot - knowledge vocabulary accessor (t337, SHARED)
 * =============================================================
 * The ONE place pilot code reads `kb-vocab.json` — the knowledge-relation vocabulary that
 * Lean emits (`Kb/Vocab.lean`; see PROVENANCE.md) and that is copied here VERBATIM. The JSON
 * is never hand-edited, and this module adds no port name and no colour of its own: every
 * export below is a projection of the file. Everything else — the "knowledge" port group
 * and lens (GraphControls), relation styling and nesting, the inspector's converse names,
 * the smoke scripts — imports from here, so a vocabulary bump is one file copy and nothing
 * in the pilot can drift against it.
 *
 * What the vocabulary fixes, per relation: the port pair (`src_port` / `tgt_port` — a frame
 * relation's `label` is its `src_port`, see transform.js mapRelation), the node types
 * allowed on each end, the display colour / dashed / emphasis, and whether the relation
 * NESTS (the source is drawn INSIDE the target instead of as a line). Plus the claim kinds
 * and their colours.
 *
 * Shared JS + JSDoc (same discipline as transform.js): Node imports it directly, so the
 * smoke scripts read the same vocabulary as the panel, while `tsc` still type-resolves it
 * for the TSX app. The JSON import attribute is what lets Node load the file with no build
 * step (Node >= 20.10); Vite bundles it like any other JSON import.
 *
 * READ-ONLY data: no network, no DOM, no chrome.*, no rewrite.
 */

import vocab from "./kb-vocab.json" with { type: "json" };

/**
 * One knowledge relation as the vocabulary declares it.
 * @typedef {{
 *   src_port: string,
 *   tgt_port: string,
 *   src_types: string[],
 *   tgt_types: string[],
 *   display: string,
 *   dashed: boolean,
 *   emphasis: number,
 *   nests: boolean,
 *   color: string,
 *   description: string,
 * }} KbRelation
 */
/**
 * How one knowledge port is drawn. `selfConverse` (src_port === tgt_port) means the
 * relation reads the same from both ends — there is no direction to put an arrowhead on.
 * @typedef {{ color: string, dashed: boolean, emphasis: number, nests: boolean, selfConverse: boolean }} KbPortStyle
 */
/**
 * A claim kind (the `kind` property of a claim node) and its display colour.
 * @typedef {{ name: string, display: string }} KbClaimKind
 */

/** The vocabulary version and the ontology version it was emitted for. */
export const KB_VOCAB_VERSION = vocab.vocab_version;
export const KB_ONTOLOGY_VERSION = vocab.ontology_version;
/** The rewrite_category every knowledge relation is linked under. */
export const KB_REWRITE_CATEGORY = vocab.target_wf;

/** Every knowledge relation, in vocabulary order. @type {readonly KbRelation[]} */
export const KB_RELATIONS = vocab.relations;

/**
 * The knowledge ports: each relation's `src_port` — the label a frame relation carries,
 * and so the name the port filter and the advanced drawer work with.
 * @type {string[]}
 */
export const KB_PORTS = KB_RELATIONS.map((r) => r.src_port);

/**
 * Node types the vocabulary allows on either end of a knowledge relation (first-seen order).
 * @type {string[]}
 */
export const KB_NODE_TYPES = [
  ...new Set(KB_RELATIONS.flatMap((r) => [...r.src_types, ...r.tgt_types])),
];

/** @type {Map<string, KbRelation>} */
const BY_SRC_PORT = new Map(KB_RELATIONS.map((r) => [r.src_port, r]));

/**
 * src_port -> tgt_port and tgt_port -> src_port (a self-converse port maps to itself).
 * @type {Map<string, string>}
 */
const CONVERSE = new Map();
for (const r of KB_RELATIONS) {
  CONVERSE.set(r.src_port, r.tgt_port);
  if (!CONVERSE.has(r.tgt_port)) CONVERSE.set(r.tgt_port, r.src_port);
}

/**
 * Whether a relation label is a knowledge port.
 * @param {unknown} port
 * @returns {boolean}
 */
export function isKbPort(port) {
  return typeof port === "string" && BY_SRC_PORT.has(port);
}

/**
 * The declared relation for a knowledge port (`src_port`), or null for any other port.
 * @param {unknown} port
 * @returns {KbRelation | null}
 */
export function kbRelation(port) {
  return (typeof port === "string" && BY_SRC_PORT.get(port)) || null;
}

/**
 * How a knowledge port is drawn, or null for any other port (which keeps the default
 * relation style).
 * @param {unknown} port
 * @returns {KbPortStyle | null}
 */
export function kbPortStyle(port) {
  const r = kbRelation(port);
  if (!r) return null;
  return {
    color: r.display,
    dashed: r.dashed,
    emphasis: r.emphasis,
    nests: r.nests,
    selfConverse: r.src_port === r.tgt_port,
  };
}

/**
 * The converse port name — what the relation is called read from its OTHER end
 * (`part-of` <-> `has-part`). Accepts either end; null for a port the vocabulary does not
 * declare.
 * @param {unknown} port
 * @returns {string | null}
 */
export function kbConversePort(port) {
  return (typeof port === "string" && CONVERSE.get(port)) || null;
}

/**
 * The port whose relation NESTS — its source is drawn inside its target instead of as a
 * line — or null when the vocabulary declares none.
 * @type {string | null}
 */
export const KB_NESTING_PORT = KB_RELATIONS.find((r) => r.nests)?.src_port ?? null;

/** The claim kinds, in vocabulary order. @type {readonly KbClaimKind[]} */
export const KB_CLAIM_KINDS = vocab.claim_kinds;

/**
 * Display colour for a claim's `kind` property value, or null when the vocabulary does not
 * declare that kind.
 * @param {unknown} kind
 * @returns {string | null}
 */
export function kbClaimKindColor(kind) {
  return KB_CLAIM_KINDS.find((k) => k.name === kind)?.display ?? null;
}
