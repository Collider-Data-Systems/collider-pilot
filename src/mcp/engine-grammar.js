/**
 * Collider Pilot - the engine's grammar, read at run time (t342 P1 + P6, SHARED, READ-ONLY)
 * ======================================================================================
 * t342 work orders P6 and P1 (hand-off A): the port and type vocabulary of the drawer and
 * the port colour κ of every relation end come from the ENGINE the frame was read from, at
 * run time — never from a list or a colour map written into this public repo. Three GETs,
 * read once per (engine, ontology_version) and cached:
 *
 *   GET {engineUrl}/operad/node-types           the declared node types (the keys)
 *   GET {engineUrl}/operad/rewrite-categories   the declared port pairs: SrcPort/TgtPort of
 *                                               every rewrite_category + its AdditionalPortPairs
 *   GET {engineUrl}/operad/port-colors          `port_colors` (port -> colour family) and,
 *                                               on K1 builds, `color_rule` / `color_source`
 *
 * What is NOT read, on purpose (coloured-Poly verdict, poly-10 §4):
 *   - `matrix` in /operad/port-colors — the pilot never depends on it (K1 / O2 remove it);
 *   - `src_color` / `tgt_color` on a relation — empty on every relation today (they would
 *     read as "exempt"), and K1 drops them; nothing in the pilot reads them;
 *   - the kernel's type law. The pilot checks PAIRS only (is this (src_port, tgt_port)
 *     declared?); the workbench's check 8 is the authority on admission. t347 PIL-22: the type
 *     lists of each pair and each type's served ports are KEPT, for `interfaceOf` (a type's
 *     positions and directions, the Workbench's reading) — no relation is judged by them.
 *
 * An engine without these routes (an older kernel) is not an error: the grammar comes back
 * `{ status: "absent", reason }`, the drawer falls back to its static lists and the graph to
 * the relation-kind palette, and both say so. A frame is never failed for its grammar.
 * t342 P6/P1 (review): the drawer needs only the first two routes. An engine that serves them
 * but no port colours keeps its declared types and pairs (`status: "engine"`,
 * `port_colors: null` with its reason); only the graph falls back to relation kind.
 *
 * Shared JS + JSDoc (the transform.js discipline): the worker's adapter, the live harness
 * and `scripts/live-smoke.mjs` call the same code. Pure except `readEngineGrammar`, which
 * takes an injected fetch. GET only — no rewrite, no POST.
 *
 * @typedef {import("./types").EngineGrammar} EngineGrammar
 * @typedef {import("./types").GrammarPair} GrammarPair
 */

/** The three exact operad routes (the :8086 scratch proxy maps exactly these). */
export const OPERAD_PATHS = Object.freeze({
  nodeTypes: "/operad/node-types",
  rewriteCategories: "/operad/rewrite-categories",
  portColors: "/operad/port-colors",
});

/**
 * A port "name" written as a template — a name in braces. It is declared, but the drawer
 * does not offer it from the engine: only a fold that carries it as a label puts it in the
 * drawer, as a declared source port (GraphControls drawerVocab, t342 P6 review).
 * @param {unknown} name
 * @returns {boolean}
 */
export function isPlaceholderPort(name) {
  return typeof name === "string" && /^\{[^}]*\}$/.test(name);
}

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** @param {unknown} v @returns {string | null} */
const str = (v) => (typeof v === "string" && v.length > 0 ? v : null);

/** The key a declared pair is looked up by. @param {string} s @param {string} t */
const pairKey = (s, t) => `${s}\u0000${t}`;

/**
 * t347 PIL-22: a type list as the engine serves it (`SrcTypes` / `src_types`, a Go nil slice is
 * `null`): the strings, in the served order. Absent or null is the empty list, which — like `*` —
 * admits every type (the Workbench's reading, `admitsType`).
 * @param {unknown} v
 * @returns {string[]}
 */
const typeList = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === "string" && t.length > 0) : []);

/**
 * t347 PIL-22: whether a type list admits a type — it holds `*`, the type, or nothing (the
 * Workbench's reading, operad-lib.js `admitsType`).
 * @param {readonly string[]} list
 * @param {string} type
 */
