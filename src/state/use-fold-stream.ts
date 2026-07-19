/**
 * Collider Pilot - live fold-stream React hook (Phase 6)
 * ======================================================
 * Wraps `createFoldStream` in a component-friendly hook: subscribe to the kernel SSE only
 * while `active`, DEBOUNCE a caller-supplied reload on each `rewrite`, pulse on every
 * rewrite, and resync (reload) on reconnect. Returns `{ status, pulseKey }` for a live
 * indicator.
 *
 * The reload callback is held in a ref so the subscription is NOT torn down when the
 * callback's identity changes across renders — the effect depends only on `active`/`url`.
 * `active` is a boolean, so it stays stable across frame refreshes (true stays true): the
 * stream is opened once when live-ness turns on and closed when it turns off or on unmount.
 *
 * READ-ONLY: EventSource is GET-only; this hook never writes to the HG.
 */

import { useEffect, useRef, useState } from "react";
import { createFoldStream, type FoldStream } from "../mcp/fold-stream";
import { DEFAULT_ENGINE_URL } from "../mcp/transform.js";

export type StreamStatus = "off" | "live" | "reconnecting";

/** The kernel SSE endpoint (:8000 host-permission already granted in the manifest). */
export const FOLD_STREAM_URL = `${DEFAULT_ENGINE_URL}/fold/stream`;
/** Debounce window for coalescing bursts of `rewrite` events into a single reload. */
export const REWRITE_DEBOUNCE_MS = 300;

export interface UseFoldStreamOptions {
  /** Subscribe only while true (e.g. the frame is a live read). */
  active: boolean;
  /** Stream URL. Defaults to the kernel fold stream. */
  url?: string;
  /** Called (debounced) on each rewrite and (immediately) on reconnect resync. */
  onReload: () => void;
}

export function useFoldStream({
  active,
  url = FOLD_STREAM_URL,
  onReload,
}: UseFoldStreamOptions): { status: StreamStatus; pulseKey: number } {
  const [status, setStatus] = useState<StreamStatus>("off");
  const [pulseKey, setPulseKey] = useState(0);
  const onReloadRef = useRef(onReload);
  onReloadRef.current = onReload;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) {
      setStatus("off");
      return; // MOCK / inactive path: never open an EventSource.
    }
    setStatus("live");
    let stream: FoldStream | null = null;
    try {
      stream = createFoldStream(url, {
        onOpen: (reconnected) => {
          setStatus("live");
          // A reconnect may have missed appends (drop-not-block) → resync a full read.
          if (reconnected) onReloadRef.current();
        },
        onEvent: (kind) => {
          if (kind !== "rewrite") return; // initial snapshot: already loaded
          setPulseKey((k) => k + 1);
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            debounceRef.current = null;
            onReloadRef.current();
          }, REWRITE_DEBOUNCE_MS);
        },
        onError: () => setStatus("reconnecting"),
      });
    } catch {
      // Never let a stream construction error blank the panel — the frame already loaded.
      setStatus("reconnecting");
    }
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      stream?.close();
    };
  }, [active, url]);

  return { status, pulseKey };
}
