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
 *   G. (t342) The unlinked band takes exactly the nodes no relation of the CURRENT frame
 *      touches (`unlinkedUrns`, the real FrameGraph.tsx rule — nothing is drawn).
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
import { KB_CLAIM_KINDS, KB_RELATIONS } from "../src/ui/kb-vocab.js";
import { selectFrame } from "../src/mcp/transform.js";

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
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
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

console.log(
  failures === 0
    ? "\nLENS SMOKE: PASS"
    : `\nLENS SMOKE: FAILED — ${failures} violation(s)`
);
process.exit(failures === 0 ? 0 : 1);