const admitsType = (list, type) => list.length === 0 || list.includes("*") || list.includes(type);

/** t347 PIL-22: a list that admits every type (empty, or holding `*`). @param {readonly string[]} list */
const everyType = (list) => list.length === 0 || list.includes("*");

/**
 * t347 PIL-22: the type lists of two declared pairs with the same two port names, merged — so the
 * one pair kept admits a type exactly when either did. The union, in order; and since an empty list
 * admits every type, a union that no longer reads so (one list empty, the other not) gains `*`.
 * @param {string[]} kept
 * @param {string[]} other
 * @returns {string[]}
 */
function mergeTypeLists(kept, other) {
  const merged = [...new Set([...kept, ...other])];
  return (everyType(kept) || everyType(other)) && !everyType(merged) ? ["*", ...merged] : merged;
}

/**
 * t347 PIL-22: a type's ports as the engine serves them (`Ports: {Out, In, Self}` in the kernel's
 * Go JSON, `ports: {out, in, self}` in a file), or null when the entry carries no ports block.
 * @param {unknown} entry
 * @returns {import("./types").GrammarTypePorts | null}
 */
function servedPorts(entry) {
  if (!isObject(entry)) return null;
  const p = entry.Ports ?? entry.ports;
  if (!isObject(p)) return null;
  return { out: typeList(p.Out ?? p.out), in: typeList(p.In ?? p.in), self: typeList(p.Self ?? p.self) };
}

/**
 * Normalise the three operad bodies into the grammar a frame carries. Tolerant of the two
 * spellings a kernel may use (`SrcPort` / `src_port`, keyed object / array) and of keys it
 * does not know; never reads `matrix`.
 *
 * @param {{ nodeTypes: unknown, rewriteCategories: unknown, portColors: unknown }} raw
 * @param {{ source: string, ontology_version: string }} meta
 * @returns {EngineGrammar}
 */
