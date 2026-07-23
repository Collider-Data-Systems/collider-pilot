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
 */

import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { HgFrame } from "../mcp/types";
import type { GraphLayoutName } from "../state/prefs";
import { DEFAULT_GRAPH_LAYOUT } from "../state/prefs";

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

/** How many type swatches the legend overlay shows before "+N more types". */
const LEGEND_CAP = 8;

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

/**
 * Per-layout Cytoscape options. All layouts ship in cytoscape core (no new dep). Every
 * one is `animate:false` (deterministic, snappy on a narrow panel) with consistent
 * padding. `concentric` is the default — it lays the DAG-ish frame out in semantic rings
 * and eliminates the cose label-overlap on a narrow side panel.
 */
function layoutOptions(name: GraphLayoutName): cytoscape.LayoutOptions {
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

function toElements(frame: HgFrame): cytoscape.ElementDefinition[] {
  // Defensive: a frame delivered via the worker message channel or restored from
  // stale scratch may be missing an array. Never let a bad shape reach Cytoscape
  // (whose init throws a "non-array … Symbol.iterator" TypeError on non-arrays).
  const frameNodes = Array.isArray(frame?.nodes) ? frame.nodes : [];
  const frameRelations = Array.isArray(frame?.relations) ? frame.relations : [];
  const nodes: cytoscape.ElementDefinition[] = frameNodes.map((n) => ({
    group: "nodes",
    // Node id === URN (stable semantic id). Only semantic fields go in data.
    data: { id: n.urn, label: n.label, type_id: n.type_id },
  }));
  // Cytoscape "edges" == mo:os relations. Guard against dangling endpoints.
  const nodeUrns = new Set(frameNodes.map((n) => n.urn));
  const edges: cytoscape.ElementDefinition[] = frameRelations
    .filter((r) => nodeUrns.has(r.source_urn) && nodeUrns.has(r.target_urn))
    .map((r) => ({
      group: "edges",
      data: {
        id: r.urn,
        source: r.source_urn,
        target: r.target_urn,
        label: r.label,
        type_id: r.type_id,
      },
    }));
  return [...nodes, ...edges];
}

// Type coloring via attribute selectors keeps color OUT of node data (derived, not
// stored). Base rule first; per-type rules have higher specificity and win.
const STYLE: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      "background-color": DEFAULT_COLOR,
      label: "data(label)",
      color: "#f0f0f5",
      "font-size": "9px",
      "text-wrap": "wrap",
      "text-max-width": "90px",
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
      "line-color": "#3a3a48",
      "target-arrow-color": "#3a3a48",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.8,
      "curve-style": "bezier",
      label: "data(label)",
      color: "#a0a0b0",
      "font-size": "8px",
      "text-rotation": "autorotate",
      "text-background-color": "#0f0f12",
      "text-background-opacity": 0.85,
      "text-background-padding": "2px",
    },
  },
  {
    selector: "edge:selected",
    style: { "line-color": "#6366f1", "target-arrow-color": "#6366f1" },
  },
];

export function FrameGraph({
  frame,
  selectedUrn,
  onSelect,
  layout = DEFAULT_GRAPH_LAYOUT,
  focusUrn = null,
  focusSignal = 0,
}: {
  frame: HgFrame;
  selectedUrn: string | null;
  onSelect: (urn: string | null) => void;
  /** Which cytoscape-core layout to run. Defaults to the concentric read. */
  layout?: GraphLayoutName;
  /** A node to center on when `focusSignal` bumps (used by node search). */
  focusUrn?: string | null;
  /** Increment to re-center on `focusUrn` (lets a repeat search re-center the same node). */
  focusSignal?: number;
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
        minZoom: 0.2,
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

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Rebuild elements + relayout when the frame OR the chosen layout changes. Re-adding
  // the (small) element set on a layout-only change is cheap and keeps the graph always
  // consistent — the same simplicity/consistency tradeoff as the live re-fetch path.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    try {
      cy.elements().remove();
      cy.add(toElements(frame));
      cy.layout(layoutOptions(layout)).run();
      cy.fit(undefined, 16);
      setGraphError(null);
    } catch (err) {
      setGraphError(`graph render failed: ${String(err)}`);
    }
  }, [frame, layout]);

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
  }, [selectedUrn, frame, layout]);

  // Center on a searched node when the search bumps `focusSignal`. Kept separate from
  // selection so clicking a node in the graph never yanks the viewport.
  useEffect(() => {
    if (!focusSignal) return;
    const cy = cyRef.current;
    const urn = focusUrnRef.current;
    if (!cy || !urn) return;
    try {
      const el = cy.getElementById(urn);
      if (el.nonempty()) cy.animate({ center: { eles: el } }, { duration: 200 });
    } catch {
      // centering is a best-effort nicety — never let it surface as a graph error
    }
  }, [focusSignal]);

  return (
    <div className="graph-wrap">
      {graphError && <div className="pilot-state error">{graphError}</div>}
      <div className="graph-canvas" ref={containerRef} />
      {/* t264: legend derived from the types ACTUALLY in the frame, never a stale
          hardcoded list. Ranked by node count (an alphabetical cut hid the dominant
          types under the wide lenses) and the overflow is stated, not silent. */}
      {(() => {
        const counts = new Map<string, number>();
        for (const n of Array.isArray(frame?.nodes) ? frame.nodes : []) {
          counts.set(n.type_id, (counts.get(n.type_id) ?? 0) + 1);
        }
        const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const shown = ranked.slice(0, LEGEND_CAP);
        const hidden = ranked.length - shown.length;
        return (
          <div className="graph-legend" aria-hidden="true">
            {shown.map(([ty, count]) => (
              <span key={ty} className="legend-item" title={`${ty} · ${count}`}>
                <i style={{ background: TYPE_COLOR[ty] ?? DEFAULT_COLOR }} /> {ty}
              </span>
            ))}
            {hidden > 0 && <span className="legend-note">+{hidden} more types</span>}
            <span className="legend-note">arrows are relations</span>
          </div>
        );
      })()}
    </div>
  );
}
