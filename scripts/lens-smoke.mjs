/**
 * Collider Pilot — LENS VOCABULARY smoke test
 * ===========================================
 * Pure, offline, no engine. Guards the one invariant that has already broken twice — in #42
 * (`substrate`) and, undetected until this script first ran, in the `topology` tooltip: the
 * lens vocabulary lives in THREE hand-maintained lists in
 * `src/components/GraphControls.tsx` and nothing made them agree.
 *
 *   A. Every lens's `types` is a subset of ALL_TYPES, and its `ports` a subset of ALL_PORTS.
 *      ALL_TYPES/ALL_PORTS are flattened from TYPE_GROUPS/PORT_GROUPS, so a name in a lens but
 *      in no group is invisible in the advanced drawer and unreachable by `specTogglePort`,
 *      whose expand-from-all base is ALL_PORTS. In #42 `hosted-on` and `sync-target` were
 *      exactly this.
 *   B. A lens tooltip that enumerates its slice must NAME every type and port the lens
 *      selects — membership, not set equality. A lens must never be wider than it says.
 *      In #42 the substrate tooltip omitted 2 types and 4 ports; a pre-existing `topology`
 *      drift (3 unnamed types) was found by this check on its first run. Deliberately not
 *      set equality: tooltips carry prose between the names, and parsing them into a list
 *      mis-reads that as drift — the first version of this script did exactly that and
 *      false-positived on `identity`.
 *   C. No duplicate ids, and every lens is non-empty (except the `["*"]` sentinel).
 *   D. (t337) The knowledge vocabulary has ONE source. `src/ui/kb-vocab.json` is the
 *      Lean-emitted file, byte for byte as PROVENANCE.md records it; only
 *      `src/ui/kb-vocab.js` imports it; and no port name or colour it declares is written
 *      as a string literal anywhere else in `src/` or `scripts/`. The knowledge lens and
 *      port group above are built from it, so a restated name would be a second copy that
 *      can drift — the failure this script exists for.
 *   E. (t342) The panel opens un-narrowed: `defaultSliceSpec()` is the `everything` sentinel.
 *      Sam's ruling, held as a gate rather than a comment — a later "sensible default" lens
 *      would otherwise quietly narrow the opening view again.
 *   F. (t342) The strip's counts are honest: `provenance.fold_counts` (the REAL transform, on
 *      a synthetic fold) counts what the access posture alone withheld over the whole fold,
 *      apart from what the lens narrowed — narrowing the lens never moves the access number.
 *      (t342 P6 review) `provenance.fold_vocab`, which the drawer offers, obeys access the
 *      same way: no type of a withheld node, no label of a relation touching one.
 *   G. (t342) The unlinked band takes exactly the nodes no relation of the CURRENT frame
 *      touches (`unlinkedUrns`, the real FrameGraph.tsx rule — nothing is drawn).
 *   H. (t342 P1) Relation ends are coloured by the engine's port colours κ: on a SYNTHETIC
 *      grammar (no operad data in this public repo), through the real engine-grammar.js and
 *      port-colour.js — one hue when the ends share a family, two tones when not, and the
 *      three non-colour states (exempt, uncoloured, undeclared pair) each with its own glyph
 *      and no hue; no grammar falls back to relation kind; node fills share no colour with
 *      the eight κ hues; no code under src/ reads a relation's src_color / tgt_color. The read
 *      on an injected fetch: color_rule / color_source when stated, never `matrix`, three GETs
 *      per (engine, ontology_version) then the cache, 404 -> absent (cached), a hung route cut
 *      at the timeout (absent, unreachable, kept for the back-off only).
 *      (t342 P1 review) What is DRAWN, not only the paint plan: FrameGraph's real toElements,
 *      STYLE and applyPalette in headless Cytoscape — every relation in port colour carries
 *      its κ and is drawn in it, and none after the switch to relation kind. No κ hue nor the
 *      state grey within OKLab ΔE 3 of a node fill, and no close pair beyond those TESTING.md
 *      records. An engine without port colours keeps its pairs and types.
 *   I. (t342 P6) The drawer offers the static groups (A-C) first, then the types and source
 *      ports the ENGINE declares and the permitted fold's own labels (the real drawerVocab);
 *      an untick expands from all of it; the legacy list is a group of its own; a fold label
 *      that is a declared `{placeholder}` source port is an engine port, not "undeclared pair".
 *      The live counterpart — every live label reachable, all declared types reachable, every
 *      lens port declared by the connected engine — is `smoke:live` (d), (h) and (i).
 *
 * WHY IT IS A SCRIPT AND NOT A SKILL: a capability that exists only as a SKILL.md cannot be
 * invoked by the Antigravity, VS Code or Codex seats. Script first, pointer in AGENTS.md,
 * skills may wrap it.
 *
 * HOW IT READS A .tsx FROM NODE: `typescript` is already a devDependency, so the file is
 * type-stripped in memory with `ts.transpileModule` (a syntactic transform, no type-check, no
 * new dependency) and imported as a data module. GraphControls exports plain consts; nothing
 * renders.
 *
 * Run:  npm run smoke:lens     (exit 0 iff every assertion holds)
 */

import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import cytoscape from "cytoscape";
import { KB_CLAIM_KINDS, KB_RELATIONS, kbPortStyle } from "../src/ui/kb-vocab.js";
import { selectFrame } from "../src/mcp/transform.js";
// t342 P1/P6: the engine-grammar normaliser and the port-colour painter, as the panel runs them.
import {
  clearEngineGrammarCache,
  grammarGap,
  isPlaceholderPort,
  normalizeEngineGrammar,
  readEngineGrammar,
} from "../src/mcp/engine-grammar.js";
import {
  END_GLYPHS,
  KAPPA_HUES,
  KAPPA_NEUTRAL,
  UNDECLARED_MARKER,
  kappaCensus,
  kappaRelationData,
  kappaFamilies,
  paintRelation,
} from "../src/ui/port-colour.js";

const SRC = resolve(process.cwd(), "src/components/GraphControls.tsx");

let failures = 0;
const fail = (msg) => {
  console.error(`  [FAIL] ${msg}`);
  failures++;
};
const pass = (msg) => console.log(`  [PASS] ${msg}`);