export function normalizeEngineGrammar(raw, meta) {
  const absent = (/** @type {string} */ reason) => ({
    status: /** @type {const} */ ("absent"),
    source: meta.source,
    ontology_version: meta.ontology_version,
    reason,
  });

  // Rewrite categories: { WF01: {...}, … } or [ {...}, … ].
  const rc = raw.rewriteCategories;
  const categories = Array.isArray(rc)
    ? rc.map((wf) => /** @type {[string | null, any]} */ ([null, wf]))
    : isObject(rc)
      ? Object.entries(rc)
      : null;
  if (!categories) return absent(`${OPERAD_PATHS.rewriteCategories} is not a list of rewrite categories`);
  /** @type {GrammarPair[]} */
  const pairs = [];
  /** @type {Map<string, GrammarPair>} */
  const seen = new Map();
  for (const [key, wf] of categories) {
    if (!isObject(wf)) continue;
    const category = str(wf.ID) ?? str(wf.id) ?? str(key) ?? "";
    const extra = wf.AdditionalPortPairs ?? wf.additional_port_pairs;
    for (const p of [wf, ...(Array.isArray(extra) ? extra : [])]) {
      if (!isObject(p)) continue;
      const src = str(p.SrcPort) ?? str(p.src_port);
      const tgt = str(p.TgtPort) ?? str(p.tgt_port);
      if (!src || !tgt) continue;
      // t347 PIL-22: each pair keeps the type lists the engine serves on it (additional pairs
      // carry their own). A second pair with the same two names is not a second pair here: its
      // lists are merged into the first, so no type it admits is lost.
      const srcTypes = typeList(p.SrcTypes ?? p.src_types);
      const tgtTypes = typeList(p.TgtTypes ?? p.tgt_types);
      const first = seen.get(pairKey(src, tgt));
      if (first) {
        first.src_types = mergeTypeLists(first.src_types, srcTypes);
        first.tgt_types = mergeTypeLists(first.tgt_types, tgtTypes);
        continue;
      }
      const pair = { src_port: src, tgt_port: tgt, rewrite_category: category, src_types: srcTypes, tgt_types: tgtTypes };
      seen.set(pairKey(src, tgt), pair);
      pairs.push(pair);
    }
  }
  if (pairs.length === 0) return absent(`${OPERAD_PATHS.rewriteCategories} declares no port pair`);

  // Node types: { agent: {...}, … } or [ { ID: "agent" }, … ].
  const nt = raw.nodeTypes;
  const typeEntries = Array.isArray(nt)
    ? nt.map((t) => /** @type {[string | null, unknown]} */ ([isObject(t) ? (str(t.ID) ?? str(t.id)) : str(t), t]))
    : isObject(nt)
      ? Object.entries(nt)
      : null;
  if (!typeEntries) return absent(`${OPERAD_PATHS.nodeTypes} is not a list of node types`);
  const typeNames = typeEntries.map(([name]) => name);
  const types = [...new Set(typeNames.filter((t) => typeof t === "string" && t.length > 0))].sort();
  // t347 PIL-22: each type's ports as served ({out, in, self}), for every entry that carries a
  // ports block; the first entry of a name wins.
  /** @type {Map<string, import("./types").GrammarTypePorts>} */
  const portsByType = new Map();
  for (const [name, entry] of typeEntries) {
    const ports = servedPorts(entry);
    if (typeof name === "string" && name.length > 0 && ports && !portsByType.has(name)) portsByType.set(name, ports);
  }
  // fromEntries makes every name an own key (a type called "__proto__" included).
  const typePorts = Object.fromEntries(portsByType);

  // Port colours: `port_colors` only (never `matrix`), plus K1's two additive keys. Without
  // them the declared pairs and types still stand (P6); only κ is missing (t342 P6 review).
  const pc = raw.portColors;
  /** @type {Record<string, string> | null} */
  let portColors = null;
  if (isObject(pc) && isObject(pc.port_colors)) {
    portColors = {};
    for (const [port, colour] of Object.entries(pc.port_colors)) {
      if (typeof colour === "string") portColors[port] = colour;
    }
  }

  const named = (/** @type {(p: GrammarPair) => string[]} */ ends) =>
    [...new Set(pairs.flatMap(ends))].filter((p) => !isPlaceholderPort(p)).sort();
  // t347 PIL-21 (the rest of PIL-16), condition (b2): where the declared pairs give a name more
  // than one converse, † is not a function there — recorded once, at grammar load.
  const converseNotFunction = conversesOf(pairs)
    .filter(([, converses]) => converses.length > 1)
    .map(([name, converses]) => ({ name, converses }));
  return {
    status: "engine",
    source: meta.source,
    ontology_version: meta.ontology_version,
    pairs,
    src_ports: named((p) => [p.src_port]),
    ports: named((p) => [p.src_port, p.tgt_port]),
    types,
    type_ports: typePorts,
    converse_not_function: converseNotFunction,
    port_colors: portColors,
    port_colors_reason: portColors ? null : `${OPERAD_PATHS.portColors} carries no port_colors`,
    color_rule: portColors && isObject(pc) ? str(pc.color_rule) : null,
    color_source: portColors && isObject(pc) ? str(pc.color_source) : null,
  };
}

/**
 * Whether (src_port, tgt_port) is a pair the grammar declares — the PAIR check only.
 * @param {EngineGrammar | null | undefined} grammar
 * @param {unknown} srcPort
 * @param {unknown} tgtPort
 * @returns {boolean}
 */
export function isDeclaredPair(grammar, srcPort, tgtPort) {
  if (grammar?.status !== "engine" || typeof srcPort !== "string" || typeof tgtPort !== "string") {
    return false;
  }
  let index = PAIR_INDEX.get(grammar);
  if (!index) {
    index = new Set(grammar.pairs.map((p) => pairKey(p.src_port, p.tgt_port)));
    PAIR_INDEX.set(grammar, index);
  }
  return index.has(pairKey(srcPort, tgtPort));
}
/** @type {WeakMap<object, Set<string>>} */
const PAIR_INDEX = new WeakMap();

