/**
 * Collider Pilot - Document PiP window controller (Phase 3)
 * =========================================================
 * The shared module that turns a user gesture into a Document Picture-in-Picture
 * mirror of the side panel, wires the two surfaces to ONE shared state store
 * (`chrome.storage.session` scratch, key `pilot.scratch.v1`), and tears down cleanly
 * when the PiP window closes or its opener goes away.
 *
 * Exit criteria mapping (#158 Steinberger review):
 *   1. Gesture-only open — `openPipMirror()` calls `requestWindow()` SYNCHRONOUSLY,
 *      with no `await` before it, so the user-activation is still valid.
 *   2/3. Same frame + selection — the PiP React tree runs in the OPENER's JS realm
 *      (createRoot just targets the PiP document's DOM), reads the SAME scratch, and
 *      renders the SAME `HgFrame` the panel projected (passed through scratch, never
 *      re-fetched — no adapter, no engine call in this module).
 *   4. Graceful degrade — `pagehide` on the PiP window tears down and notifies the
 *      opener (button re-enables); a `pagehide` on the opener closes the PiP first.
 *      The PiP window never outlives its opener (browser-enforced); we handle it.
 *   5. No placement control — we pass width/height only; the UA owns position.
 *   6. Feature-detect — `isDocumentPipSupported()` gates the button; unsupported ⇒
 *      disabled with a tooltip, side panel fully functional.
 *
 * CSS: a PiP document does NOT inherit the opener's stylesheet, so `copyStyles()`
 * adopts every same-origin sheet (reconstructed as inline <style>) into the PiP head,
 * falling back to a <link> for any sheet whose rules can't be read.
 */

import { createRoot, type Root } from "react-dom/client";
import { useCallback, useEffect, useState } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { PipContent } from "./pip-content";
import type { HgFrame } from "../mcp/types";
import {
  loadScratch,
  saveSelectedUrn,
  subscribeScratch,
  type PilotScratch,
} from "../state/scratch";

/** Default PiP window size. Position is UA-owned and NOT set here (criterion 5). */
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 560;

export interface OpenPipOptions {
  width?: number;
  height?: number;
  /** Called once the PiP window is open and mounted. */
  onOpen?: () => void;
  /** Called once the PiP window has closed / torn down (graceful degrade hook). */
  onClose?: () => void;
}

/**
 * Feature-detect the Document PiP API. The single gate for the Pop-out button:
 * when this is false the button is disabled with a tooltip and the panel is unaffected.
 */
export function isDocumentPipSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.documentPictureInPicture &&
    typeof window.documentPictureInPicture.requestWindow === "function"
  );
}

// Module-singleton PiP handle. Only one mirror at a time; a second click focuses it.
let pipWindow: Window | null = null;
let pipRoot: Root | null = null;
let pipOpening = false;
let onCloseCb: (() => void) | null = null;

export function isPipOpen(): boolean {
  return pipWindow != null;
}

export function focusPip(): void {
  try {
    pipWindow?.focus();
  } catch {
    // window may be mid-teardown; harmless
  }
}

export function closePip(): void {
  try {
    pipWindow?.close();
  } catch {
    // already closing; teardown fires via pagehide
  }
}

/**
 * Open (or focus) the Document PiP mirror. MUST be called directly inside a user-gesture
 * handler — `requestWindow()` is the first async op with NO `await` before it, preserving
 * the user-activation the API requires (criterion 1).
 */
export function openPipMirror(opts: OpenPipOptions = {}): void {
  if (!isDocumentPipSupported()) return; // button is disabled in this case anyway
  if (pipWindow) {
    focusPip();
    return;
  }
  if (pipOpening) return; // debounce a double-click before the first mount

  pipOpening = true;
  onCloseCb = opts.onClose ?? null;
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;

  const dpip = window.documentPictureInPicture;
  if (!dpip) {
    pipOpening = false;
    return;
  }

  // First async statement in the gesture — do NOT await anything before this line.
  dpip
    .requestWindow({ width, height })
    .then((win) => {
      pipOpening = false;
      mountInto(win);
      opts.onOpen?.();
    })
    .catch((err: unknown) => {
      pipOpening = false;
      console.error("[pilot] PiP requestWindow failed:", err);
      teardown();
    });
}

