/**
 * Collider Pilot - P9 WebTransport SPIKE: presence hook (panel-only, READ-ONLY)
 * ============================================================================
 * Wraps `createWtPresenceClient` in a component-friendly hook. Mirrors the
 * `use-fold-stream.ts` shape: open on mount, tear down on unmount, decouple the UI
 * refresh rate from the datagram rate, and surface a strip-ready snapshot.
 *
 * The client is created once on mount (config is resolved internally from
 * chrome.storage.local['pilot.wt'], default OFF). It transitions to "unavailable"
 * synchronously-ish when WebTransport is missing or the flag is off, so `available`
 * is false and the strip renders NOTHING — graceful, no throw.
 *
 * UI refresh is throttled: datagrams land at ~20 Hz but we snapshot `stats()` on a
 * ~150 ms interval (~6.7 Hz) so React re-renders the tiny strip at a sane rate.
 *
 * READ-ONLY: the client only RECEIVES datagrams; this hook never writes to the HG.
 */

import { useEffect, useState } from "react";
import {
  createWtPresenceClient,
  type WtClientState,
  type WtStats,
} from "../wt/wt-client";

/** UI snapshot cadence — decoupled from the ~20 Hz datagram arrival rate. */
export const WT_UI_REFRESH_MS = 150;

export interface UseWtPresenceResult {
  /** True only while actively connecting/connected — the strip's visibility gate. */
  available: boolean;
  /** Current client state. */
  state: WtClientState;
  /** Latest stats snapshot (safe defaults before the first datagram). */
  stats: WtStats;
}

const EMPTY_STATS: WtStats = {
  state: "idle",
  count: 0,
  lastSeq: null,
  gaps: 0,
  hz: 0,
  lastValue: null,
  lastTMs: null,
  history: [],
  detail: "",
};

export function useWtPresence(): UseWtPresenceResult {
  const [state, setState] = useState<WtClientState>("idle");
  const [stats, setStats] = useState<WtStats>(EMPTY_STATS);

  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;

    const client = createWtPresenceClient({
      onState: (next) => {
        if (cancelled) return;
        setState(next);
        setStats(client.stats());
      },
    });

    // Throttled snapshot of the fast-moving stats (value/seq/hz) while mounted.
    poll = setInterval(() => {
      if (cancelled) return;
      setStats(client.stats());
    }, WT_UI_REFRESH_MS);

    // Seed once immediately (covers the synchronous "unavailable" gate result).
    setState(client.getState());
    setStats(client.stats());

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
      client.close();
    };
  }, []);

  // Strip is visible only while the spike is actively enabled + reaching the endpoint.
  const available = state === "connecting" || state === "connected";
  return { available, state, stats };
}
