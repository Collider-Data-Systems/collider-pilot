/**
 * Collider Pilot - textual node inspector
 * =======================================
 * The panel beside the graph. Shows the selected node's urn / type_id / properties.
 * Also lists the node's incident **relations** (never "edges") for orientation.
 *
 * t337: a node's `text` (a claim's content) is shown as a paragraph above the property
 * table, and a relation row reads from the selected node's own end — the converse port
 * name on an incoming relation, in the vocabulary's colour when it has one.
 */

import { useRef, useState } from "react";
import type { HgFrame, HgNode, HgProperties, HgRelation } from "../mcp/types";
import { kbConversePort, kbPortStyle } from "../ui/kb-vocab.js";

/** The property shown as a paragraph instead of a table row (t337). */
const TEXT_PROPERTY = "text";

/**
 * t337: what a relation is called read from its TARGET end — the converse port. The
 * knowledge vocabulary declares it; every other relation carries it as `tgt_port`
 * (transform.js mapRelation). Without either, the relation keeps its label.
 */
function conversePortOf(relation: HgRelation): string {
  const declared = kbConversePort(relation.label);
  if (declared) return declared;
  const carried = relation.properties?.tgt_port;
  return typeof carried === "string" && carried ? carried : relation.label;
}

function PropertyRows({ properties, omit }: { properties: HgProperties; omit?: string }) {
  const keys = Object.keys(properties).filter((k) => k !== omit);
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
  onNavigate,
  collapsible = false,
}: {
  frame: HgFrame;
  node: HgNode | null;
  onSelect: (urn: string | null) => void;
  /**
   * t337: a relation row was clicked — select the other node AND centre the graph on it.
   * Absent, a row only selects (`onSelect`).
   */
  onNavigate?: (urn: string) => void;
  /**
   * t264: in the side panel the detail view is collapsible, because a mirror (PiP /
   * pop-out / full tab) usually shows the same node — collapsing reclaims the panel's
   * scarce height without losing anything. The mirrors pass false: there the inspector
   * IS the detail surface.
   */
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const paneRef = useRef<HTMLElement | null>(null);

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

  // t337: shown once, in full, as a paragraph — and so left out of the table below.
  const rawText = node.properties[TEXT_PROPERTY];
  const text = typeof rawText === "string" && rawText.trim() ? rawText : null;

  return (
    <aside className="inspector" aria-label="Node inspector" ref={paneRef}>
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

      {text && (
        <div className="insp-section">
          <div className="insp-section-title">{TEXT_PROPERTY}</div>
          <p className="insp-text">{text}</p>
        </div>
      )}

      <div className="insp-section">
        <div className="insp-section-title">properties</div>
        <PropertyRows properties={node.properties} omit={text ? TEXT_PROPERTY : undefined} />
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
              // t337: an incoming relation is named from THIS node's end (its converse
              // port); a knowledge port takes the colour the graph draws it in.
              const port = outgoing ? r.label : conversePortOf(r);
              const color = kbPortStyle(r.label)?.color;
              return (
                <li key={r.urn}>
                  <span className="insp-rel-dir">{outgoing ? "→" : "←"}</span>
                  <span
                    className="insp-rel-label"
                    style={color ? { color } : undefined}
                    title={port === r.label ? undefined : `${port} — the converse of ${r.label}`}
                  >
                    {port}
                  </span>
                  <span className="insp-rel-kind">{r.type_id}</span>
                  <button
                    className="insp-rel-target"
                    title={otherUrn}
                    onClick={() => {
                      (onNavigate ?? onSelect)(otherUrn);
                      // t337: the rows sit at the bottom of a scrolling pane — show the node
                      // this row leads to from its top (type, label, text), not from here.
                      paneRef.current?.scrollTo({ top: 0 });
                    }}
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