/**
 * t347 PIL-22: one node type as an interface, read from the engine's declared pairs with the
 * Workbench's reading (mtdc-lab operad-lib.js `interfaceOf`, WB-12): its positions are the
 * out-names of the pairs whose source list admits the type, its directions the in-names of the
 * pairs whose target list admits it, each in the order the pairs first give them. A list admits
 * a type when it holds `*`, the type, or nothing; a pair with a `{placeholder}` name at either end
 * names no port and is skipped. `self` is the type's served `Ports.Self` (no pair describes it).
 * Null without an engine grammar, for a type the engine does not declare, or on a grammar read
 * before PIL-22 (its pairs carry no type lists). Pure; nothing draws it yet (PIL-17 will).
 * @param {EngineGrammar | null | undefined} grammar
 * @param {unknown} type
 * @returns {{ positions: string[], directions: string[], self: string[] } | null}
 */
export function interfaceOf(grammar, type) {
  if (grammar?.status !== "engine" || typeof type !== "string" || !grammar.types.includes(type)) return null;
  if (!grammar.pairs.every((p) => Array.isArray(p.src_types) && Array.isArray(p.tgt_types))) return null;
  /** @type {string[]} */
  const positions = [];
  /** @type {string[]} */
  const directions = [];
  for (const p of grammar.pairs) {
    if (isPlaceholderPort(p.src_port) || isPlaceholderPort(p.tgt_port)) continue;
    if (admitsType(p.src_types, type) && !positions.includes(p.src_port)) positions.push(p.src_port);
    if (admitsType(p.tgt_types, type) && !directions.includes(p.tgt_port)) directions.push(p.tgt_port);
  }
  const served = grammar.type_ports && Object.prototype.hasOwnProperty.call(grammar.type_ports, type)
    ? grammar.type_ports[type]
    : null;
  return { positions, directions, self: [...(served?.self ?? [])] };
}

/**
 * t344 PIL-14: the converse of a port name from the engine's declared pairs — every port that a
 * declared pair puts at the OTHER end from `port` (main and additional pairs, either side),
 * sorted. On a grammar where the converse is a function (mtdc-2.2.0: each of its 89 names on
 * exactly one pair) this is one name, and a self-converse port gives itself; where it is not
 * (4.0.9 declares one port on two pairs) it is every name, never one picked. Empty without an
 * engine grammar or for a port on no declared pair. The idea is b85f0dd's getConversePorts
 * (the laptop Antigravity seat), written fresh here.
 * @param {EngineGrammar | null | undefined} grammar
 * @param {unknown} port
 * @returns {string[]}
 */
export function conversePorts(grammar, port) {
  if (grammar?.status !== "engine" || typeof port !== "string") return [];
  let index = CONVERSE_INDEX.get(grammar);
  if (!index) {
    index = new Map(conversesOf(grammar.pairs).map(([name, list]) => [name, Object.freeze(list)]));
    CONVERSE_INDEX.set(grammar, index);
  }
  return [...(index.get(port) ?? [])];
}
/** @type {WeakMap<object, Map<string, readonly string[]>>} */
const CONVERSE_INDEX = new WeakMap();

/**
 * Every name on a declared pair (either end, placeholders included, as the Workbench lists them)
 * with the names a pair puts opposite it, both sorted.
 * @param {readonly { src_port: string, tgt_port: string }[]} pairs
 * @returns {[string, string[]][]}
 */
function conversesOf(pairs) {
  /** @type {Map<string, Set<string>>} */
  const sets = new Map();
  const add = (/** @type {string} */ from, /** @type {string} */ to) => {
    const set = sets.get(from) ?? new Set();
    set.add(to);
    sets.set(from, set);
  };
  for (const p of pairs) {
    add(p.src_port, p.tgt_port);
    add(p.tgt_port, p.src_port);
  }
  return [...sets].map(([name, set]) => /** @type {[string, string[]]} */ ([name, [...set].sort()])).sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );
}

