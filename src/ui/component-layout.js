/**
 * Collider Pilot - each connected component laid out on its own (t342 P2, SHARED)
 * ============================================================================
 * t342 work order P2. Until t342 the `nested` layout put every linked node outside a box on
 * ONE grid sorted by urn — 179 of them on the scratch fold under `urn:moos:user:sam`, lens
 * `everything` — so a node sat beside whatever urn sorted next to it, not beside what it is
 * related to. Now the linked nodes outside a box are split into their connected components and
 * each component is laid out on its own; FrameGraph packs the components beside the boxes:
 *
 *   - breadth-first, per component (breadthFirstPlacement): the root is the node with the most
 *     neighbours (ties: the smaller urn); each further layer holds the nodes one relation
 *     further out, in the order their parent was placed and then by urn; a layer wider than the
 *     component's row (rowCells) wraps onto the next row;
 *   - a component of more than COSE_MIN_NODES nodes is then refined by Cytoscape's `cose`
 *     seeded from that placement, with a bounded number of iterations (coseBudgets: the whole
 *     frame's refinements share COSE_PAIR_STEPS node pairs × iterations, largest component
 *     first; a component left fewer than COSE_MIN_ITER of them stays breadth-first) — never a
 *     cose over the whole frame, which took about 7 s on the scratch fold — and the label boxes
 *     it leaves overlapping are pushed apart (separateLabels). A breadth-first placement
 *     overlaps none: its cells are label-wide.
 *
 * Which relations join a component: every relation of the frame between two of the nodes being
 * laid out — ticked in the legend or not, so unticking a port never rearranges the drawing.
 *
 * Pure: no DOM, no Cytoscape. FrameGraph lays out with it; `smoke:lens` J asserts on it.
 *
 * @typedef {{ source_urn: string, target_urn: string }} Link
 * @typedef {{ w: number, h: number, dx: number, dy: number }} LabelBox
 *   a node's drawn box with its label, and where the node's position sits inside that box
 * @typedef {{ x: number, y: number }} Position
 */

/** A component this large or smaller is placed breadth-first only. */
export const COSE_MIN_NODES = 30;
/** At most this many cose iterations for any one component. */
export const COSE_MAX_ITER = 100;
/**
 * And at least this many: a component whose bound allows fewer (above 316 nodes) stays
 * breadth-first — a refinement cut that short is not worth its cost.
 */
export const COSE_MIN_ITER = 30;
/**
 * The work bound of ONE FRAME's refinements together: node pairs × iterations. cose compares
 * every pair of a component's nodes on every iteration, so the iterations shrink as the
 * component grows — a 158-node component (the scratch fold) gets 100, a 287-node one
 * (hp-laptop's kernel) 36. t342 P2 review: the bound is the frame's, not each component's —
 * per component, ten components of 170 nodes took 4.9 s of CPU, over the first-paint budget —
 * so the components draw from it largest first (coseBudgets) and the frame never does more
 * than this. Measured in the browser on the scratch fold's 158-node component: 80 iterations
 * end as close as 250 (mean relation 220 px against 214, label boxes overlapping 57 pairs
 * against 48), at a third of the time.
 */
export const COSE_PAIR_STEPS = 1_500_000;

/**
 * t342 P2: the cose iterations a component of `n` nodes gets (0 = breadth-first only) out of the
 * `left` pair-steps of its frame's budget, and the cooling factor that brings cose from its
 * initial temperature to its floor within them — so a bounded run is a finished anneal, not one
 * cut off while still hot.
 * @param {number} n
 * @param {number} initialTemp
 * @param {number} minTemp
 * @param {number} [left] - what the frame's budget still holds (coseBudgets); all of it by default
 * @returns {{ numIter: number, coolingFactor: number }}
 */
