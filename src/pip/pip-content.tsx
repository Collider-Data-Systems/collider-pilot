/**
 * Collider Pilot - Document PiP content view (Phase 3, leaned by the t263 UX eval)
 * ================================================================================
 * The compact frame view rendered INSIDE the Document Picture-in-Picture window
 * (and, standalone, inside `pip-preview.html` for served-page testing). It is a
 * PURE presentational component: it holds no store, no adapter, no I/O.
 *
 * t263 item 5 — LEAN MIRROR: the PiP is a glanceable observation surface, so it renders
 * the GRAPH + the one-line POSTURE STRIP only. The duplicated provenance wall and the
 * textual inspector are gone — the full audit drawer is still one click away on the strip,
 * and inspection/actions live in the side panel (the PiP never mounts Actions; it stays
 * read/observe). Selection still mirrors both ways through the shared scratch.
 *
 * DEFENSIVE RENDER (Phase 1-fix discipline, preserved): every frame field is
 * Array.isArray-guarded before it reaches a child, and this whole subtree is wrapped
 * by an ErrorBoundary at each mount root (the real PiP mount in pip-window.tsx and the
 * pip-preview harness both wrap it). A partial/stale frame must never blank the mirror.
 */

import type { HgFrame } from "../mcp/types";
import { PostureStrip } from "../components/PostureStrip";
import { FrameGraph } from "../components/FrameGraph";

export interface PipContentProps {
  /** The frame to mirror (passed through the shared scratch, never re-fetched). */
  frame: HgFrame | null;
  /** The shared selection (urn) or null. */
  selectedUrn: string | null;
  /** Selection handler; writes back to the shared scratch so the panel mirrors it. */
  onSelect: (urn: string | null) => void;
  /** Whether the mirror is bound to a live scratch stream (drives the status dot). */
  connected?: boolean;
  /** Label variant: the real PiP mirror vs the served-page preview. */
  variant?: "pip" | "preview";
}

export function PipContent({
  frame,
  selectedUrn,
  onSelect,
  connected,
  variant = "pip",
}: PipContentProps) {
  const isConnected = connected ?? frame != null;

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
            {variant === "preview" ? "PiP · preview" : "PiP mirror"}
          </span>
        </div>
      </header>

      {frame && <PostureStrip provenance={frame.provenance} />}

      <main className="pilot-body">
        {!frame && (
          <div className="pilot-state pip-waiting">
            Waiting for the side panel to project a frame…
          </div>
        )}
        {frame && (
          <FrameGraph
            frame={frame}
            selectedUrn={selectedUrn}
            onSelect={onSelect}
          />
        )}
      </main>
    </div>
  );
}