/**
 * t347 PIL-21 (the rest of PIL-16): condition (b2) at one port — do the engine's declared pairs
 * give `port` exactly one converse? Null when they do (or the port is on no pair, or there is no
 * engine grammar); where they do not, † is not a function at `port` and this is its converses,
 * sorted — the Workbench's "† is not a function here (…)" (WB-14). Read from the grammar's
 * `converse_not_function`, computed once at grammar load; a grammar stamped before PIL-21 has
 * none, and the pairs are read instead.
 * @param {EngineGrammar | null | undefined} grammar
 * @param {unknown} port
 * @returns {string[] | null}
 */
export function converseFault(grammar, port) {
  if (grammar?.status !== "engine" || typeof port !== "string") return null;
  const listed = grammar.converse_not_function;
  if (Array.isArray(listed)) {
    const hit = listed.find((x) => x.name === port);
    return hit ? [...hit.converses] : null;
  }
  const names = conversePorts(grammar, port);
  return names.length > 1 ? names : null;
}

/**
 * t342 P1/P6 (review): what is missing, in a few words, for the legend, the drawer note and the
 * audit drawer. An engine that serves no `/operad/*` is not one whose routes did not answer
 * this time, and neither is an engine that serves its pairs and types but no port colours.
 * Null when the frame carries the whole grammar.
 * @param {EngineGrammar | null | undefined} grammar
 * @returns {string | null}
 */
export function grammarGap(grammar) {
  if (!grammar) return "no engine grammar on this frame";
  if (grammar.status !== "engine") {
    return grammar.unreachable
      ? "the engine's /operad/* did not answer"
      : "the engine serves no /operad/*";
  }
  // t347 PIL-20: in the legend's words — the colour is the relation's; the engine gives each port a family.
  if (!grammar.port_colors) return `the engine serves no colour families`;
  return null;
}

/**
 * One line for the audit drawer and the legend: which grammar this frame was drawn with.
 * @param {EngineGrammar | null | undefined} grammar
 * @returns {string}
 */
export function grammarSummary(grammar) {
  if (!grammar) return "no engine grammar on this frame (a fixture, or a frame cached before t342)";
  if (grammar.status !== "engine") {
    return `${grammarGap(grammar)} (${grammar.reason}) — static lists, relation-kind palette`;
  }
  const declared =
    `engine operad ${grammar.ontology_version} · ${grammar.pairs.length} port pairs · ` +
    `${grammar.types.length} types`;
  if (!grammar.port_colors) {
    return `${declared} · no κ (${grammar.port_colors_reason}) — relation-kind palette`;
  }
  return (
    `${declared} · κ from ${OPERAD_PATHS.portColors} ` +
    `(${Object.keys(grammar.port_colors).length} ports; rule ${grammar.color_rule ?? "not stated"}; ` +
    `source ${grammar.color_source ?? "not stated"})`
  );
}

/* -------------------------------------------------------------------------- */
/* The read — three GETs, cached per (engine, ontology_version)               */
/* -------------------------------------------------------------------------- */

/** @type {Map<string, { promise: Promise<EngineGrammar>, until: number }>} */
const CACHE = new Map();
const CACHE_MAX = 16;

/**
 * t342 P1/P6: how long one grammar GET may take (ms) — the longest a frame waits for its
 * grammar. A route that does not answer in time gives `absent` (`unreachable`) and the frame
 * lands with the static lists and the relation-kind palette.
 */
export const GRAMMAR_TIMEOUT_MS = 8000;

/**
 * t342 P1/P6 (review): how long an `unreachable` answer (a timeout, a network failure, a 5xx) is
 * kept (ms) before a frame asks again — so a route that hangs costs one frame up to
 * GRAMMAR_TIMEOUT_MS per window, not every frame (each fold-stream re-read is a frame).
 */
export const GRAMMAR_RETRY_MS = 60000;

/** Drop every cached grammar (the smokes use it; nothing in the panel needs to). */
export function clearEngineGrammarCache() {
  CACHE.clear();
}