export function coseBudget(n, initialTemp, minTemp, left = COSE_PAIR_STEPS) {
  const pairs = (n * (n - 1)) / 2;
  const numIter =
    n <= COSE_MIN_NODES ? 0 : Math.min(COSE_MAX_ITER, Math.floor(Math.max(0, left) / pairs));
  if (numIter < COSE_MIN_ITER) return { numIter: 0, coolingFactor: 1 };
  return { numIter, coolingFactor: (minTemp / initialTemp) ** (1 / numIter) };
}

/**
 * t342 P2 review: the cose budget of each component of ONE frame — `sizes` in the order the
 * components are laid out, largest first (linkedComponents) — drawn from the frame's single
 * COSE_PAIR_STEPS: each component takes what coseBudget gives it out of what is left, and one
 * left fewer than COSE_MIN_ITER iterations stays breadth-first without spending any (a smaller
 * component after it may still fit). However many large components a frame has, its
 * refinements together stay within COSE_PAIR_STEPS.
 * @param {readonly number[]} sizes
 * @param {number} initialTemp
 * @param {number} minTemp
 * @returns {{ numIter: number, coolingFactor: number }[]}
 */
export function coseBudgets(sizes, initialTemp, minTemp) {
  let left = COSE_PAIR_STEPS;
  return sizes.map((n) => {
    const budget = coseBudget(n, initialTemp, minTemp, left);
    left -= (budget.numIter * n * (n - 1)) / 2;
    return budget;
  });
}

/** @param {string} a @param {string} b */
const byUrn = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The undirected neighbours of each urn, over the links whose two ends are both in `urns`
 * (a self-relation joins nothing). Neighbour lists are sorted by urn.
 * @param {Iterable<string>} urns
 * @param {readonly Link[]} links
 * @returns {Map<string, string[]>}
 */
function neighbours(urns, links) {
  /** @type {Map<string, Set<string>>} */
  const adj = new Map();
  for (const u of urns) adj.set(u, new Set());
  for (const l of links) {
    const a = adj.get(l.source_urn);
    const b = adj.get(l.target_urn);
    if (!a || !b || l.source_urn === l.target_urn) continue;
    a.add(l.target_urn);
    b.add(l.source_urn);
  }
  return new Map([...adj].map(([u, s]) => [u, [...s].sort(byUrn)]));
}

/**
 * t342 P2: the connected components of `urns` over `links`: each component's urns sorted, the
 * components largest first and then by their first urn — the same answer whatever order the
 * engine returned nodes and relations in. A node no link reaches is a component of one.
 * @param {Iterable<string>} urns
 * @param {readonly Link[]} links
 * @returns {string[][]}
 */
export function linkedComponents(urns, links) {
  const adj = neighbours(urns, links);
  const seen = new Set();
  /** @type {string[][]} */
  const out = [];
  for (const start of [...adj.keys()].sort(byUrn)) {
    if (seen.has(start)) continue;
    const comp = [];
    const queue = [start];
    seen.add(start);
    for (let i = 0; i < queue.length; i++) {
      comp.push(queue[i]);
      for (const m of adj.get(queue[i]) ?? []) {
        if (!seen.has(m)) {
          seen.add(m);
          queue.push(m);
        }
      }
    }
    out.push(comp.sort(byUrn));
  }
  return out.sort((a, b) => b.length - a.length || byUrn(a[0], b[0]));
}

/**
 * t342 P2: the breadth-first layers of one component: layer 0 is the node with the most neighbours
 * (ties: the smaller urn), each next layer the nodes first reached from the one before, in the
 * order their parent was reached and then by urn.
 * @param {readonly string[]} urns - one connected component
 * @param {readonly Link[]} links
 * @returns {string[][]}
 */
