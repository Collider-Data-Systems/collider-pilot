/**
 * Collider Pilot - textual node inspector
 * =======================================
 * The panel beside the graph. Shows the selected node's urn / type_id / properties, and
 * (t347 PIL-17) the node as an interface with the **relations** it holds and receives.
 *
 * t337: a node's `text` (a claim's content) is shown as a paragraph above the property
 * table, and a relation row reads from the selected node's own end — the converse port
 * name on an incoming relation, in the vocabulary's colour when it has one.
 *
 * t342 P1 (review): a row takes the colour the graph draws it in under the ACTIVE palette —
 * in port colour (the default) κ of the port named from this node's end, in relation kind
 * the vocabulary's colour — and its tooltip names which.
 *
 * t342 PIL-6: the port NAME is written in ink and the colour sits in a dot beside it — a name
 * written in its hue failed 4.5:1 on the pane (three of the engine's families, 3.50 to 4.46).
 * PIL-9: the tooltip uses the shared state words (no colour, exempt, pair not declared).
 * t344 PIL-13: a relation whose ends are in two colour families is drawn as a fault, grey at
 * both ends; its row's dot is that grey and its tooltip says "two colours: a fault".
 * t344 PIL-14: an incoming relation's name from this end falls back to the engine's declared
 * pairs (FrameGraph conversePortOf) before the label: the knowledge vocabulary's converse
 * first, then the relation's own `tgt_port`, then the engine's grammar.
 * t347 PIL-17: the relations are no longer one flat list — the node is shown as an interface
 * (Sam's P1; P1b, R-prod): on the left, what it accepts — every relation arriving at it, one row
 * each (fan-in is not grouped while Q2 is open), read as a chain from the node it comes from to the
 * in-port it enters, a direction coordinate; on the right, what it offers — each out-port it holds,
 * a position coordinate, with the relations it holds there, each to the node it goes to, and the
 * type's position coordinates it holds nothing on; above, its type's interface in the Workbench's
 * count words (WB-24) and how
 * many out-ports the node holds. Each row is one relation, the one step it is; no two are
 * composed into one (nodeInterface).
 */

import { useRef, useState } from "react";
import type { HgFrame, HgNode, HgProperties, HgRelation } from "../mcp/types";
import { interfaceOf } from "../mcp/engine-grammar.js";
import { KB_VOCAB_VERSION, kbPortStyle } from "../ui/kb-vocab.js";
import { hasPortColours, paintRelation } from "../ui/port-colour.js";
import { conversePortOf, relationColourWords, relationConverseWords, type RelationPalette } from "./FrameGraph";

/** The property shown as a paragraph instead of a table row (t337). */
const TEXT_PROPERTY = "text";

/**
 * t347 PIL-17: a node read as an interface (Sam's P1, P1b) — what it holds per out-port and what
 * arrives at it, from the relations of the frame, beside its type's interface from the engine's
 * grammar (engine-grammar.js interfaceOf, PIL-22).
 */
export interface NodeInterface {
  /** The type's position and direction coordinates; null without an engine grammar that declares it. */
  type: { positions: string[]; directions: string[] } | null;
  /**
   * The out-ports the node holds a relation on, each with the relations it holds there (each
   * out-port one coordinate of its position). The type's position coordinates first, in its order,
   * then any other port by name. `declared`: whether the type's interface has that out-port —
   * false where the grammar does not give the type that port, null where the interface is not
   * known (no grammar, or a type it does not declare).
   */
  held: { port: string; declared: boolean | null; relations: HgRelation[] }[];
  /** The type's position coordinates on which the node holds no relation. */
  empty: string[];
  /**
   * Every relation arriving at the node, one row each — fan-in is not grouped while Q2 is open —
   * named by the port at this end (FrameGraph conversePortOf: the vocabulary, the relation's own
   * `tgt_port`, the engine's pairs), in the frame's order.
   */
  arriving: { port: string; relation: HgRelation }[];
}

/**
 * t347 PIL-17: the node's interface in this frame. Relations are listed one by one, each as the
 * step it is (this node → target, source → this node); none is composed with another, so nothing
 * here names two nodes that share no relation. Pure; exported for `smoke:lens` N.
 */
