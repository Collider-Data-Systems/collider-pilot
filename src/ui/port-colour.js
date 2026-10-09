/**
 * Collider Pilot - relation ends coloured by the engine's port colours (t342 P1, SHARED)
 * ===================================================================================
 * t342 work order P1 (hand-off A; decision 2: port colour is the default palette, relation
 * kind the alternative). Each relation END is coloured by κ(port) — the colour family the
 * engine's `/operad/port-colors` gives its port, read at run time (src/mcp/engine-grammar.js)
 * and never written here:
 *
 *   - both ends in one family  -> one hue for the whole line;
 *   - two families              -> two tones: the source half in κ(src_port), the target half
 *                                  in κ(tgt_port);
 *   - three states are NOT colours and never get a hue — a neutral grey plus a glyph of their
 *     own at that end, or on the line:
 *       exempt      κ = ""            (98f2ccc kernels on 4.0.x)      source ⊣ tee · target ▸⊣
 *       uncoloured  port not in the map                               source ○ · target ○▸
 *       undeclared  (src_port, tgt_port) is on no declared pair       dotted line + ◇ midway
 *     The pair check is the ONLY grammar check here: the kernel's type law is not ported, and
 *     the workbench's check 8 is the authority on admission.
 *
 * Never by rewrite_category (WF), never from a relation's `src_color` / `tgt_color`.
 *
 * Hues: eight, one per colour family, assigned in the order of the family names the ENGINE
 * reports (sorted), so no family name and no port -> colour map is written into this code.
 * The eight are the dark steps of the dataviz reference categorical palette, validated against
 * the canvas (#0f0f12) on NEIGHBOURING slots: lightness band, chroma, CVD ΔE ≥ 8.4,
 * normal-vision ΔE ≥ 19.3, contrast ≥ 3:1. t342 P1 (review): relations are a graph, not a stack
 * — any two families can meet — and over all 28 pairs no ordering of eight hues clears those
 * floors (the reference palette's own series cap); the closest pairs are slots 2/8 and 5/8,
 * OKLab ΔE ×100 7.1 and 7.8 (TESTING.md lists every close pair). So a family is never told
 * by hue alone: the port name rides on the line (held to the label cut) and the legend names
 * each family with its count. None is a node fill and none is within ΔE 3 of one; several
 * are within ΔE 10 and are kept apart by the mark (a line, not a disc) — `smoke:lens` H
 * holds both, and fails on a new close pair. A ninth family gets no generated hue — it is
 * drawn neutral and the legend says "no hue left".
 *
 * Pure: no DOM, no network. FrameGraph draws from it and `smoke:lens` H / `smoke:live` run it.
 *
 * @typedef {import("../mcp/types").EngineGrammar} EngineGrammar
 * @typedef {import("../mcp/types").HgRelation} HgRelation
 */

import { isDeclaredPair } from "../mcp/engine-grammar.js";

/** The eight κ hues, in slot order. @type {readonly string[]} */
export const KAPPA_HUES = Object.freeze([
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
]);

/** The grey of an end in one of the three states, and of a family past the eighth hue. */
export const KAPPA_NEUTRAL = "#7c7c8c";

/**
 * The glyph an end in each state carries — Cytoscape arrow shapes. A source end has no
 * arrowhead of its own, a target end keeps the direction triangle and adds the state to it.
 */
export const END_GLYPHS = Object.freeze({
  source: Object.freeze({ colour: "none", exempt: "tee", uncoloured: "circle" }),
  target: Object.freeze({ colour: "triangle", exempt: "triangle-tee", uncoloured: "circle-triangle" }),
});

/** The marker of an undeclared pair: a dotted line with a hollow diamond midway. */
export const UNDECLARED_MARKER = Object.freeze({ lineStyle: "dotted", midGlyph: "diamond" });

/** The three non-colour states, as the legend names them. */
export const KAPPA_STATES = Object.freeze([
  Object.freeze({
    state: "exempt",
    label: "exempt",
    glyph: "⊣",
    title: 'κ = "" — the port is exempt from the colour gate (98f2ccc kernels on ontology 4.0.x)',
  }),
  Object.freeze({
    state: "uncoloured",
    label: "uncoloured",
    glyph: "○",
    title: "the port is not in the engine's /operad/port-colors map",
  }),
  Object.freeze({
    state: "undeclared",
    label: "undeclared pair",
    glyph: "◇",
    title:
      "(src_port, tgt_port) is on no pair the engine's /operad/rewrite-categories declares — a pair check only; the workbench's check 8 rules on admission",
  }),
]);

/**
 * Whether a frame can be drawn in port colours: its grammar came from the engine and carries
 * the engine's port colours (t342 P1/P6 review: an engine may serve its pairs and types without).
 * @param {EngineGrammar | null | undefined} grammar
 * @returns {grammar is Extract<EngineGrammar, { status: "engine" }> & { port_colors: Record<string, string> }}
 */
export function hasPortColours(grammar) {
  return grammar?.status === "engine" && !!grammar.port_colors;
}

