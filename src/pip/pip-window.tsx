/**
 * Collider Pilot - PiP window controller (Phase 3 + side-panel fallback)
 * ======================================================================
 * Turns a user gesture into a mirror of the side panel and wires it to ONE shared state
 * store (`chrome.storage.session` scratch, key `pilot.scratch.v1`). There are TWO open
 * paths, tried in order, so "Pop out" ALWAYS opens something:
 *
 *   A. Document Picture-in-Picture (`documentPictureInPicture.requestWindow()`) — the
 *      compact, always-on-top mirror. Works from a full-tab realm. It runs the mirror
 *      React tree in the OPENER's JS realm (createRoot targets the PiP document's DOM).
 *
 *   B. `chrome.windows.create` popup rendering `pip.html` — the UNIVERSAL fallback. Used
 *      when Document PiP is unavailable, most importantly a Chrome extension SIDE PANEL,
 *      where `requestWindow()` REJECTS ("no window") instead of opening. The popup is a
 *      real extension page in its OWN realm; `src/pip.tsx` there does its own shared-
 *      scratch sync (read + storage.onChanged + saveSelectedUrn), so both paths mirror
 *      the SAME frame + selection.
 *
 * Exit criteria mapping (#158 Steinberger review):
 *   1. Gesture-only open — the Document-PiP `requestWindow()` is still called
 *      SYNCHRONOUSLY with no `await` before it, so the user-activation is valid. The
 *      chrome.windows fallback needs no activation (extension API), so it may run in the
 *      `requestWindow()` rejection handler.
 *   2/3. Same frame + selection — path A reads the SAME scratch in the opener realm;
 *      path B's pip.html reads the SAME scratch in its own realm. Neither re-fetches.
 *   4. Graceful degrade — path A: `pagehide` tears down + notifies the opener; path B:
 *      `chrome.windows.onRemoved` + the opener's `pagehide` (which closes the popup).
 *   5. No placement control (path A) — width/height only. Path B is a normal popup window.
 *   6. Feature-detect — `isPopOutSupported()` gates the button: enabled whenever EITHER
 *      Document PiP OR chrome.windows is available (the latter is always true in an
 *      extension), so in the extension the button is effectively always enabled.
 *
 * CSS: a Document PiP document does NOT inherit the opener's stylesheet, so `copyStyles()`
 * adopts every same-origin sheet into the PiP head (path A). Path B's pip.html imports the
 * sidepanel CSS directly, so it needs no style adoption.
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
  frameSignature,
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
 * Feature-detect the Document PiP API. True where `requestWindow()` exists — note this
 * can be true in a side panel even though `requestWindow()` will REJECT there; the reject
 * is caught at open time and the popup fallback takes over.
 */
export function isDocumentPipSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.documentPictureInPicture &&
    typeof window.documentPictureInPicture.requestWindow === "function"
  );
}

/**
 * Feature-detect the chrome.windows popup fallback. Available in ANY extension context
 * (no manifest permission is required for chrome.windows.create on the extension's own
 * pages), so this is effectively always true in the loaded extension and false only in a
 * plain served page (no `chrome` object).
 */
export function isChromeWindowsAvailable(): boolean {
  return (
    typeof chrome !== "undefined" &&
    !!chrome.windows &&
    typeof chrome.windows.create === "function"
  );
}

/**
 * The single gate for the "Pop out" button. Enabled whenever EITHER open path is
 * available; only disabled when NEITHER is (a non-extension context with no Document PiP).
 * In the extension this is always true, so "Pop out" always opens SOMETHING.
 */
export function isPopOutSupported(): boolean {
  return isDocumentPipSupported() || isChromeWindowsAvailable();
}

// Module-singleton mirror handles. Only one mirror at a time; a second click focuses it.
// Exactly one of {pipWindow (Document PiP), popupWindowId (chrome.windows popup)} is set.
let pipWindow: Window | null = null;
let pipRoot: Root | null = null;
let pipOpening = false;
let popupWindowId: number | null = null;
let popupRemovedListener: ((closedWindowId: number) => void) | null = null;
let onCloseCb: (() => void) | null = null;

export function isPipOpen(): boolean {
  return pipWindow != null || popupWindowId != null;
}

export function focusPip(): void {
  if (pipWindow) {
    try {
      pipWindow.focus();
    } catch {
      // window may be mid-teardown; harmless
    }
    return;
  }
  if (popupWindowId != null && isChromeWindowsAvailable()) {
    try {
      void chrome.windows.update(popupWindowId, { focused: true });
    } catch {
      // popup may be mid-teardown; onRemoved will reconcile
    }
  }
}

