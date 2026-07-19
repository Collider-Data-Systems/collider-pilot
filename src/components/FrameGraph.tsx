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

const TYPE_COLOR: Record<string, string> = {
  knowledge_item: "#6366f1",
  derivation: "#22c55e",
  purpose: "#eab308",
  session: "#38bdf8",
};
const DEFAULT_COLOR = "#a0a0b0";

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
}: {
  frame: HgFrame;
  selectedUrn: string | null;
  onSelect: (urn: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
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
        layout: { name: "cose", animate: false, padding: 12 },
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

  // Rebuild elements + relayout when the frame changes.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    try {
      cy.elements().remove();
      cy.add(toElements(frame));
      cy.layout({ name: "cose", animate: false, padding: 12 }).run();
      cy.fit(undefined, 16);
      setGraphError(null);
    } catch (err) {
      setGraphError(`graph render failed: ${String(err)}`);
    }
  }, [frame]);

  // Reflect external selection (e.g. restored from scratch) into the graph.
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
  }, [selectedUrn, frame]);

  return (
    <div className="graph-wrap">
      {graphError && <div className="pilot-state error">{graphError}</div>}
      <div className="graph-canvas" ref={containerRef} />
      <div className="graph-legend" aria-hidden="true">
        <span className="legend-item">
          <i style={{ background: TYPE_COLOR.knowledge_item }} /> knowledge_item
        </span>
        <span className="legend-item">
          <i style={{ background: TYPE_COLOR.derivation }} /> derivation
        </span>
        <span className="legend-item">
          <i style={{ background: TYPE_COLOR.purpose }} /> purpose
        </span>
        <span className="legend-item">
          <i style={{ background: TYPE_COLOR.session }} /> session
        </span>
        <span className="legend-note">arrows are relations</span>
      </div>
    </div>
  );
}