/** Type-strip the .tsx and import it for its exported data. */
async function loadModule() {
  const js = ts.transpileModule(readFileSync(SRC, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: SRC,
  }).outputText;

  // Emit beside the source so its relative imports (react/jsx-runtime, ./…) still resolve.
  // The copy sits ONE directory deeper than the source, so every relative specifier gains
  // a `../` — parent-relative ones FIRST, or the sibling rewrite would apply to them twice.
  // t337: GraphControls imports the knowledge vocabulary (`../ui/kb-vocab.js`, shared JS
  // that Node loads as-is), so the knowledge lens and port group are checked against the
  // SAME Lean-emitted vocabulary the panel reads — nothing is restated here.
  const dir = mkdtempSync(join(resolve(process.cwd(), "src/components"), ".lens-smoke-"));
  const out = join(dir, "GraphControls.mjs");
  writeFileSync(
    out,
    js
      .replaceAll('from "../', 'from "../../')
      .replaceAll("from '../", "from '../../")
      .replaceAll('from "./', 'from "../')
      .replaceAll("from './", "from '../"),
  );
  try {
    return await import(pathToFileURL(out).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * t342: type-strip `FrameGraph.tsx` for its pure exports, as live-smoke.mjs does — beside the
 * source, next to the one TypeScript module it imports a VALUE from (`state/prefs.ts`).
 * React and Cytoscape are only loaded; nothing mounts or draws.
 */
async function loadFrameGraph() {
  const strip = (file) =>
    ts.transpileModule(readFileSync(resolve(process.cwd(), file), "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
  const dir = mkdtempSync(join(resolve(process.cwd(), "src/components"), ".lens-smoke-"));
  try {
    writeFileSync(join(dir, "prefs.mjs"), strip("src/state/prefs.ts"));
    writeFileSync(
      join(dir, "FrameGraph.mjs"),
      strip("src/components/FrameGraph.tsx")
        .replaceAll('from "../state/prefs"', 'from "./prefs.mjs"')
        .replaceAll('from "../', 'from "../../'),
    );
    return await import(pathToFileURL(join(dir, "FrameGraph.mjs")).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * t342 P1 (review): what FrameGraph is asked to DRAW — its real toElements, STYLE and
 * applyPalette in headless Cytoscape (no canvas, nothing mounts). In port colour every
 * relation must carry the `kappa` class and its κ data and be drawn in them: its hue (one, or
 * two tones split at the middle), its end glyphs, the undeclared-pair marker, and a neutral
 * end always with its state's glyph. After the switch to relation kind none may: the
 * knowledge vocabulary's colour, or the default line. `smoke:live` (i) runs the same on the
 * live fold.
 */
function drawCheck(fg, frame) {
  const rgb = (hex) => [0, 2, 4].map((i) => parseInt(String(hex).replace("#", "").slice(i, i + 2), 16)).join();
  const col = (v) => (Array.isArray(v) ? v.join() : String(v));
  const kappaRgb = new Set([...KAPPA_HUES, KAPPA_NEUTRAL].map(rgb));
  const neutral = rgb(KAPPA_NEUTRAL);
  const baseLine = fg.STYLE.find((s) => s.selector === "edge").style["line-color"];
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    elements: fg.toElements(frame, new Map(), new Set()),
    style: fg.STYLE,
  });
  const val = (e, k) => e.pstyle(k).value;
  try {
    fg.applyPalette(cy, true);
    const port = { edges: 0, kind: 0, wrong: [] };
    cy.edges().forEach((e) => {
      port.edges += 1;
      const d = e.data();
      if (!e.hasClass("kappa") || typeof d.ks !== "string" || typeof d.kt !== "string") {
        port.kind += 1;
        return;
      }
      const [ks, kt] = [rgb(d.ks), rgb(d.kt)];
      const stops = val(e, "line-gradient-stop-colors").map(col);
      const undeclared = d.kpair === "undeclared";
      const ok =
        (ks === kt
          ? val(e, "line-fill") === "solid" && col(val(e, "line-color")) === ks
          : val(e, "line-fill") === "linear-gradient" && stops[0] === ks && stops[stops.length - 1] === kt) &&
        kappaRgb.has(ks) && kappaRgb.has(kt) &&
        val(e, "source-arrow-shape") === d.kss && val(e, "target-arrow-shape") === d.kts &&
        // both ends of the uncoloured state are hollow, every other end filled (Copilot on #46)
        val(e, "source-arrow-fill") === (d.kss === END_GLYPHS.source.uncoloured ? "hollow" : "filled") &&
        val(e, "target-arrow-fill") === (d.kts === END_GLYPHS.target.uncoloured ? "hollow" : "filled") &&
        (ks === neutral) === (d.kss !== END_GLYPHS.source.colour) &&
        (kt === neutral) === (d.kts !== END_GLYPHS.target.colour) &&
        val(e, "line-style") === (undeclared ? UNDECLARED_MARKER.lineStyle : "solid") &&
        val(e, "mid-target-arrow-shape") === (undeclared ? UNDECLARED_MARKER.midGlyph : "none");
      if (!ok) port.wrong.push(String(d.label));
    });
    fg.applyPalette(cy, false);
    const kind = { edges: 0, port: 0, wrong: [] };
    cy.edges().forEach((e) => {
      kind.edges += 1;
      if (e.hasClass("kappa")) {
        kind.port += 1;
        return;
      }
      const want = rgb(kbPortStyle(e.data("label"))?.color ?? baseLine);
      if (col(val(e, "line-color")) !== want || val(e, "line-fill") !== "solid") {
        kind.wrong.push(String(e.data("label")));
      }
    });
    return { port, kind };
  } finally {
    cy.destroy();
  }
}

const m = await loadModule();
const { LENSES, ALL_TYPES, ALL_PORTS } = m;

console.log(`lens-smoke — ${LENSES.length} lenses, ${ALL_TYPES.length} grouped types, ${ALL_PORTS.length} grouped ports\n`);

// A — reachability from the advanced drawer
console.log("A. every lens's vocabulary is reachable from the advanced drawer");
for (const l of LENSES) {
  const missingT = l.types.includes("*") ? [] : l.types.filter((t) => !ALL_TYPES.includes(t));
  const missingP = l.ports.filter((p) => !ALL_PORTS.includes(p));
  if (missingT.length || missingP.length) {
    fail(
      `lens '${l.id}': types missing from TYPE_GROUPS [${missingT}], ` +
        `ports missing from PORT_GROUPS [${missingP}] — invisible in the drawer`
    );
  }
}
if (!failures) pass(`all ${LENSES.length} lenses are subsets of ALL_TYPES / ALL_PORTS`);

// B — a tooltip that enumerates must not UNDERSELL the slice.
//
// Deliberately NOT a set-equality check against a parsed list. Tooltips carry prose between
// the names ("…presents-as, and the 4.0.5 kinship ports parent-of / …"), and a parser that
// splits on a separator mis-reads that as a drift. The first version of this script did
// exactly that and reported a false positive on `identity`.
//
// The property that matters is membership, and it is prose-proof: every type and port the
// lens actually selects must appear verbatim in the tooltip that claims to enumerate it.
// That is the direction the reader is misled by — a slice wider than it says it is.
console.log("\nB. enumerating tooltips name every type and port the lens selects");
let checked = 0;
const namesIn = (title, name) =>
  new RegExp(`(^|[^A-Za-z0-9_-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_-]|$)`).test(title);
for (const l of LENSES) {
  if (!/\(.*·.*\)/.test(l.title)) continue; // tooltip does not enumerate — nothing to check
  const missing = [
    ...l.types.filter((t) => t !== "*" && !namesIn(l.title, t)).map((t) => `type ${t}`),
    ...l.ports.filter((p) => !namesIn(l.title, p)).map((p) => `port ${p}`),
  ];
  if (missing.length) {
    fail(
      `lens '${l.id}' tooltip enumerates its slice but omits ${missing.length}: ` +
        `${missing.join(", ")} — the lens is wider than it says`
    );
  }
  checked++;
}
pass(`${checked} enumerating tooltip(s) checked`);

// C — structural sanity
console.log("\nC. ids unique, lenses non-empty");
const ids = LENSES.map((l) => l.id);
if (new Set(ids).size !== ids.length) fail(`duplicate lens ids in ${ids}`);
for (const l of LENSES) {
  if (!l.types.length) fail(`lens '${l.id}' selects no types`);
  if (!l.title?.trim()) fail(`lens '${l.id}' has no tooltip`);
}
if (!failures) pass(`${ids.length} unique ids, all non-empty`);

// D — the knowledge vocabulary has one source (t337).
console.log("\nD. the knowledge vocabulary is read from one file, never restated");
const VOCAB_JSON = "src/ui/kb-vocab.json";
const VOCAB_READER = "src/ui/kb-vocab.js";
const before = failures;

// D1. The vendored file is the emitted one: PROVENANCE.md records its size and sha256.
const vocabBytes = readFileSync(resolve(process.cwd(), VOCAB_JSON));
const recorded = readFileSync(resolve(process.cwd(), "PROVENANCE.md"), "utf8").match(
  /(\d+) bytes, sha256 `([0-9a-f]{64})`/,
);
const sha = createHash("sha256").update(vocabBytes).digest("hex");
if (!recorded) {
  fail("PROVENANCE.md no longer records the size and sha256 of the vendored vocabulary");
} else if (Number(recorded[1]) !== vocabBytes.length || recorded[2] !== sha) {
  fail(
    `${VOCAB_JSON} is ${vocabBytes.length} bytes, sha256 ${sha} — PROVENANCE.md records ` +
      `${recorded[1]} bytes, sha256 ${recorded[2]}. The file is never edited here: re-emit it ` +
      "from Vocab.lean, replace it whole, and record the new size and sha256."
  );
}

// D2 + D3. Walk every code file (parsed, so a name in a comment or inside prose is not a
// hit): who imports the file, and every string literal. A port name counts when a literal
// IS that name; a colour when a literal contains it.
const portNames = new Set(KB_RELATIONS.flatMap((r) => [r.src_port, r.tgt_port]));
const colours = [...KB_RELATIONS, ...KB_CLAIM_KINDS].map((x) => x.display.toLowerCase());
const codeFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) codeFiles.push(full);
  }
};
walk(resolve(process.cwd(), "src"));
walk(resolve(process.cwd(), "scripts"));
const kindOf = (file) =>
  file.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : file.endsWith(".ts")
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS;
/** The module a node imports (static, re-export or dynamic import), or null. */
const importedModule = (node) => {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
    return node.moduleSpecifier.text ?? null;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return node.arguments[0]?.text ?? null;
  }
  return null;
};
let literals = 0;
for (const file of codeFiles) {
  const rel = relative(process.cwd(), file).replaceAll("\\", "/");
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kindOf(file));
  const visit = (node) => {
    const at = `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
    if (importedModule(node)?.endsWith("kb-vocab.json") && rel !== VOCAB_READER) {
      fail(`${at} imports ${VOCAB_JSON} itself — only ${VOCAB_READER} may`);
    }
    // A template with substitutions keeps its fixed text in TemplateHead/Middle/Tail tokens,
    // so `${x}part-of` is caught like "part-of" (Copilot on #45).
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      literals++;
      if (portNames.has(node.text)) {
        fail(`${at} restates the knowledge port "${node.text}" — read it from ${VOCAB_READER}`);
      }
      const colour = colours.find((c) => node.text.toLowerCase().includes(c));
      if (colour) {
        fail(`${at} restates the vocabulary colour ${colour} — read it from ${VOCAB_READER}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
if (failures === before) {
  pass(
    `${VOCAB_JSON} is the recorded file (${vocabBytes.length} bytes); its ${portNames.size} port ` +
      `names and ${colours.length} colours are in none of the ${literals} string literals of ` +
      `${codeFiles.length} code files`
  );
}

// E — the panel opens un-narrowed (t342, Sam: "I need the view not narrowed at opening").
// The opening spec is the `everything` sentinel: all types, all ports, no t bound, 1 hop.
console.log("\nE. the opening slice is the whole permitted fold");
const opening = m.defaultSliceSpec();
if (
  m.DEFAULT_LENS_ID !== "everything" ||
  opening.lens !== "everything" ||
  opening.types.length !== 1 ||
  opening.types[0] !== "*" ||
  opening.ports.length !== 0 ||
  opening.t !== "" ||
  opening.hops !== 1
) {
  fail(`the panel opens narrowed: ${JSON.stringify(opening)} — expected the everything sentinel`);
} else {
  pass(`opens on lens '${opening.lens}' (types ["*"], ports all, t latest, 1 hop)`);
}

// F — the strip's counts (t342): "444/447 · access −3" must not mix the access posture with
// the lens. A synthetic fold (synthetic urns only; the repo is public): a public seat, the
// user's own seat, someone else's seat, two unattributed items, and two relations.
console.log("\nF. the frame counts access withholding apart from lens narrowing");
const SEAT = "urn:moos:session:lens-smoke.";
const ITEM = "urn:moos:knowledge_item:lens-smoke.";
const USER = "urn:moos:user:lens-smoke";
const countFold = {
  nodes: Object.fromEntries(
    [
      [`${SEAT}public`, "session", { anon_visible: true }],
      [`${SEAT}mine`, "session", { owner_urn: USER }],
      [`${SEAT}theirs`, "session", { owner_urn: `${USER}-other` }],
      [`${ITEM}a`, "knowledge_item", {}],
      [`${ITEM}b`, "knowledge_item", {}],
    ].map(([urn, type_id, props]) => [
      urn,
      {
        urn,
        type_id,
        properties: Object.fromEntries(Object.entries(props).map(([k, value]) => [k, { value }])),
      },
    ]),
  ),
  relations: Object.fromEntries(
    [
      ["mine-theirs", `${SEAT}mine`, `${SEAT}theirs`],
      ["a-b", `${ITEM}a`, `${ITEM}b`],
    ].map(([id, src_urn, tgt_urn]) => [
      id,
      { urn: `urn:moos:relation:lens-smoke.${id}`, src_urn, src_port: "depends-on", tgt_urn },
    ]),
  ),
};
const scopeOf = (mode) => ({
  mode,
  user: mode === "anon" ? "urn:moos:user:anon" : USER,
  workstation: null,
  role: null,
  identity_source: mode === "anon" ? "anon" : "trusted-storage",
  enforced_by: "client-presentation",
});
const frameOf = (view_filter) =>
  selectFrame(countFold, { healthz: { t_day: 342 }, request: { view_filter } });
const countCases = [
  // the whole fold as the user: only someone else's seat (and its one relation) withheld
  ["identified, everything", { types: ["*"], access: scopeOf("identified") }, [5, 4, 1, 2, 1, 1]],
  // a narrower lens holds less — the access number does not move
  ["identified, sessions only", { types: ["session"], access: scopeOf("identified") }, [5, 2, 1, 2, 0, 1]],
  // anon: the public seat only
  ["anon, everything", { types: ["*"], access: scopeOf("anon") }, [5, 1, 4, 2, 0, 2]],
  // no access scope: nothing is withheld
  ["no access scope", { types: ["*"] }, [5, 5, 0, 2, 2, 0]],
];
for (const [name, vf, want] of countCases) {
  const c = frameOf(vf).provenance.fold_counts;
  const got = c
    ? [c.total, c.in_frame, c.withheld_by_access, c.relations.total, c.relations.in_frame, c.relations.withheld_by_access]
    : null;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${name}: fold_counts [total, in_frame, withheld; relations …] ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  } else {
    pass(`${name}: ${c.in_frame}/${c.total} in frame · access −${c.withheld_by_access} · relations ${c.relations.in_frame}/${c.relations.total}`);
  }
}
// t342 P6 (review): the permitted fold's vocabulary (`fold_vocab`, which the drawer offers
// as the "undeclared pair" / "in this fold" groups) obeys access like the counts: not the
// type of a withheld node, not the label of a relation touching one — and no lens shrinks
// it. Synthetic: two public seats, the user's seat, someone else's seat, an unattributed
// item (kept for an identified user, withheld for anon) and four relations, one label each.
{
  const V = "lens-smoke-vocab-";
  const vocabFold = {
    nodes: Object.fromEntries(
      [
        [`${SEAT}vocab-public`, "session", { anon_visible: true }],
        [`${SEAT}vocab-public-2`, "session", { anon_visible: true }],
        [`${SEAT}vocab-mine`, "session", { owner_urn: USER }],
        [`${SEAT}vocab-theirs`, "session", { owner_urn: `${USER}-other` }],
        [`${ITEM}vocab`, "knowledge_item", {}],
      ].map(([urn, type_id, props]) => [
        urn,
        {
          urn,
          type_id,
          properties: Object.fromEntries(Object.entries(props).map(([k, value]) => [k, { value }])),
        },
      ]),
    ),
    relations: Object.fromEntries(
      [
        ["public", `${SEAT}vocab-public`, `${SEAT}vocab-public-2`],
        ["mine", `${SEAT}vocab-public`, `${SEAT}vocab-mine`],
        ["withheld", `${SEAT}vocab-mine`, `${SEAT}vocab-theirs`],
        ["item", `${ITEM}vocab`, `${SEAT}vocab-public`],
      ].map(([id, src_urn, tgt_urn]) => [
        id,
        { urn: `urn:moos:relation:lens-smoke.vocab-${id}`, src_urn, src_port: `${V}${id}`, tgt_urn },
      ]),
    ),
  };
  const vocabOf = (view_filter) =>
    selectFrame(vocabFold, { healthz: { t_day: 342 }, request: { view_filter } }).provenance.fold_vocab;
  const vocabCases = [
    ["identified", { types: ["*"], access: scopeOf("identified") }, ["knowledge_item", "session"], ["item", "mine", "public"]],
    ["identified, items only", { types: ["knowledge_item"], access: scopeOf("identified") }, ["knowledge_item", "session"], ["item", "mine", "public"]],
    ["anon", { types: ["*"], access: scopeOf("anon") }, ["session"], ["public"]],
    ["no access scope", { types: ["*"] }, ["knowledge_item", "session"], ["item", "mine", "public", "withheld"]],
  ];
  for (const [name, vf, types, ports] of vocabCases) {
    const got = vocabOf(vf);
    const want = { ports: ports.map((p) => `${V}${p}`), types };
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fail(`${name}: fold_vocab ${JSON.stringify(got)}, expected ${JSON.stringify(want)} — a withheld node's type or relation's label leaked, or a lens shrank it`);
    } else {
      pass(`${name}: fold_vocab lists ${want.types.length} type(s), ${want.ports.length} label(s) — nothing withheld by access`);
    }
  }
}

// G — the unlinked band (t342): the nodes no relation of the CURRENT frame touches.
console.log("\nG. the unlinked band holds exactly the nodes no relation of the frame touches");
const { unlinkedUrns } = await loadFrameGraph();
const bandOf = (frame) => [...unlinkedUrns(frame)].sort().join(", ");
const whole = frameOf(countCases[0][1]);
const bandCases = [
  // the public seat has no relation; my seat's only relation runs to a withheld seat, so it is
  // linked in the fold and unlinked in this frame; a and b link each other
  ["identified, everything", whole, [`${SEAT}mine`, `${SEAT}public`]],
  // a frame without b (as a narrower slice would leave it): a lost its only relation here
  [
    "identified, everything but b",
    { ...whole, nodes: whole.nodes.filter((n) => n.urn !== `${ITEM}b`) },
    [`${ITEM}a`, `${SEAT}mine`, `${SEAT}public`],
  ],
  ["anon", frameOf(countCases[2][1]), [`${SEAT}public`]],
];
for (const [name, frame, want] of bandCases) {
  const got = bandOf(frame);
  if (got !== [...want].sort().join(", ")) {
    fail(`${name}: unlinked [${got}], expected [${[...want].sort().join(", ")}]`);
  } else {
    pass(`${name}: ${want.length} unlinked of ${frame.nodes.length}`);
  }
}


// H — relation ends coloured by the engine's port colours (t342 P1). Synthetic grammar and
// synthetic relations only (the repo is public: no operad data, no colour map, no mtdc-only
// name), run through the REAL normaliser (engine-grammar.js) and painter (port-colour.js) —
// the code the worker's adapter and FrameGraph run. Each of the three non-colour states gets
// its own glyph and no hue; two families give a two-tone relation.
console.log("\nH. relation ends coloured by κ(port): one hue, two tones, three glyphs (synthetic)");
{
  const before = failures;
  const P = (n) => `lens-smoke-${n}`;
  const raw = {
    nodeTypes: { [`${P("type")}-a`]: {} },
    rewriteCategories: {
      WF90: {
        ID: "WF90",
        SrcPort: P("a-out"),
        TgtPort: P("a-in"),
        AdditionalPortPairs: [
          { SrcPort: P("b-out"), TgtPort: P("c-in") }, // two families
          { SrcPort: P("x-out"), TgtPort: P("c-in") }, // exempt source end
          { SrcPort: P("b-out"), TgtPort: P("x-out") }, // exempt target end
          { SrcPort: P("a-out"), TgtPort: P("gone-in") }, // uncoloured target end
          { SrcPort: P("gone-out"), TgtPort: P("a-in") }, // uncoloured source end
        ],
      },
      WF91: { ID: "WF91", SrcPort: "{lens-smoke}", TgtPort: "{lens-smoke}", AdditionalPortPairs: null },
    },
    portColors: {
      port_colors: {
        [P("a-out")]: "fam-one",
        [P("a-in")]: "fam-one",
        [P("b-out")]: "fam-one",
        [P("c-in")]: "fam-two",
        [P("x-out")]: "",
        [P("unused")]: "fam-three",
      },
    },
  };
  const grammar = normalizeEngineGrammar(raw, { source: "lens-smoke", ontology_version: "lens-smoke-1" });
  const rel = (n, src, tgt) => ({
    urn: `urn:moos:relation:lens-smoke.${n}`,
    type_id: "WF90",
    label: src,
    source_urn: `urn:moos:session:lens-smoke.${n}-s`,
    target_urn: `urn:moos:session:lens-smoke.${n}-t`,
    properties: { src_port: src, tgt_port: tgt },
  });
  const cases = {
    one: rel("one", P("a-out"), P("a-in")),
    two: rel("two", P("b-out"), P("c-in")),
    exSrc: rel("ex-src", P("x-out"), P("c-in")),
    exTgt: rel("ex-tgt", P("b-out"), P("x-out")),
    unTgt: rel("un-tgt", P("a-out"), P("gone-in")),
    unSrc: rel("un-src", P("gone-out"), P("a-in")),
    undeclared: rel("undeclared", P("a-out"), P("c-in")),
  };
  const paint = Object.fromEntries(Object.entries(cases).map(([k, r]) => [k, paintRelation(r, grammar)]));
  const hues = new Set(KAPPA_HUES.map((h) => h.toLowerCase()));
  const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

  check(
    grammar.status === "engine" &&
      grammar.pairs.length === 7 &&
      !grammar.ports.some(isPlaceholderPort) &&
      !grammar.src_ports.some(isPlaceholderPort),
    `the normaliser reads ${grammar.pairs?.length} pairs (main + additional) and offers no {placeholder} as a port`,
  );
  const fam = new Map(kappaFamilies(grammar).map((f) => [f.family, f.hue]));
  check(
    [...fam.keys()].join() === "fam-one,fam-three,fam-two" && [...fam.values()].every((h) => hues.has(h)),
    `the engine's ${fam.size} families (the empty exemption is not one) each get one of the eight hues`,
  );
  const p1 = paint.one;
  check(
    p1.palette === "port" && !p1.twoTone && p1.src.hue === fam.get("fam-one") && p1.tgt.hue === p1.src.hue &&
      p1.src.glyph === END_GLYPHS.source.colour && p1.tgt.glyph === END_GLYPHS.target.colour && p1.pair === "declared",
    "both ends in one family: ONE hue, the plain direction arrow, a declared pair",
  );
  const p2 = paint.two;
  const d2 = kappaRelationData(p2);
  check(
    p2.twoTone && d2.ks === fam.get("fam-one") && d2.kt === fam.get("fam-two") && d2.ks !== d2.kt,
    "two families: TWO tones — the source half in κ(src_port), the target half in κ(tgt_port)",
  );
  const states = [
    ["exempt source end", paint.exSrc.src, "exempt", END_GLYPHS.source.exempt],
    ["exempt target end", paint.exTgt.tgt, "exempt", END_GLYPHS.target.exempt],
    ["uncoloured source end", paint.unSrc.src, "uncoloured", END_GLYPHS.source.uncoloured],
    ["uncoloured target end", paint.unTgt.tgt, "uncoloured", END_GLYPHS.target.uncoloured],
  ];
  for (const [name, end, state, glyph] of states) {
    check(
      end.state === state && end.glyph === glyph && end.hue === KAPPA_NEUTRAL && !hues.has(end.hue.toLowerCase()),
      `${name}: state ${state}, glyph '${glyph}', neutral grey — never a hue`,
    );
  }
  const du = kappaRelationData(paint.undeclared);
  check(
    paint.undeclared.pair === "undeclared" && du.kpair === "undeclared" &&
      paint.undeclared.src.state === "colour" && paint.undeclared.tgt.state === "colour",
    `undeclared pair: both ends keep their κ; the pair is marked (${UNDECLARED_MARKER.lineStyle} line, '${UNDECLARED_MARKER.midGlyph}' midway)`,
  );
  const glyphSets = [
    Object.values(END_GLYPHS.source),
    Object.values(END_GLYPHS.target),
  ];
  check(
    glyphSets.every((g) => new Set(g).size === g.length) &&
      !glyphSets.flat().includes(UNDECLARED_MARKER.midGlyph) &&
      UNDECLARED_MARKER.lineStyle !== "solid",
    "the three states have three distinct glyphs at each end, and the undeclared marker is none of them",
  );
  // Hue follows the family, never the order the engine lists its ports in.
  const reversed = normalizeEngineGrammar(
    { ...raw, portColors: { port_colors: Object.fromEntries(Object.entries(raw.portColors.port_colors).reverse()) } },
    { source: "lens-smoke", ontology_version: "lens-smoke-1" },
  );
  check(
    kappaRelationData(paintRelation(cases.two, reversed)).ks === d2.ks &&
      kappaRelationData(paintRelation(cases.two, reversed)).kt === d2.kt,
    "a family keeps its hue whatever order /operad/port-colors lists the ports in",
  );
  // t342 P1: K1's additive keys (`color_rule`, `color_source`) are read when the engine states
  // them and "not stated" (null) when it does not — today's `{matrix, port_colors}`. `matrix`
  // is never read: a body that carries only a matrix gives no port colours (absent), and the
  // matrix beside port_colors changes no hue.
  const meta = { source: "lens-smoke", ontology_version: "lens-smoke-1" };
  const synthMatrix = { "fam-one": ["fam-one"], "fam-two": ["fam-one", "fam-two"] };
  const k1 = normalizeEngineGrammar(
    {
      ...raw,
      portColors: {
        ...raw.portColors,
        matrix: synthMatrix,
        color_rule: "lens-smoke-rule",
        color_source: "lens-smoke-source",
      },
    },
    meta,
  );
  const matrixOnly = normalizeEngineGrammar({ ...raw, portColors: { matrix: synthMatrix } }, meta);
  check(
    grammar.color_rule === null && grammar.color_source === null &&
      k1.status === "engine" && k1.color_rule === "lens-smoke-rule" && k1.color_source === "lens-smoke-source" &&
      kappaRelationData(paintRelation(cases.two, k1)).ks === d2.ks &&
      kappaRelationData(paintRelation(cases.two, k1)).kt === d2.kt &&
      matrixOnly.status === "engine" && matrixOnly.port_colors === null &&
      /port_colors/.test(matrixOnly.port_colors_reason) && matrixOnly.pairs.length === grammar.pairs.length &&
      kappaRelationData(paintRelation(cases.two, matrixOnly)) === null,
    "color_rule / color_source read when stated (null when not); the matrix is never read — alone it colours nothing (the pairs and types stand)",
  );
  // t342 P1: a relation's own src_color / tgt_color is never read and may be absent. The same
  // synthetic fold through the REAL selectFrame, once with both keys empty (what every kernel
  // relation carries today: read, they would make each end "exempt") and once without them
  // (K1 drops them), paints identically, with no exempt end.
  const SFX = "urn:moos:session:lens-smoke.kappa-";
  const kFold = (extra) => ({
    nodes: Object.fromEntries(
      ["s", "t"].map((n) => [`${SFX}${n}`, { urn: `${SFX}${n}`, type_id: "session", properties: {} }]),
    ),
    relations: {
      k: {
        urn: "urn:moos:relation:lens-smoke.kappa",
        rewrite_category: "WF90",
        src_urn: `${SFX}s`,
        src_port: P("a-out"),
        tgt_urn: `${SFX}t`,
        tgt_port: P("a-in"),
        ...extra,
      },
    },
  });
  const paintedThrough = (fold) => {
    const f = selectFrame(fold, { healthz: { t_day: 342 }, request: { view_filter: { types: ["*"] } }, grammar });
    return { census: kappaCensus(f.relations, f.provenance.grammar), stamped: f.provenance.grammar === grammar };
  };
  const withKeys = paintedThrough(kFold({ src_color: "", tgt_color: "" }));
  const withoutKeys = paintedThrough(kFold({}));
  check(
    withKeys.stamped && withKeys.census.relations === 1 && withKeys.census.exempt === 0 &&
      withKeys.census.families["fam-one"] === 2 &&
      JSON.stringify(withKeys.census) === JSON.stringify(withoutKeys.census),
    "through selectFrame: an empty src_color / tgt_color on a relation is not read (0 exempt ends), and its absence changes nothing",
  );
  const census = kappaCensus(Object.values(cases), grammar);
  check(
    census.kind === 0 && census.exempt === 2 && census.uncoloured === 2 && census.undeclared === 1 &&
      census.twoTone === 6,
    `census: ${census.relations} relations, 0 relation-kind, exempt ${census.exempt} · uncoloured ${census.uncoloured} ends, ${census.undeclared} undeclared pair, ${census.twoTone} two-tone`,
  );
  // An engine without /operad/* — or a frame without a grammar — is drawn by relation kind.
  const absent = { status: "absent", source: "lens-smoke", ontology_version: "x", reason: "404" };
  check(
    [absent, undefined].every((g) => {
      const c = kappaCensus(Object.values(cases), g);
      return c.kind === c.relations && kappaRelationData(paintRelation(cases.one, g)) === null;
    }),
    "no engine grammar: every relation falls back to the relation-kind palette",
  );
  // t342 P1 (review): what FrameGraph DRAWS (drawCheck: the real toElements, STYLE and
  // applyPalette, headless) — the seven cases above plus a knowledge-vocabulary relation on
  // ports the synthetic grammar does not colour. In port colour all are drawn in κ; switched
  // to relation kind, none is, and the knowledge relation is back in its vocabulary colour.
  const fg = await loadFrameGraph();
  const kbRel = KB_RELATIONS[0];
  const drawRels = [...Object.values(cases), rel("kb", kbRel.src_port, kbRel.tgt_port)];
  const drawUrns = [...new Set(drawRels.flatMap((r) => [r.source_urn, r.target_urn]))];
  const drawn = drawCheck(fg, {
    provenance: { grammar },
    nodes: drawUrns.map((urn) => ({ urn, label: urn, type_id: "session", properties: {} })),
    relations: drawRels,
  });
  check(
    drawn.port.edges === drawRels.length && drawn.port.kind === 0 && drawn.port.wrong.length === 0 &&
      drawn.kind.edges === drawRels.length && drawn.kind.port === 0 && drawn.kind.wrong.length === 0,
    `drawn (headless Cytoscape, the real STYLE): ${drawn.port.edges - drawn.port.kind} of ${drawn.port.edges} relations in port colour, ` +
      `${drawn.port.kind} in relation kind${drawn.port.wrong.length ? `, WRONG: ${drawn.port.wrong.join(", ")}` : ""}; ` +
      `switched: ${drawn.kind.port} still in port colour${drawn.kind.wrong.length ? `, WRONG: ${drawn.kind.wrong.join(", ")}` : ""}`,
  );
  // Node fills stay a type palette that never uses a κ hue (nor the neutral of the states).
  const { NODE_FILLS } = fg;
  const fills = [...NODE_FILLS, ...KB_CLAIM_KINDS.map((k) => k.display)].map((c) => c.toLowerCase());
  const shared = fills.filter((c) => hues.has(c) || c === KAPPA_NEUTRAL.toLowerCase());
  check(
    shared.length === 0 && KAPPA_HUES.length === 8 && !hues.has(KAPPA_NEUTRAL.toLowerCase()),
    `the ${fills.length} node fills (types + claim kinds) share no colour with the 8 κ hues (${JSON.stringify(shared)})`,
  );
  // t342 P1 (review): and not perceptually either. OKLab ΔE ×100 (the dataviz reference
  // metric): no κ hue — nor the grey of the states — within ΔE 3 of a node fill. Closer than
  // 10 (κ / fill) or 15 (κ / κ over ALL slot pairs: a graph can put any two families side by
  // side) is a recorded limit (TESTING.md, "Port colours…", Limits); a NEW close pair fails
  // here until it is recorded there, or the colours move apart.
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const oklab = (hex) => {
    const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(hex.replace("#", "").slice(i, i + 2), 16) / 255));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s,
    ];
  };
  const dE = (a, b) => {
    const [x, y] = [oklab(a), oklab(b)];
    return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  };
  const closest = Math.min(...[...KAPPA_HUES, KAPPA_NEUTRAL].flatMap((h) => fills.map((f) => dE(h, f))));
  const closeFill = KAPPA_HUES.flatMap((h) => fills.filter((f) => dE(h, f) < 10));
  const closeKappa = KAPPA_HUES.flatMap((h, i) => KAPPA_HUES.slice(i + 1).filter((k) => dE(h, k) < 15));
  const RECORDED = { fill: 13, kappa: 7 }; // TESTING.md — every pair listed there
  check(
    closest >= 3 && closeFill.length <= RECORDED.fill && closeKappa.length <= RECORDED.kappa,
    `no κ hue nor the state grey within OKLab ΔE 3 of a node fill (closest ${closest.toFixed(1)}); close pairs as ` +
      `recorded: κ/fill under 10 ${closeFill.length} (≤ ${RECORDED.fill}), κ/κ under 15 over all slot pairs ${closeKappa.length} (≤ ${RECORDED.kappa})`,
  );
  // Never read a relation's src_color / tgt_color: no identifier, property or string literal
  // of that name in any code file under src/ (comments may say why).
  const banned = new Set(["src_color", "tgt_color"]);
  const reads = [];
  for (const file of codeFiles.filter((f) => relative(process.cwd(), f).replaceAll("\\", "/").startsWith("src/"))) {
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, false, kindOf(file));
    const visit = (node) => {
      if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && banned.has(node.text)) {
        reads.push(`${relative(process.cwd(), file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  check(reads.length === 0, `no code under src/ reads src_color / tgt_color (${reads.join(", ") || "0 reads"})`);
  // t342 P1/P6: the read itself — three GETs, cached per (engine, ontology_version) — on an
  // INJECTED fetch serving the synthetic bodies (offline; `.invalid` hosts are never resolved).
  clearEngineGrammarCache();
  const bodies = {
    "/operad/node-types": raw.nodeTypes,
    "/operad/rewrite-categories": raw.rewriteCategories,
    "/operad/port-colors": raw.portColors,
  };
  const methods = new Set();
  let served = 0;
  const serve = async (url, init) => {
    served += 1;
    methods.add(init?.method);
    return new Response(JSON.stringify(bodies[new URL(url).pathname]), { status: 200 });
  };
  const read = (host, ontology_version, fetchImpl, extra = {}) =>
    readEngineGrammar({ engineUrl: `http://${host}.invalid`, healthz: { ontology_version }, fetchImpl, ...extra });
  const g1 = await read("lens-smoke", "v1", serve);
  const g2 = await read("lens-smoke", "v1", serve);
  const g3 = await read("lens-smoke", "v2", serve);
  check(
    g1.status === "engine" && g1 === g2 && g3 !== g1 && g3.ontology_version === "v2" && served === 6 &&
      [...methods].join() === "GET",
    `three GETs per (engine, ontology_version), then the cache: ${served} requests for 3 reads over 2 versions, methods ${[...methods].join()}`,
  );
  let missingCalls = 0;
  const missing = async () => {
    missingCalls += 1;
    return new Response("", { status: 404 });
  };
  const a1 = await read("lens-smoke-old", "v0", missing);
  const a2 = await read("lens-smoke-old", "v0", missing);
  check(
    a1.status === "absent" && /HTTP 404/.test(a1.reason) && a2 === a1 && missingCalls === 3,
    `an engine without /operad/* is "absent" (${a1.reason}) and that answer is cached`,
  );
  // t342 P6 (review): an engine that serves its pairs and types but no port colours keeps
  // them — the drawer's engine groups stand — and only κ falls back to relation kind; one
  // without node types is "absent".
  const partial = (missingPath) => async (url) => {
    const path = new URL(url).pathname;
    return path === missingPath
      ? new Response("", { status: 404 })
      : new Response(JSON.stringify(bodies[path]), { status: 200 });
  };
  const noKappa = await read("lens-smoke-nokappa", "v0", partial("/operad/port-colors"));
  const noTypes = await read("lens-smoke-notypes", "v0", partial("/operad/node-types"));
  check(
    noKappa.status === "engine" && noKappa.port_colors === null && /HTTP 404/.test(noKappa.port_colors_reason) &&
      noKappa.pairs.length === grammar.pairs.length && noKappa.types.length === grammar.types.length &&
      kappaRelationData(paintRelation(cases.one, noKappa)) === null && /no port colours/.test(grammarGap(noKappa)) &&
      m.drawerVocab(noKappa, null).source === "engine" &&
      noTypes.status === "absent" && /node-types answered HTTP 404/.test(noTypes.reason),
    `no /operad/port-colors: the engine's ${noKappa.pairs?.length} pairs and ${noKappa.types?.length} type(s) stand, relation kind only; no /operad/node-types: absent`,
  );
  // t342 P1/P6 (review): a route that does not answer is cut at the timeout — "absent", marked
  // unreachable (not "serves no /operad/*") — and that answer is kept for the back-off only:
  // a frame inside it does not wait again, a frame after it asks again. Every read is raced
  // against a test deadline, so a timeout that no longer cuts FAILS here instead of hanging.
  let hangCalls = 0;
  const hang = (_url, init) => {
    hangCalls += 1;
    return new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted by the grammar timeout"))),
    );
  };
  const DEADLINE = { status: "no answer within 2 s: the grammar timeout did not cut the read" };
  const withDeadline = async (p) => {
    let timer;
    try {
      return await Promise.race([p, new Promise((r) => (timer = setTimeout(() => r(DEADLINE), 2000)))]);
    } finally {
      clearTimeout(timer);
    }
  };
  const slow = () => withDeadline(read("lens-smoke-slow", "v0", hang, { timeoutMs: 40, retryMs: 150 }));
  const h1 = await slow();
  const h2 = await slow();
  const callsInBackoff = hangCalls;
  await new Promise((r) => setTimeout(r, 200));
  const h3 = await slow();
  check(
    h1.status === "absent" && h1.unreachable === true && /unreachable/.test(h1.reason) &&
      /did not answer/.test(grammarGap(h1)) && h2 === h1 && callsInBackoff === 3 &&
      h3 !== h1 && h3.status === "absent" && hangCalls === 6,
    h1 === DEADLINE || h3 === DEADLINE
      ? DEADLINE.status
      : "a route that does not answer is cut at the timeout (\"absent\", unreachable), kept for the back-off, asked again after it",
  );
  clearEngineGrammarCache();
  if (failures === before) pass("H holds");
}

