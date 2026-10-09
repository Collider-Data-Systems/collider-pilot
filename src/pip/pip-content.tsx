/**
 * Collider Pilot - Document PiP content view (Phase 3, leaned by the t263 UX eval)
 * ================================================================================
 * The compact frame view rendered INSIDE the Document Picture-in-Picture window, the
 * popup mirror, the FULL-TAB mirror, and (standalone) `pip-preview.html`. It is a PURE
 * presentational component: it holds no store, no adapter, no I/O.
 *
 * t263 item 5 — LEAN MIRROR: the small mirrors (Document PiP + popup) are glanceable
 * observation surfaces, so they render the GRAPH + the one-line POSTURE STRIP only; the
 * full audit drawer stays one click away on the strip, and inspection/actions live in
 * the side panel (no mirror ever mounts Actions; they stay read/observe). The FULL-TAB
 * mirror (`variant="tab"`, t263 review catch) has the screen space a PiP lacks, so it
 * keeps the NodeInspector — the lean-down was aimed at the PiP, not at removing the only
 * node-detail surface from every pip.html context. Selection still mirrors both ways
 * through the shared scratch on every variant.
 *
 * t337 — SAME DRAWING AS THE PANEL: the mount passes the layout chosen in Settings and the
 * view the panel's search / inspector put on the frame (matches lit, the rest faded, a node
 * to centre on) straight through to FrameGraph, which already brings the nesting, the
 * vocabulary colours and the legend. Still no store and no I/O here — the mounts read them
 * (`useMirrorView`).
 *
 * DEFENSIVE RENDER (Phase 1-fix discipline, preserved): frame arrays are guarded before
 * any lookup, and this whole subtree is wrapped by an ErrorBoundary at each mount root.
 * A partial/stale frame must never blank the mirror.
 */

import { useCallback, useMemo, useState } from "react";
import type { HgFrame, HgNode } from "../mcp/types";
import type { GraphLayoutName } from "../state/prefs";
import type { ScratchFocus } from "../state/scratch";
import { PostureStrip } from "../components/PostureStrip";
import { FrameGraph, type RelationPalette } from "../components/FrameGraph";
import { NodeInspector } from "../components/NodeInspector";

export interface PipContentProps {
  /** The frame to mirror (passed through the shared scratch, never re-fetched). */
  frame: HgFrame | null;
  /** The shared selection (urn) or null. */
  selectedUrn: string | null;
  /** Selection handler; writes back to the shared scratch so the panel mirrors it. */
  onSelect: (urn: string | null) => void;
  /** Whether the mirror is bound to a live scratch stream (drives the status dot). */
  connected?: boolean;
  /** Surface variant: lean PiP mirror, full-tab mirror (keeps inspector), or preview. */
  variant?: "pip" | "tab" | "preview";
  /** t337: the layout CHOICE from Settings. Absent = `auto`, as FrameGraph defaults. */
  layout?: GraphLayoutName;
  /** t337: urns the panel's search matched — every other node fades. Empty = no fade. */
  highlightUrns?: readonly string[];
  /** t337: the panel's centre request (an inspector relation row clicked there). */
  focus?: ScratchFocus | null;
}

export function PipContent({
  frame,
  selectedUrn,
  onSelect,
  connected,
  variant = "pip",
  layout,
  highlightUrns,
  focus = null,
}: PipContentProps) {
  const isConnected = connected ?? frame != null;
  // Only the full-tab mirror has the space for node detail; the PiP stays lean.
  const showInspector = variant === "tab";

  // Defensive: normalize the frame's arrays before any lookup or child render.
  const nodes = Array.isArray(frame?.nodes) ? (frame as HgFrame).nodes : [];
  const selectedNode: HgNode | null = useMemo(
    () => nodes.find((n) => n.urn === selectedUrn) ?? null,
    [nodes, selectedUrn],
  );

  // t337: a relation row in THIS mirror's inspector selects the other node and centres the
  // graph on it. Centring is therefore asked for from two places — here and the panel —
  // and the later request wins.
  const [ownFocus, setOwnFocus] = useState<ScratchFocus | null>(null);
  // t342 P1 (review): the relation palette (decision 2: port colour by default), held here so
  // the inspector colours its rows as the graph draws them. Not saved, like the legend ticks.
  const [palette, setPalette] = useState<RelationPalette>("port");
  const handleNavigate = useCallback(
    (urn: string) => {
      onSelect(urn);
      setOwnFocus({ urn, at: Date.now() });
    },
    [onSelect],
  );
  const centre = ownFocus && (!focus || ownFocus.at > focus.at) ? ownFocus : focus;

  return (
    <div className="pilot-container pip-container">
      <header className="pilot-header pip-header">
        <div className="header-left">
          <span
            className={`status-dot ${isConnected ? "connected" : ""}`}
            title={isConnected ? "mirroring side panel" : "waiting for a frame"}
          />
          <h1>Collider Pilot</h1>
          <span className="header-sub">
            {variant === "preview"
              ? "PiP · preview"
              : variant === "tab"
                ? "full-tab mirror"
                : "PiP mirror"}
          </span>
        </div>
      </header>

      {frame && <PostureStrip provenance={frame.provenance} />}
      {!frame && (
        <section className="provenance posture-strip" aria-label="Frame posture (no frame)">
          <div className="prov-top">
            <span
              className="prov-badge readonly"
              title="No write path exists in any mirror — this surface only observes."
            >
              READ-ONLY
            </span>
            <span className="prov-summary">no frame yet — posture renders with the frame</span>
          </div>
        </section>
      )}

      <main className="pilot-body">
        {!frame && (
          <div className="pilot-state pip-waiting">
            Waiting for the side panel to project a frame…
          </div>
        )}
        {frame && (
          <>
            <FrameGraph
              frame={frame}
              selectedUrn={selectedUrn}
              onSelect={onSelect}
              layout={layout}
              focusUrn={centre?.urn ?? null}
              focusSignal={centre?.at ?? 0}
              highlightUrns={highlightUrns}
              palette={palette}
              onPaletteChange={setPalette}
            />
            {showInspector && (
              <NodeInspector
                frame={frame}
                node={selectedNode}
                onSelect={onSelect}
                onNavigate={handleNavigate}
                palette={palette}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
