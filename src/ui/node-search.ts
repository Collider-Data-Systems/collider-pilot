/**
 * Collider Pilot - node search ranking (t264)
 * ===========================================
 * The search box used to select `matches[0]` — whichever candidate happened to come first
 * in fold order. Searching `mvp-delivery`, the name of an APPLIED PROGRAM, therefore landed
 * on a `governance_proposal` whose title merely mentions it, and the program (with its whole
 * `composes` tree) was never selected. "Inspect the applied programs" is a first-class use
 * of this panel, so the obvious query has to reach the obvious node.
 *
 * Ranking, best first:
 *   0. urn tail EQUALS the query      `…:program:sam.mvp-delivery`  for "sam.mvp-delivery" *
 *   1. urn tail STARTS WITH the query `…:program:sam.t159-ignition` for "sam.t159" *
 *   2. urn contains the query
 *   3. label starts with the query
 *   4. label contains the query
 *
 * (*) ranks 0 and 1 are each tried twice: once against the raw tail, once after stripping a
 * leading owner segment (`sam.`), because the fold's urn tails are conventionally
 * `<owner>.<slug>` and users type the slug. So "mvp-delivery" is an owner-stripped EQUALS
 * and ranks 0 — not a prefix match. That distinction is the whole point: a rank-0 exact hit
 * cannot be outranked by some longer urn that merely starts with the same slug.
 *
 * Ties keep fold order, so the ranking only ever promotes a better match — it never
 * reorders equals. Pure functions, no DOM, no I/O; the panel and both harnesses share them.
 */

import type { HgNode } from "../mcp/types";

/** The urn's last segment — `sam.mvp-delivery` for `urn:moos:program:sam.mvp-delivery`. */
export function urnTail(urn: string): string {
  return urn.split(":").pop() ?? urn;
}

/** `sam.mvp-delivery` -> `mvp-delivery`; leaves an owner-less tail untouched. */
function stripOwner(tail: string): string {
  const dot = tail.indexOf(".");
  return dot > 0 ? tail.slice(dot + 1) : tail;
}

/** Lower rank = better match. Infinity = not a match at all. */
export function matchRank(node: HgNode, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return Infinity;
  const urn = node.urn.toLowerCase();
  const tail = urnTail(urn);
  const label = (node.label ?? "").toLowerCase();

  if (tail === q || stripOwner(tail) === q) return 0;
  if (tail.startsWith(q) || stripOwner(tail).startsWith(q)) return 1;
  if (urn.includes(q)) return 2;
  if (label.startsWith(q)) return 3;
  if (label.includes(q)) return 4;
  return Infinity;
}

export interface SearchOutcome {
  /** Best match, or null when nothing matched. */
  hit: HgNode | null;
  /** Total matching nodes. */
  count: number;
  /** Hint for the controls strip — states WHAT was selected, not just how many matched. */
  hint: string | null;
}

/**
 * Rank the frame's nodes against a query and pick the best. The hint names the selected
 * node's type, because "3 matches — first shown" never told the user they had landed on a
 * proposal instead of the program they searched for.
 */
export function searchNodes(nodes: HgNode[], query: string): SearchOutcome {
  const q = query.trim();
  if (!q) return { hit: null, count: 0, hint: null };

  const ranked = nodes
    .map((node, index) => ({ node, rank: matchRank(node, q), index }))
    .filter((r) => r.rank !== Infinity)
    .sort((a, b) => a.rank - b.rank || a.index - b.index); // ties keep fold order

  if (ranked.length === 0) return { hit: null, count: 0, hint: "no match" };

  const hit = ranked[0].node;
  const hint =
    ranked.length === 1
      ? `1 match · ${hit.type_id}`
      : `${ranked.length} matches · showing ${hit.type_id}`;
  return { hit, count: ranked.length, hint };
}