// I — the drawer's vocabulary (t342 P6): the static groups (A-C) first, then what the ENGINE
// declares and what the permitted fold carries, through the REAL drawerVocab. Synthetic names.
console.log("\nI. the drawer offers the static lists + the engine's declared names + the fold's own");
{
  const before = failures;
  const check = (cond, msg) => (cond ? pass(msg) : fail(msg));
  const T = (n) => `lens-smoke-type-${n}`;
  const Pt = (n) => `lens-smoke-port-${n}`;
  const staticPort = ALL_PORTS[0];
  const staticType = ALL_TYPES[0];
  const grammar = normalizeEngineGrammar(
    {
      nodeTypes: { [T("a")]: {}, [T("b")]: {}, [staticType]: {} },
      rewriteCategories: [
        { ID: "WF90", SrcPort: Pt("a"), TgtPort: Pt("a-in") },
        { ID: "WF91", SrcPort: staticPort, TgtPort: Pt("b-in") },
        { ID: "WF92", SrcPort: "{lens-smoke}", TgtPort: "{lens-smoke}" },
      ],
      portColors: { port_colors: {} },
    },
    { source: "lens-smoke", ontology_version: "lens-smoke-1" },
  );
  const fold = { ports: [Pt("live-only"), staticPort, Pt("a")], types: [T("fold"), staticType] };
  const v = m.drawerVocab(grammar, fold);
  const labels = (gs) => gs.map((g) => g.label);
  check(
    JSON.stringify(labels(v.typeGroups.slice(0, m.TYPE_GROUPS.length))) === JSON.stringify(labels(m.TYPE_GROUPS)) &&
      JSON.stringify(labels(v.portGroups.slice(0, m.PORT_GROUPS.length))) === JSON.stringify(labels(m.PORT_GROUPS)),
    "the static groups come first, unchanged (the lens invariant A-C holds on them)",
  );
  check(
    grammar.types.every((t) => v.allTypes.includes(t)) && new Set(v.allTypes).size === v.allTypes.length,
    `every type the engine declares is reachable, once (${v.allTypes.length} offered)`,
  );
  const extraPorts = v.portGroups.slice(m.PORT_GROUPS.length);
  check(
    extraPorts.length === 2 &&
      JSON.stringify(extraPorts[0].ports) === JSON.stringify([Pt("a")]) &&
      JSON.stringify(extraPorts[1].ports) === JSON.stringify([Pt("live-only")]) &&
      JSON.stringify(v.undeclaredPorts) === JSON.stringify([Pt("live-only")]) &&
      !v.allPorts.includes(Pt("a-in")) && !v.allPorts.some(isPlaceholderPort) &&
      new Set(v.allPorts).size === v.allPorts.length,
    `an engine group with the declared source port the static lists lack, then "${extraPorts[1]?.label}" with the live-only label — no target-only name, no placeholder`,
  );
  check(
    v.typeGroups.slice(m.TYPE_GROUPS.length).map((g) => g.types.join()).join(" | ") === `${T("a")},${T("b")} | ${T("fold")}`,
    "an engine type group, then the fold's undeclared type",
  );
  // An untick expands from what the drawer offers — engine types included — and ticking back
  // returns to the ["*"] sentinel.
  const spec = { ...m.defaultSliceSpec() };
  const off = m.specToggleType(spec, staticType, v.allTypes);
  const back = m.specToggleType(off, staticType, v.allTypes);
  check(
    off.types.includes(T("a")) && off.types.includes(T("fold")) && !off.types.includes(staticType) &&
      back.types.length === 1 && back.types[0] === "*",
    "unticking a type keeps every engine and fold type; ticking it back is ['*'] again",
  );
  const pOff = m.specTogglePort(spec, staticPort, v.allPorts);
  const pBack = m.specTogglePort(pOff, staticPort, v.allPorts);
  check(
    pOff.ports.includes(Pt("live-only")) && pOff.ports.includes(Pt("a")) && pBack.ports.length === 0,
    "unticking a port keeps the engine and live-only ports; ticking it back is all ports again",
  );
  const absent = m.drawerVocab({ status: "absent", source: "x", ontology_version: "y", reason: "HTTP 404" }, fold);
  const none = m.drawerVocab(undefined, null);
  check(
    absent.source === "static" && /no \/operad\//.test(absent.note) &&
      // the note names what the fold adds when it adds something (Copilot on #46), else "static lists only"
      /static lists \+ \d+ types? and \d+ ports? from the permitted fold/.test(absent.note) && /static lists only$/.test(none.note) &&
      absent.portGroups.length === m.PORT_GROUPS.length + 1 && absent.undeclaredPorts.length === 0 &&
      none.source === "static" && /no engine grammar/.test(none.note) &&
      none.portGroups.length === m.PORT_GROUPS.length && none.typeGroups.length === m.TYPE_GROUPS.length,
    "without an engine grammar: the static lists (+ the fold's own names), and the note says so",
  );
  // t342 P6 (review): a fold label that IS a declared `{placeholder}` source port (a kernel
  // can write one) is an engine port — the graph draws its pair as declared — never one of
  // the "undeclared pair" group.
  const ph = m.drawerVocab(grammar, { ports: ["{lens-smoke}", Pt("live-only")], types: [] });
  const phEngine = ph.portGroups.slice(m.PORT_GROUPS.length)[0];
  check(
    !ph.undeclaredPorts.includes("{lens-smoke}") && ph.undeclaredPorts.includes(Pt("live-only")) &&
      phEngine?.ports.includes("{lens-smoke}") && ph.allPorts.filter((p) => p === "{lens-smoke}").length === 1 &&
      paintRelation(
        { label: "{lens-smoke}", properties: { src_port: "{lens-smoke}", tgt_port: "{lens-smoke}" } },
        { ...grammar, port_colors: { "{lens-smoke}": "fam" } },
      ).pair === "declared",
    "a fold label on a declared {placeholder} pair is offered in the engine group, as the graph draws it — not as an undeclared pair",
  );
  const legacyGroup = m.PORT_GROUPS.find((g) => g.label === "legacy");
  check(
    !!legacyGroup &&
      JSON.stringify(legacyGroup.ports) === JSON.stringify([...m.LEGACY_PORTS]) &&
      m.LEGACY_PORTS.every((p) => m.PORT_GROUPS.filter((g) => g.ports.includes(p)).length === 1),
    `the legacy list (${m.LEGACY_PORTS.join(", ")}) is one group of its own and in no other`,
  );
  if (failures === before) pass("I holds");
}

console.log(
  failures === 0
    ? "\nLENS SMOKE: PASS"
    : `\nLENS SMOKE: FAILED — ${failures} violation(s)`
);
process.exit(failures === 0 ? 0 : 1);
