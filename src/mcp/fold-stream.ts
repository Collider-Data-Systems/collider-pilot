/**
 * Collider Pilot - live fold stream subscription (Phase 6)
 * ========================================================
 * A thin, READ-ONLY wrapper over the kernel's Server-Sent-Events endpoint
 * `GET {engineUrl}/fold/stream`. EventSource is a GET-only transport — it cannot
 * POST, cannot carry a body, and has no apply path — so this module can never write
 * to the HG. It exists purely to learn *when* the folded log changed so the panel can
 * re-read a fresh frame through the existing adapter.
 *
 * PROTOCOL (probed):
 *   - on connect the kernel emits `event: snapshot\ndata: {nodes,relations,t}`
 *   - then `event: rewrite\ndata: {log_seq,rewrite}` per append
 *   - it is DROP-NOT-BLOCK for slow clients, so a reconnect can miss appends → the
 *     caller MUST resync with a full re-read on every (re)connect. We surface that as
 *     `onOpen(reconnected)` so the panel can re-run its adapter read.
 *
 * We do NOT hand-reduce rewrite deltas here. The payloads are passed through verbatim
 * (as raw text) to the caller, which debounces a full adapter re-fetch — simpler and
 * always consistent with the engine (a full frame read is ~16ms for ~286 nodes).
 *
 * LIFECYCLE: EventSource auto-reconnects, but we take reconnection over explicitly to
 * apply exponential backoff (capped) and to fire a single, clean `onOpen(reconnected)`
 * per successful (re)connection. `close()` tears everything down idempotently.
 *
 * PANEL-ONLY: `EventSource` exists in a DOM (side-panel) context, NOT in the MV3 service
 * worker — this module is imported only from panel code, never from worker.ts.
 */

export type FoldStreamEventKind = "snapshot" | "rewrite";

export interface FoldStreamHandlers {
  /** Fired per SSE event. `data` is the raw event `data:` text (unparsed). */
  onEvent?: (kind: FoldStreamEventKind, data: string) => void;
  /**
   * Fired on each successful (re)connection. `reconnected` is false for the very first
   * open (the panel already loaded a frame) and true for every subsequent open — the
   * caller resyncs on `true` to cover the drop-not-block gap.
   */
  onOpen?: (reconnected: boolean) => void;
  /** Fired when the transport errors, before a reconnect is scheduled. */
  onError?: () => void;
}

export interface FoldStreamOptions {
  /** Initial reconnect delay in ms (default 1000). */
  backoffBaseMs?: number;
  /** Maximum reconnect delay in ms (default 15000). */
  backoffMaxMs?: number;
}

export interface FoldStream {
  /** Tear down the stream and cancel any pending reconnect. Idempotent. */
  close(): void;
}

/**
 * Open a managed subscription to the kernel fold stream. Returns a handle whose
 * `close()` fully disposes it. Never throws synchronously — construction failures
 * (e.g. EventSource unavailable) surface through `onError` and a scheduled retry.
 */
export function createFoldStream(
  url: string,
  handlers: FoldStreamHandlers = {},
  options: FoldStreamOptions = {},
): FoldStream {
  const backoffBase = options.backoffBaseMs ?? 1000;
  const backoffMax = options.backoffMaxMs ?? 15000;

  let es: EventSource | null = null;
  let closed = false;
  let connectedOnce = false;
  let backoff = backoffBase;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const clearReconnect = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const teardownEs = () => {
    if (es) {
      try {
        es.close();
      } catch {
        // already torn down
      }
      es = null;
    }
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer !== null) return;
    const delay = backoff;
    backoff = Math.min(backoff * 2, backoffMax);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  function connect(): void {
    if (closed) return;
    teardownEs();
    let source: EventSource;
    try {
      source = new EventSource(url);
    } catch {
      // EventSource unavailable or URL rejected — treat as a transport error + retry.
      handlers.onError?.();
      scheduleReconnect();
      return;
    }
    es = source;

    source.onopen = () => {
      if (closed) return;
      backoff = backoffBase; // healthy connection resets the backoff
      const reconnected = connectedOnce;
      connectedOnce = true;
      handlers.onOpen?.(reconnected);
    };

    source.addEventListener("snapshot", (ev) => {
      if (closed) return;
      handlers.onEvent?.("snapshot", (ev as MessageEvent).data ?? "");
    });
    source.addEventListener("rewrite", (ev) => {
      if (closed) return;
      handlers.onEvent?.("rewrite", (ev as MessageEvent).data ?? "");
    });

    source.onerror = () => {
      if (closed) return;
      handlers.onError?.();
      // Take reconnection over ourselves (backoff) rather than leaning on the
      // built-in fixed-interval retry.
      teardownEs();
      scheduleReconnect();
    };
  }

  connect();

  return {
    close() {
      closed = true;
      clearReconnect();
      teardownEs();
    },
  };
}