export function breadthFirstLayers(urns, links) {
  const adj = neighbours(urns, links);
  if (adj.size === 0) return [];
  const root = [...adj.keys()].sort(
    (a, b) => (adj.get(b)?.length ?? 0) - (adj.get(a)?.length ?? 0) || byUrn(a, b),
  )[0];
  const depth = new Map([[root, 0]]);
  const layers = [[root]];
  for (let d = 0; d < layers.length; d++) {
    const next = [];
    for (const u of layers[d]) {
      for (const m of adj.get(u) ?? []) {
        if (depth.has(m)) continue;
        depth.set(m, d + 1);
        next.push(m);
      }
    }
    if (next.length) layers.push(next);
  }
  // A caller that passes several components gets the unreached ones as further layers.
  const rest = [...adj.keys()].filter((u) => !depth.has(u)).sort(byUrn);
  if (rest.length) layers.push(rest);
  return layers;
}

/** The cells in one row of a component of `n` nodes: about twice its square root. */
export function rowCells(n) {
  return Math.max(3, Math.ceil(2 * Math.sqrt(n)));
}

/**
 * t342 P2: breadth-first placement of one component, top-down: one band of rows per layer, each row
 * centred, every cell as wide as the component's widest label box; a layer longer than
 * rowCells wraps. Positions are relative to the component's top-left corner (0, 0).
 * @param {readonly string[]} urns - one connected component
 * @param {readonly Link[]} links
 * @param {(urn: string) => LabelBox} sizeOf
 * @param {{ gapX: number, gapY: number, layerGap: number }} gap
 * @returns {{ w: number, h: number, at: Map<string, Position>, layers: string[][] }}
 */
export function breadthFirstPlacement(urns, links, sizeOf, gap) {
  const layers = breadthFirstLayers(urns, links);
  const sizes = new Map(urns.map((u) => [u, sizeOf(u)]));
  const cellW = Math.max(0, ...[...sizes.values()].map((s) => s.w)) + gap.gapX;
  const per = rowCells(urns.length);
  /** @type {string[][][]} rows per layer */
  const rowsOf = layers.map((layer) => {
    const rows = [];
    for (let i = 0; i < layer.length; i += per) rows.push(layer.slice(i, i + per));
    return rows;
  });
  const w = Math.max(0, ...rowsOf.flat().map((row) => row.length * cellW));
  /** @type {Map<string, Position>} */
  const at = new Map();
  let y = 0;
  rowsOf.forEach((rows, li) => {
    if (li > 0) y += gap.layerGap;
    for (const row of rows) {
      const rowH = Math.max(...row.map((u) => sizes.get(u)?.h ?? 0)) + gap.gapY;
      const x0 = (w - row.length * cellW) / 2;
      row.forEach((u, i) => {
        const s = sizes.get(u) ?? { w: 0, h: 0, dx: 0, dy: 0 };
        at.set(u, { x: x0 + i * cellW + (cellW - s.w) / 2 + s.dx, y: y + s.dy });
      });
      y += rowH;
    }
  });
  return { w, h: y, at, layers };
}

/**
 * Two label boxes that share area (a `gap` apart counts as touching).
 * @param {{ x1: number, y1: number, x2: number, y2: number }} a
 * @param {{ x1: number, y1: number, x2: number, y2: number }} b
 */
const overlapOf = (a, b) => ({
  x: Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1),
  y: Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1),
});

/**
 * t342 P2: how many pairs of `urns` have label boxes that overlap at these positions.
 * @param {readonly string[]} urns
 * @param {Map<string, Position>} at
 * @param {(urn: string) => LabelBox} sizeOf
 * @returns {number}
 */
export function labelOverlaps(urns, at, sizeOf) {
  const boxes = urns.map((u) => labelRect(u, at, sizeOf, 0)).sort((a, b) => a.x1 - b.x1);
  let n = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length && boxes[j].x1 < boxes[i].x2; j++) {
      const o = overlapOf(boxes[i], boxes[j]);
      if (o.x > 0 && o.y > 0) n++;
    }
  }
  return n;
}

/**
 * @param {string} urn
 * @param {Map<string, Position>} at
 * @param {(urn: string) => LabelBox} sizeOf
 * @param {number} gap
 */
