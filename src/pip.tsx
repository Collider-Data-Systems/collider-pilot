/**
 * Collider Pilot - popup-window PiP mirror page (Phase 3 fallback)
 * ================================================================
 * The REAL, chrome-wired mirror rendered inside the `chrome.windows.create` popup window
 * (`pip.html`). It is the universal fallback for when Document Picture-in-Picture is not
 * allowed — most importantly a Chrome extension SIDE PANEL context, where
 * `documentPictureInPicture.requestWindow()` rejects (no window) instead of opening.
 *
 * Unlike `pip-preview.tsx` (a dev harness that fakes the shared state with a local
 * MockMcpAdapter), THIS page is wired to the live shared store: it runs in its own
 * extension realm, so it reads `chrome.storage.session` scratch (`pilot.scratch.v1`)
 * for the current frame + selection, subscribes to `storage.onChanged` for both-way
 * sync with the side panel, and writes selection back via `saveSelectedUrn`. It renders
 * the SAME `PipContent` mirror the Document-PiP path mounts, so the two open paths are
 * visually and behaviourally identical.
 *
 * DEFENSIVE RENDER + ErrorBoundary preserved: every frame is Array.isArray-guarded before
 * it reaches PipContent, and the whole tree is ErrorBoundary-wrapped so a partial/stale
 * scratch frame can never blank the mirror. The sidepanel CSS is imported so the popup
 * window inherits the panel's styling (a popup extension page adopts no opener sheet).
 */

import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { HgFrame } from "./mcp/types";
import { PipContent } from "./pip/pip-content";
import { applyMountGuard } from "./ui/mount-guard";
import {
  loadScratch,
  saveSelectedUrn,
  subscribeScratch,
  frameSignature,
  type PilotScratch,
} from "./state/scratch";
import "./sidepanel.css";

/**
 * The mirror app rendered in the popup window's own realm. Frame flows one-way
 * (panel → scratch → here); selection flows BOTH ways through the shared scratch.
 * No adapter, no engine call — pure read/UI (Phase 4 write-gate intact).
 */
function PipWindowApp() {
  const [frame, setFrame] = useState<HgFrame | null>(null);
  const [selectedUrn, setSelectedUrn] = useState<string | null>(null);

  const applyScratch = useCallback((s: PilotScratch) => {
    const safe =
      s.frame &&
      Array.isArray(s.frame.nodes) &&
      Array.isArray(s.frame.relations)
        ? s.frame
        : null;
    // Preserve frame object identity when nothing material changed, so FrameGraph
    // doesn't relayout on every mirrored selection tick.
    setFrame((prev) =>
      frameSignature(prev) === frameSignature(safe) ? prev : safe,
    );
    setSelectedUrn(safe ? s.selectedUrn : null);
  }, []);

  // Initial read + event-driven sync (storage.onChanged); no polling loop.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await loadScratch();
      if (!cancelled) applyScratch(s);
    })();
    const unsub = subscribeScratch((s) => applyScratch(s));
    return () => {
      cancelled = true;
      unsub();
    };
  }, [applyScratch]);

  // Backup re-read when the popup regains focus (covers any missed change event).
  useEffect(() => {
    const reread = () => void loadScratch().then(applyScratch);
    window.addEventListener("focus", reread);
    window.addEventListener("pageshow", reread);
    return () => {
      window.removeEventListener("focus", reread);
      window.removeEventListener("pageshow", reread);
    };
  }, [applyScratch]);

  // Selecting in the popup writes selection back to the shared scratch (preserving the
  // panel-authored frame); the side panel observes it via storage.onChanged.
  const handleSelect = useCallback((urn: string | null) => {
    setSelectedUrn(urn);
    void saveSelectedUrn(urn);
  }, []);

  // The same page serves the popup mirror AND the full-tab mirror; the side panel's
  // "Full tab" button opens pip.html?surface=tab, which keeps the NodeInspector
  // (t263 review catch — the lean-down targeted the PiP, not the full-tab surface).
  const isTab = new URLSearchParams(window.location.search).get("surface") === "tab";

  return (
    <PipContent
      frame={frame}
      selectedUrn={selectedUrn}
      onSelect={handleSelect}
      connected={frame != null}
      variant={isTab ? "tab" : "pip"}
    />
  );
}

const container = document.getElementById("root");
if (container) {
  // Same guard as the side panel: web-accessible from localhost ⇒ never embedded, and
  // never auto-connecting when a script opened the window.
  const mount = () =>
    createRoot(container).render(
      <ErrorBoundary>
        <PipWindowApp />
      </ErrorBoundary>,
    );
  if (applyMountGuard(container, mount)) mount();
}