export function closePip(): void {
  if (pipWindow) {
    try {
      pipWindow.close();
    } catch {
      // already closing; teardown fires via pagehide
    }
  }
  if (popupWindowId != null && isChromeWindowsAvailable()) {
    try {
      // Triggers chrome.windows.onRemoved -> teardown. If it throws (already gone),
      // reconcile state directly so we never leave a dangling handle.
      void chrome.windows.remove(popupWindowId);
    } catch {
      teardown();
    }
  }
}

/**
 * Open (or focus) the mirror. MUST be called directly inside a user-gesture handler:
 * the Document-PiP `requestWindow()` is the first async op with NO `await` before it,
 * preserving the user-activation that API requires (criterion 1). If Document PiP is
 * unavailable OR rejects (side-panel context, no window), it FALLS BACK to a real
 * `chrome.windows.create` popup rendering pip.html — the universal path that works from
 * the side panel. The fallback needs no user activation (extension API), so running it in
 * the rejection handler is safe.
 */
export function openPipMirror(opts: OpenPipOptions = {}): void {
  if (!isPopOutSupported()) return; // button is disabled in this case anyway
  if (isPipOpen()) {
    focusPip();
    return;
  }
  if (pipOpening) return; // debounce a double-click before the first mount

  pipOpening = true;
  onCloseCb = opts.onClose ?? null;
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;

  const dpip =
    typeof window !== "undefined" ? window.documentPictureInPicture : undefined;

  // Path A: Document PiP first (works from a full-tab realm). Keep this SYNCHRONOUS in
  // the gesture — do NOT await anything before requestWindow().
  if (isDocumentPipSupported() && dpip) {
    dpip
      .requestWindow({ width, height })
      .then((win) => {
        pipOpening = false;
        mountInto(win);
        opts.onOpen?.();
      })
      .catch((err: unknown) => {
        // Rejected (side-panel context / no window / unsupported) — fall back to a real
        // popup window. No user activation is needed for chrome.windows.create.
        console.warn(
          "[pilot] Document PiP unavailable; falling back to popup window:",
          err,
        );
        openPopupFallback(width, height, opts);
      });
    return;
  }

  // Path B: no Document PiP at all — go straight to the popup-window fallback.
  openPopupFallback(width, height, opts);
}

/**
 * The universal fallback: a real `chrome.windows.create` popup rendering pip.html from the
 * shared scratch. Tracks the created window id so a second click focuses it and teardown
 * closes it; wires `chrome.windows.onRemoved` + the opener's `pagehide` for graceful
 * degrade. Uses the callback form so `chrome.runtime.lastError` is inspected explicitly.
 */
function openPopupFallback(
  width: number,
  height: number,
  opts: OpenPipOptions,
): void {
  if (!isChromeWindowsAvailable()) {
    // Neither open path is available (non-extension context) — nothing to open.
    teardown();
    return;
  }
  try {
    chrome.windows.create(
      {
        url: chrome.runtime.getURL("pip.html"),
        type: "popup",
        width,
        height,
        focused: true,
      },
      (win) => {
        pipOpening = false;
        if (chrome.runtime.lastError || !win || win.id == null) {
          console.error(
            "[pilot] popup-window fallback failed:",
            chrome.runtime.lastError?.message,
          );
          teardown();
          return;
        }
        popupWindowId = win.id;
        // Reset state + notify the opener when the user closes the popup.
        popupRemovedListener = (closedWindowId: number) => {
          if (closedWindowId === popupWindowId) teardown();
        };
        chrome.windows.onRemoved.addListener(popupRemovedListener);
        // If the opener (side panel) unloads first, proactively close the popup.
        window.addEventListener("pagehide", closePip, { once: true });
        opts.onOpen?.();
      },
    );
  } catch (err) {
    console.error("[pilot] popup-window fallback threw:", err);
    teardown();
  }
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

/**
 * Idempotent teardown for BOTH open paths: unmount the Document-PiP React root (path A),
 * detach the chrome.windows.onRemoved listener (path B), drop all handles, and notify the
 * opener exactly once. Safe to call from either path — the other path's fields are null.
 */
function teardown(): void {
  window.removeEventListener("pagehide", closePip);
  // Path A: Document PiP React realm.
  const root = pipRoot;
  pipRoot = null;
  pipWindow = null;
  if (root) {
    try {
      root.unmount();
    } catch {
      // PiP document may already be detached; unmount is best-effort
    }
  }
  // Path B: chrome.windows popup.
  if (popupRemovedListener && isChromeWindowsAvailable()) {
    try {
      chrome.windows.onRemoved.removeListener(popupRemovedListener);
    } catch {
      // listener already gone with the context — nothing to remove
    }
  }
  popupRemovedListener = null;
  popupWindowId = null;
  // Shared.
  const cb = onCloseCb;
  onCloseCb = null;
  pipOpening = false;
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