/** Mount the mirror React tree into the fresh PiP document and wire lifecycle. */
function mountInto(win: Window): void {
  pipWindow = win;
  try {
    win.document.title = "Collider Pilot — PiP mirror";
    copyStyles(document, win.document);

    const host = win.document.createElement("div");
    host.id = "pip-root";
    win.document.body.appendChild(host);

    pipRoot = createRoot(host);
    pipRoot.render(
      <ErrorBoundary>
        <PipMirrorApp pipWindow={win} />
      </ErrorBoundary>,
    );
  } catch (err) {
    console.error("[pilot] PiP mount failed:", err);
    teardown();
    return;
  }

  // The PiP window is going away (user closed it, OR the opener navigated/closed and the
  // browser force-closed the child). Clean up exactly once.
  win.addEventListener("pagehide", handlePipPagehide, { once: true });
  // Defensive: if the opener unloads first, close the PiP proactively (the browser also
  // enforces this — the PiP never outlives its opener — but we don't leave a dangling root).
  window.addEventListener("pagehide", closePip, { once: true });
}

function handlePipPagehide(): void {
  teardown();
}

/** Idempotent teardown: unmount React, drop handles, notify the opener. */
function teardown(): void {
  window.removeEventListener("pagehide", closePip);
  const root = pipRoot;
  const cb = onCloseCb;
  pipRoot = null;
  pipWindow = null;
  onCloseCb = null;
  pipOpening = false;
  if (root) {
    try {
      root.unmount();
    } catch {
      // PiP document may already be detached; unmount is best-effort
    }
  }
  if (cb) cb();
}

/**
 * Copy the opener's stylesheets into the PiP document (which inherits none). Same-origin
 * sheets (the extension's own CSS, hashed in prod or injected in dev) are reconstructed as
 * inline <style>; any sheet whose `cssRules` can't be read falls back to a linked href.
 * This is the MDN-recommended Document PiP style-adoption pattern.
 */
function copyStyles(from: Document, to: Document): void {
  for (const sheet of Array.from(from.styleSheets)) {
    try {
      const cssText = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
      const style = to.createElement("style");
      style.textContent = cssText;
      to.head.appendChild(style);
    } catch {
      // Cross-origin (or otherwise unreadable) sheet — link it by href instead.
      if (sheet.href) {
        const link = to.createElement("link");
        link.rel = "stylesheet";
        link.type = sheet.type || "text/css";
        if (sheet.media?.mediaText) link.media = sheet.media.mediaText;
        link.href = sheet.href;
        to.head.appendChild(link);
      }
    }
  }
}

/** Cheap frame-identity signature so an unchanged frame keeps object identity (no relayout). */
function frameSignature(frame: HgFrame | null): string {
  if (!frame) return "";
  const p = frame.provenance;
  const n = Array.isArray(frame.nodes) ? frame.nodes.length : 0;
  const r = Array.isArray(frame.relations) ? frame.relations.length : 0;
  return `${p?.engine ?? ""}|${p?.log_seq ?? ""}|${p?.folded_at ?? ""}|${n}|${r}`;
}

/**
 * The mirror app rendered inside the PiP window. Runs in the OPENER's JS realm, so
 * `chrome.storage` is always available here regardless of the PiP window's own realm.
 * Frame flows one-way (panel → scratch → here); selection flows BOTH ways through the
 * shared scratch. No adapter, no engine call — pure read/UI (Phase 4 write-gate intact).
 */
function PipMirrorApp({ pipWindow: win }: { pipWindow: Window }) {
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

  // Backup re-read when the PiP window regains focus (covers any missed change event).
  useEffect(() => {
    const reread = () => void loadScratch().then(applyScratch);
    win.addEventListener("focus", reread);
    win.addEventListener("pageshow", reread);
    return () => {
      win.removeEventListener("focus", reread);
      win.removeEventListener("pageshow", reread);
    };
  }, [win, applyScratch]);

  // Selecting in the PiP writes selection back to the shared scratch (preserving the
  // panel-authored frame); the side panel observes it via storage.onChanged.
  const handleSelect = useCallback((urn: string | null) => {
    setSelectedUrn(urn);
    void saveSelectedUrn(urn);
  }, []);

  return (
    <PipContent
      frame={frame}
      selectedUrn={selectedUrn}
      onSelect={handleSelect}
      connected={frame != null}
      variant="pip"
    />
  );
}