/** @type {WeakMap<object, Map<string, string | null>>} */
const HUES = new WeakMap();

/**
 * The colour families the engine reports, sorted, each with its hue (null past the eighth).
 * @param {EngineGrammar | null | undefined} grammar
 * @returns {{ family: string, hue: string | null }[]}
 */
export function kappaFamilies(grammar) {
  if (!hasPortColours(grammar)) return [];
  return [...hueMap(grammar)].map(([family, hue]) => ({ family, hue }));
}

/** @param {Extract<EngineGrammar, { status: "engine" }> & { port_colors: Record<string, string> }} grammar */
function hueMap(grammar) {
  let map = HUES.get(grammar);
  if (!map) {
    const families = [...new Set(Object.values(grammar.port_colors).filter((c) => c !== ""))].sort();
    map = new Map(families.map((f, i) => [f, KAPPA_HUES[i] ?? null]));
    HUES.set(grammar, map);
  }
  return map;
}

/**
 * @typedef {{
 *   port: string | null,
 *   state: "colour" | "exempt" | "uncoloured",
 *   family: string | null,
 *   hue: string,
 *   glyph: string,
 * }} KappaEnd
 * @typedef {{
 *   palette: "port",
 *   src: KappaEnd,
 *   tgt: KappaEnd,
 *   pair: "declared" | "undeclared",
 *   twoTone: boolean,
 * } | { palette: "kind" }} RelationPaint
 */

/**
 * How one relation is drawn in the port-colour palette — or `{ palette: "kind" }` when the
 * frame carries no engine grammar (the relation-kind palette is then the only one).
 * @param {Pick<HgRelation, "label" | "properties">} relation
 * @param {EngineGrammar | null | undefined} grammar
 * @returns {RelationPaint}
 */
export function paintRelation(relation, grammar) {
  if (!hasPortColours(grammar)) return { palette: "kind" };
  // The ports as the engine wrote them (transform.js mapRelation keeps both in properties);
  // a relation built without them is read by its label, which IS its src_port.
  const props = relation.properties ?? {};
  const mapped = "src_port" in props || "tgt_port" in props;
  const srcPort = typeof props.src_port === "string" ? props.src_port : mapped ? null : relation.label;
  const tgtPort = typeof props.tgt_port === "string" ? props.tgt_port : null;
  const hues = hueMap(grammar);
  /** @param {string | null} port @param {"source" | "target"} side @returns {KappaEnd} */
  const end = (port, side) => {
    const known = port !== null && Object.prototype.hasOwnProperty.call(grammar.port_colors, port);
    const colour = known ? grammar.port_colors[/** @type {string} */ (port)] : null;
    /** @type {KappaEnd["state"]} */
    const state = colour === null ? "uncoloured" : colour === "" ? "exempt" : "colour";
    return {
      port,
      state,
      family: state === "colour" ? colour : null,
      hue: (state === "colour" && hues.get(/** @type {string} */ (colour))) || KAPPA_NEUTRAL,
      glyph: END_GLYPHS[side][state],
    };
  };
  const src = end(srcPort, "source");
  const tgt = end(tgtPort, "target");
  return {
    palette: "port",
    src,
    tgt,
    pair: isDeclaredPair(grammar, srcPort, tgtPort) ? "declared" : "undeclared",
    twoTone: src.state !== tgt.state || src.family !== tgt.family,
  };
}

/**
 * The data FrameGraph gives each drawn relation for the port-colour style (the Cytoscape `edge.kappa` selector), or
 * null in the relation-kind palette. Hues and glyphs only — no family name, no port.
 * @param {RelationPaint} paint
 * @returns {{ ks: string, kt: string, kss: string, kts: string, kpair: string } | null}
 */
export function kappaRelationData(paint) {
  if (paint.palette !== "port") return null;
  return {
    ks: paint.src.hue,
    kt: paint.tgt.hue,
    kss: paint.src.glyph,
    kts: paint.tgt.glyph,
    kpair: paint.pair,
  };
}

/**
 * Counts for the legend and the smokes: ends per colour family, ends per state, relations on
 * an undeclared pair, two-tone relations, and relations left in the relation-kind palette.
 * @param {Pick<HgRelation, "label" | "properties">[]} relations
 * @param {EngineGrammar | null | undefined} grammar
 */
export function kappaCensus(relations, grammar) {
  /** @type {Record<string, number>} */
  const families = {};
  const out = { relations: 0, kind: 0, families, exempt: 0, uncoloured: 0, undeclared: 0, twoTone: 0 };
  for (const r of relations) {
    out.relations += 1;
    const paint = paintRelation(r, grammar);
    if (paint.palette !== "port") {
      out.kind += 1;
      continue;
    }
    for (const e of [paint.src, paint.tgt]) {
      if (e.state === "colour" && e.family) families[e.family] = (families[e.family] ?? 0) + 1;
      else if (e.state === "exempt") out.exempt += 1;
      else out.uncoloured += 1;
    }
    if (paint.pair === "undeclared") out.undeclared += 1;
    if (paint.twoTone) out.twoTone += 1;
  }
  return out;
}
