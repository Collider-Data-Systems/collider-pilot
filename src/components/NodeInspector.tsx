/**
 * Collider Pilot - textual node inspector
 * =======================================
 * The panel beside the graph. Shows the selected node's urn / type_id / properties.
 * Also lists the node's incident **relations** (never "edges") for orientation.
 */

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
}: {
  frame: HgFrame;
  node: HgNode | null;
  onSelect: (urn: string | null) => void;
}) {
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
        <div className="insp-section-title">
          relations ({incident.length})
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