/**
 * Read the engine's grammar, once per (engine, ontology_version). A route the engine does
 * not serve (404 / 405 / 501) is cached like an answer: no node types or no rewrite
 * categories gives `status: "absent"`, no port colours an engine grammar without κ. A
 * network failure, a timeout (GRAMMAR_TIMEOUT_MS) or a 5xx gives `absent` with
 * `unreachable: true`, kept for GRAMMAR_RETRY_MS only, so a later frame asks again. Never
 * throws.
 *
 * @param {{
 *   engineUrl: string,
 *   healthz?: { ontology_version?: unknown } | null,
 *   fetchImpl?: typeof fetch,
 *   headers?: Record<string, string>,
 *   timeoutMs?: number,
 *   retryMs?: number,
 * }} opts
 * @returns {Promise<EngineGrammar>}
 */
export function readEngineGrammar(opts) {
  const engineUrl = String(opts.engineUrl || "").replace(/\/+$/, "");
  const ontology =
    typeof opts.healthz?.ontology_version === "string" && opts.healthz.ontology_version
      ? opts.healthz.ontology_version
      : "unknown";
  const key = `${engineUrl}\n${ontology}`;
  const cached = CACHE.get(key);
  if (cached && cached.until > Date.now()) return cached.promise;
  if (cached) CACHE.delete(key);
  const fetchImpl = opts.fetchImpl || fetch;
  const headers = { Accept: "application/json", ...(opts.headers || {}) };
  const meta = { source: engineUrl, ontology_version: ontology };
  const timeoutMs = opts.timeoutMs ?? GRAMMAR_TIMEOUT_MS;
  const retryMs = opts.retryMs ?? GRAMMAR_RETRY_MS;

  /** @param {string} path */
  const get = async (path) => {
    // t342 P1/P6: bounded, so a route that hangs holds the frame GRAMMAR_TIMEOUT_MS at most
    // (the body read too).
    const signal =
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
    const res = await fetchImpl(`${engineUrl}${path}`, {
      method: "GET",
      headers,
      ...(signal ? { signal } : {}),
    });
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      return { missing: `${path} answered HTTP ${res.status}` };
    }
    if (!res.ok) throw new Error(`${path} answered HTTP ${res.status}`);
    return { body: JSON.parse(await res.text()) };
  };

  let transient = false;
  const promise = (async () => {
    try {
      const [nodeTypes, rewriteCategories, portColors] = await Promise.all([
        get(OPERAD_PATHS.nodeTypes),
        get(OPERAD_PATHS.rewriteCategories),
        get(OPERAD_PATHS.portColors),
      ]);
      // The drawer's vocabulary needs node types and rewrite categories; port colours give κ
      // only, so an engine without them keeps its pairs and types (t342 P6 review).
      const missing = [nodeTypes, rewriteCategories].find((r) => "missing" in r);
      if (missing && "missing" in missing) {
        return /** @type {EngineGrammar} */ ({ status: "absent", ...meta, reason: missing.missing });
      }
      const grammar = normalizeEngineGrammar(
        {
          nodeTypes: /** @type {any} */ (nodeTypes).body,
          rewriteCategories: /** @type {any} */ (rewriteCategories).body,
          portColors: "missing" in portColors ? null : /** @type {any} */ (portColors).body,
        },
        meta,
      );
      if (grammar.status === "engine" && "missing" in portColors && portColors.missing) {
        grammar.port_colors_reason = portColors.missing;
      }
      return grammar;
    } catch (err) {
      transient = true;
      return /** @type {EngineGrammar} */ ({
        status: "absent",
        ...meta,
        reason: `operad routes unreachable: ${err instanceof Error ? err.message : String(err)}`,
        unreachable: true,
      });
    }
  })();
  if (CACHE.size >= CACHE_MAX) {
    const oldest = CACHE.keys().next().value;
    if (oldest !== undefined) CACHE.delete(oldest);
  }
  const entry = { promise, until: Number.POSITIVE_INFINITY };
  CACHE.set(key, entry);
  void promise.then(() => {
    // t342 P1/P6 (review): an unreachable answer is kept for a short back-off, not for good.
    if (transient) entry.until = Date.now() + retryMs;
  });
  return promise;
}