export function nodeInterface(frame: HgFrame | null | undefined, node: Pick<HgNode, "urn" | "type_id">): NodeInterface {
  const relations = Array.isArray(frame?.relations) ? frame.relations : [];
  const grammar = frame?.provenance?.grammar;
  const iface = interfaceOf(grammar, node.type_id);
  const byPort = new Map<string, HgRelation[]>();
  for (const r of relations) {
    if (r.source_urn !== node.urn) continue;
    byPort.set(r.label, [...(byPort.get(r.label) ?? []), r]);
  }
  const positions = iface?.positions ?? [];
  const order = [...positions.filter((p) => byPort.has(p)), ...[...byPort.keys()].filter((p) => !positions.includes(p)).sort()];
  return {
    type: iface ? { positions: iface.positions, directions: iface.directions } : null,
    held: order.map((port) => ({
      port,
      declared: iface ? positions.includes(port) : null,
      relations: byPort.get(port) ?? [],
    })),
    empty: positions.filter((p) => !byPort.has(p)),
    arriving: relations
      .filter((r) => r.target_urn === node.urn)
      .map((relation) => ({ port: conversePortOf(relation, grammar), relation })),
  };
}

/**
 * t347 PIL-17: a type's interface in the Workbench's count words (operad-lib.js interfaceCounts,
 * WB-24): `n direction coordinates · m position coordinates`, and a side with no port is one
 * direction or one position with no coordinate — never "0 positions" (P1b).
 */
export function interfaceCountWords(type: { positions: string[]; directions: string[] }): string {
  const side = (n: number, w: string) => (n ? `${n} ${w} coordinate${n === 1 ? "" : "s"}` : `one ${w} (no coordinate)`);
  return `${side(type.directions.length, "direction")} · ${side(type.positions.length, "position")}`;
}

/**
 * t347 PIL-17: how many out-ports the node holds a relation on, in words, and how many of them its
 * type's interface does not have. The type's own count is the line above (interfaceCountWords), so
 * it is not repeated here: "holds 4 of 6" would read as 6 positions, and a node has one position
 * (P1b, R-prod: its out-ports are the coordinates of that one position).
 */
