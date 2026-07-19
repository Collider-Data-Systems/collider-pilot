/**
 * Collider Pilot - Document Picture-in-Picture ambient types (Phase 3)
 * ====================================================================
 * The Document Picture-in-Picture API (Chrome 116+) is NOT yet in TypeScript's
 * bundled `lib.dom.d.ts`, so the minimal surface the Pilot uses is declared here.
 *
 * This file is intentionally a GLOBAL script (no top-level import/export) so the
 * `Window` augmentation merges with the DOM lib. Feature-detection stays honest:
 * `window.documentPictureInPicture` is optional, so unsupported browsers type as
 * `undefined` and the disabled-button fallback is enforced at compile time.
 *
 * Spec: https://developer.mozilla.org/en-US/docs/Web/API/Document_Picture-in-Picture_API
 */

interface DocumentPictureInPictureOptions {
  /** Initial width, in pixels. The browser MAY adjust it; placement is NOT controllable. */
  width?: number;
  /** Initial height, in pixels. */
  height?: number;
  /** Hide the "back to tab" button. Left default (false) for the Pilot. */
  disallowReturnToOpener?: boolean;
  /** Ask the UA to reuse the last PiP window placement. Advisory only. */
  preferInitialWindowPlacement?: boolean;
}

interface DocumentPictureInPictureEvent extends Event {
  readonly window: Window;
}

interface DocumentPictureInPictureEventMap {
  enter: DocumentPictureInPictureEvent;
}

interface DocumentPictureInPicture extends EventTarget {
  /** The current PiP window, or null when none is open. */
  readonly window: Window | null;
  /**
   * Open a Document PiP window. REQUIRES a user gesture — must be called
   * synchronously in the gesture handler (no `await` before it).
   */
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
  onenter:
    | ((this: DocumentPictureInPicture, ev: DocumentPictureInPictureEvent) => unknown)
    | null;
  addEventListener<K extends keyof DocumentPictureInPictureEventMap>(
    type: K,
    listener: (
      this: DocumentPictureInPicture,
      ev: DocumentPictureInPictureEventMap[K],
    ) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof DocumentPictureInPictureEventMap>(
    type: K,
    listener: (
      this: DocumentPictureInPicture,
      ev: DocumentPictureInPictureEventMap[K],
    ) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
}

interface Window {
  /** Present only where the Document PiP API is supported; the feature-detect gate. */
  readonly documentPictureInPicture?: DocumentPictureInPicture;
}
