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

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

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
  const dir = mkdtempSync(join(resolve(process.cwd(), "src/components"), ".lens-smoke-"));
  const out = join(dir, "GraphControls.mjs");
  writeFileSync(out, js.replaceAll('from "./', 'from "../').replaceAll("from './", "from '../"));
  try {
    return await import(pathToFileURL(out).href);
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

console.log(
  failures === 0
    ? "\nLENS SMOKE: PASS"
    : `\nLENS SMOKE: FAILED — ${failures} violation(s)`
);
process.exit(failures === 0 ? 0 : 1);