function labelRect(urn, at, sizeOf, gap) {
  const s = sizeOf(urn);
  const p = at.get(urn) ?? { x: 0, y: 0 };
  const x1 = p.x - s.dx - gap / 2;
  const y1 = p.y - s.dy - gap / 2;
  return { urn, x1, y1, x2: x1 + s.w + gap, y2: y1 + s.h + gap };
}

/** t342 P2: how many times separateLabels may spread a crowd that its sweeps did not clear. */
export const SEPARATE_ROUNDS = 20;

/**
 * t342 P2: after a cose refinement, push apart the label boxes that still overlap — cose keeps
 * the node discs apart, not always their labels (on the scratch fold's 158-node component about
 * 50 pairs overlapped). Each pass sweeps the boxes left to right and moves both nodes of an
 * overlapping pair half the overlap apart, along the axis that needs the shorter move; a round
 * stops at the first pass that moves nothing. A crowd that still overlaps after `passes` is
 * spread 5 % from its centre and swept again, up to SEPARATE_ROUNDS times — the spread clears
 * what the sweeps only shuffle, the sweeps keep the spread small; what is left after that is
 * counted in FrameGraph's layout report. Measured on hp-laptop's 287-node component with
 * label-sized boxes: 301 overlapping pairs to 0 in about 150 ms, the component 10 % wider.
 * Deterministic: boxes are taken in x order, then by urn. Returns new positions; `at` is not
 * changed.
 * @param {readonly string[]} urns
 * @param {Map<string, Position>} at
 * @param {(urn: string) => LabelBox} sizeOf
 * @param {number} gap - the room kept between two label boxes
 * @param {number} [passes] - sweeps per round
 * @returns {Map<string, Position>}
 */
export function separateLabels(urns, at, sizeOf, gap, passes = 100) {
  /** @type {Map<string, Position>} */
  const pos = new Map(urns.map((u) => [u, { ...(at.get(u) ?? { x: 0, y: 0 }) }]));
  for (let round = 0; round < SEPARATE_ROUNDS; round++) {
    if (sweepApart(urns, pos, sizeOf, gap, passes)) break;
    const ps = [...pos.values()];
    const cx = ps.reduce((t, p) => t + p.x, 0) / (ps.length || 1);
    const cy = ps.reduce((t, p) => t + p.y, 0) / (ps.length || 1);
    for (const p of ps) {
      p.x = cx + (p.x - cx) * 1.05;
      p.y = cy + (p.y - cy) * 1.05;
    }
  }
  return pos;
}

/**
 * Up to `passes` sweeps of separateLabels over `pos`, in place; true when one moved nothing.
 * @param {readonly string[]} urns
 * @param {Map<string, Position>} pos
 * @param {(urn: string) => LabelBox} sizeOf
 * @param {number} gap
 * @param {number} passes
 * @returns {boolean}
 */
function sweepApart(urns, pos, sizeOf, gap, passes) {
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    const boxes = urns
      .map((u) => labelRect(u, pos, sizeOf, gap))
      .sort((a, b) => a.x1 - b.x1 || byUrn(a.urn, b.urn));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length && boxes[j].x1 < boxes[i].x2; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const o = overlapOf(a, b);
        if (o.x <= 0 || o.y <= 0) continue;
        const pa = /** @type {Position} */ (pos.get(a.urn));
        const pb = /** @type {Position} */ (pos.get(b.urn));
        if (o.x <= o.y) {
          const d = o.x / 2 + 0.5;
          const dir = a.x1 + a.x2 <= b.x1 + b.x2 ? 1 : -1;
          pa.x -= dir * d;
          pb.x += dir * d;
        } else {
          const d = o.y / 2 + 0.5;
          const dir = a.y1 + a.y2 <= b.y1 + b.y2 ? 1 : -1;
          pa.y -= dir * d;
          pb.y += dir * d;
        }
        boxes[i] = labelRect(a.urn, pos, sizeOf, gap);
        boxes[j] = labelRect(b.urn, pos, sizeOf, gap);
        moved = true;
      }
    }
    if (!moved) return true;
  }
  return false;
}