export function heldWords(held: NodeInterface["held"]): string {
  const n = held.length;
  const foreign = held.filter((h) => h.declared === false).length;
  return (
    (n === 0 ? "holds no out-port" : `holds ${n} out-port${n === 1 ? "" : "s"}`) +
    (foreign ? ` (${foreign} its type does not have)` : "")
  );
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
  palette = "port",
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
  /** t342 P1 (review): the graph's palette, so a row is coloured as the graph draws it. */
  palette?: RelationPalette;
}) {
  const [open, setOpen] = useState(true);
  const paneRef = useRef<HTMLElement | null>(null);

  if (collapsible && !open) {
    return (
      <aside className="inspector inspector-collapsed" aria-label="Node inspector (collapsed)">
        <button
          type="button"
          className="insp-toggle"
          data-testid="inspector-expand"
          onClick={() => setOpen(true)}
        >
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
  const labelOf = (urn: string) =>
    frameNodes.find((n) => n.urn === urn)?.label ?? urn;

  // t347 PIL-17: the node as an interface — its arriving relations, its out-ports and what it holds
  // on each, beside its type's interface from the engine's grammar.
  const ifc = nodeInterface(frame, node);
  const grammar = frame?.provenance?.grammar;
  const portColour = palette === "port" && hasPortColours(grammar);

  // t342 P1 (review): a row takes the colour the graph draws its end at this node in — κ of that
  // port in port colour (a state end is the neutral grey), the vocabulary's colour of a knowledge
  // port in relation kind. t344 PIL-13: a fault says so. t347 PIL-21: an arriving row says its
  // converse with †. t347 PIL-17: the rewrite category moved into the tooltip (the two sides
  // share the pane's width).
  const rowPaint = (r: HgRelation, outgoing: boolean) => {
    const paint = portColour ? paintRelation(r, grammar) : null;
    const kappa = paint && paint.palette === "port" ? paint : null;
    const end = kappa ? (outgoing ? kappa.src : kappa.tgt) : null;
    const color = end ? end.hue : kbPortStyle(r.label)?.color;
    // t348 (review of #50, M5): the colour is the relation's — "relation colour: F", a fault
    // "two colours: a fault" (FrameGraph relationColourWords).
    const colourNote = end
      ? relationColourWords(r, grammar, outgoing)
      : color
        ? `relation kind (kb-vocab ${KB_VOCAB_VERSION})`
        : null;
    const rowTitle = [outgoing ? null : relationConverseWords(r, grammar), colourNote, r.type_id]
      .filter(Boolean)
      .join(" · ");
    return { color, rowTitle };
  };
  const targetButton = (otherUrn: string) => (
    <button
      className="insp-rel-target"
      data-testid="inspector-relation-target"
      title={otherUrn}
      onClick={() => {
        (onNavigate ?? onSelect)(otherUrn);
        // t337: the rows sit at the bottom of a scrolling pane — show the node this row leads
        // to from its top (type, label, text), not from here.
        paneRef.current?.scrollTo({ top: 0 });
      }}
    >
      {labelOf(otherUrn)}
    </button>
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
            data-testid="inspector-collapse"
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

      <div className="insp-section insp-interface" data-testid="inspector-interface">
        <div
          className="insp-section-title"
          title={
            "The node as an interface. On the left, what it accepts: every relation arriving at it, " +
            "one row each, from the node it comes from to the in-port it enters (a direction " +
            "coordinate). On the right, what it offers: each out-port it holds (a position " +
            "coordinate), with the relations it holds there, each to the node it goes to. Each row is " +
            "one relation, the one step it is; no two are composed into one. Only relations PRESENT " +
            "IN THIS SLICE are listed: a relation renders only when both of its endpoints survive the " +
            "view_filter, so a narrower lens can hide some — widen the lens (or use `everything`) to " +
            "see the node's full incidence."
          }
        >
          interface
        </div>
        <div
          className="insp-ifc-counts"
          data-testid="inspector-interface-type"
          title={
            ifc.type
              ? "The type's interface, read from the engine's grammar. Direction coordinates (P1; P1b, R-prod): its in-ports, what it accepts (its arguments); position coordinates: its out-ports, what it offers (its results). Its out-ports together make one position, one coordinate each, and its in-ports one direction; a side with no port has exactly one position (or direction), never none."
              : "The engine's grammar does not declare this type (or the frame carries no grammar), so only the relations are listed."
          }
        >
          {node.type_id} · {ifc.type ? interfaceCountWords(ifc.type) : "interface not known"}
        </div>
        <div
          className="insp-ifc-held"
          data-testid="inspector-held"
          data-held={ifc.held.length}
          title="The out-ports this node holds a relation on in this slice; each is listed on the right with the relations it holds there."
        >
          {heldWords(ifc.held)}
        </div>
        <div className="insp-ifc">
          <div className="insp-ifc-side" data-side="directions">
            <div
              className="insp-ifc-head"
              title="what the node accepts: its in-ports, the direction coordinates (its arguments) — every relation arriving at it, one row each"
            >
              accepts
            </div>
            {ifc.arriving.length === 0 ? (
              ifc.type && ifc.type.directions.length === 0 ? (
                <div className="insp-empty" title="no in-port: it has exactly one direction, with no coordinate">
                  one direction (no coordinate)
                </div>
              ) : (
                <div className="insp-empty">nothing arrives in this slice</div>
              )
            ) : (
              <ul className="insp-relations">
                {ifc.arriving.map(({ port, relation: r }) => {
                  const { color, rowTitle } = rowPaint(r, false);
                  // A chain, left to right: the node it comes from → the in-port it enters.
                  return (
                    <li key={r.urn} data-relation={r.urn} data-other={r.source_urn}>
                      {targetButton(r.source_urn)}
                      <span className="insp-rel-dir">→</span>
                      <span className="insp-rel-label" title={rowTitle || undefined}>
                        {/* t342 PIL-6: the colour as a dot, the name in ink. */}
                        {color && <i className="legend-dot insp-rel-dot" style={{ background: color }} />}
                        {port}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="insp-ifc-side" data-side="positions">
            <div
              className="insp-ifc-head"
              title="what the node offers: its out-ports, the position coordinates (its results), which together make its one position — each out-port it holds, with the relations it holds there"
            >
              offers
            </div>
            {ifc.held.length === 0 &&
              (ifc.type && ifc.type.positions.length === 0 ? (
                <div className="insp-empty" title="no out-port: it has exactly one position, with no coordinate">
                  one position (no coordinate)
                </div>
              ) : (
                <div className="insp-empty">nothing leaves it in this slice</div>
              ))}
            {ifc.held.map(({ port, declared, relations }) => (
              <div key={port} className="insp-ifc-port" data-held-port={port}>
                <div
                  className="insp-ifc-port-head"
                  title={
                    `${port}: ` +
                    (declared === true
                      ? `a position coordinate of ${node.type_id}; `
                      : declared === false
                        ? `the engine's grammar does not give ${node.type_id} this out-port; `
                        : "") +
                    `${relations.length} relation${relations.length === 1 ? "" : "s"} held here`
                  }
                >
                  <span className="insp-rel-label">{port}</span>
                  <span className="insp-ifc-n">{relations.length}</span>
                </div>
                <ul className="insp-relations">
                  {relations.map((r) => {
                    const { color, rowTitle } = rowPaint(r, true);
                    // A chain, left to right: this out-port → the node it goes to.
                    return (
                      <li key={r.urn} data-relation={r.urn} data-other={r.target_urn} title={rowTitle || undefined}>
                        <span className="insp-rel-dir">→</span>
                        {color && <i className="legend-dot insp-rel-dot" style={{ background: color }} />}
                        {targetButton(r.target_urn)}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {ifc.empty.length > 0 && (
              <div
                className="insp-ifc-none"
                title="the position coordinates of its type on which this node holds no relation in this slice"
              >
                none held on {ifc.empty.join(", ")}
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
