/**
 * Collider Pilot - textual node inspector
 * =======================================
 * The panel beside the graph. Shows the selected node's urn / type_id / properties.
 * Also lists the node's incident **relations** (never "edges") for orientation.
 */

import { useState } from "react";
import type { HgFrame, HgNode, HgProperties } from "../mcp/types";

function PropertyRows({ properties }: { properties: HgProperties }) {
  const keys = Object.keys(properties);
  if (keys.length === 0) {
    return <div className="insp-empty">no properties</div>;
  }
  return (
    <table className="insp-props">
      <tbody>
        {keys.map((k) => (
          <tr key={k}>
            <td className="insp-key">{k}</td>
            <td className="insp-val">{String(properties[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function NodeInspector({
  frame,
  node,
  onSelect,
  collapsible = false,
}: {
  frame: HgFrame;
  node: HgNode | null;
  onSelect: (urn: string | null) => void;
  /**
   * t264: in the side panel the detail view is collapsible, because a mirror (PiP /
   * pop-out / full tab) usually shows the same node — collapsing reclaims the panel's
   * scarce height without losing anything. The mirrors pass false: there the inspector
   * IS the detail surface.
   */
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(true);

  if (collapsible && !open) {
    return (
      <aside className="inspector inspector-collapsed" aria-label="Node inspector (collapsed)">
        <button type="button" className="insp-toggle" onClick={() => setOpen(true)}>
          ▸ inspect
          <span className="insp-toggle-node">
            {node ? `${node.type_id} · ${node.label}` : "no selection"}
          </span>
        </button>
      </aside>
    );
  }

  if (!node) {
    return (
      <aside className="inspector" aria-label="Node inspector">
        <div className="insp-placeholder">
          Select a node in the graph to inspect its urn, type, and properties.
        </div>
      </aside>
    );
  }

  const frameNodes = Array.isArray(frame?.nodes) ? frame.nodes : [];
  const frameRelations = Array.isArray(frame?.relations) ? frame.relations : [];
  const labelOf = (urn: string) =>
    frameNodes.find((n) => n.urn === urn)?.label ?? urn;

  const incident = frameRelations.filter(
    (r) => r.source_urn === node.urn || r.target_urn === node.urn,
  );

  return (
    <aside className="inspector" aria-label="Node inspector">
      <div className="insp-head">
        {collapsible && (
          <button
            type="button"
            className="insp-toggle insp-toggle-open"
            onClick={() => setOpen(false)}
            title="Collapse the inspector (the mirrors keep showing the node)"
          >
            ▾ inspect
          </button>
        )}
        <span className="insp-type">{node.type_id}</span>
        <span className="insp-name">{node.label}</span>
      </div>

      <div className="insp-section">
        <div className="insp-section-title">urn</div>
        <code className="insp-urn">{node.urn}</code>
      </div>

      <div className="insp-section">
        <div className="insp-section-title">properties</div>
        <PropertyRows properties={node.properties} />
      </div>

      <div className="insp-section">
        <div
          className="insp-section-title"
          title={
            "Incident relations PRESENT IN THIS SLICE. A relation renders only when both of " +
            "its endpoints survive the view_filter, so narrowing types or ports can hide some: " +
            "e.g. the manifold has 9 spans in the fold but shows 7 under the topology lens, " +
            "because the purpose and group it spans are not among that lens's types. Widen the " +
            "lens (or use `everything`) to see the node's full incidence."
          }
        >
          relations in slice ({incident.length})
        </div>
        {incident.length === 0 ? (
          <div className="insp-empty">no incident relations</div>
        ) : (
          <ul className="insp-relations">
            {incident.map((r) => {
              const outgoing = r.source_urn === node.urn;
              const otherUrn = outgoing ? r.target_urn : r.source_urn;
              return (
                <li key={r.urn}>
                  <span className="insp-rel-dir">{outgoing ? "→" : "←"}</span>
                  <span className="insp-rel-label">{r.label}</span>
                  <span className="insp-rel-kind">{r.type_id}</span>
                  <button
                    className="insp-rel-target"
                    title={otherUrn}
                    onClick={() => onSelect(otherUrn)}
                  >
                    {labelOf(otherUrn)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
