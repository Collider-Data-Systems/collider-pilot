/**
 * Collider Pilot - P9 WebTransport SPIKE: datagram client (panel-only, READ-ONLY)
 * ==============================================================================
 * A feature-flagged, OFF-by-default WebTransport datagram CLIENT that RECEIVES the
 * kernel's synthetic presence stream (moos-kernel #59, `--wt-addr :8443`,
 * `https://<host>:8443/wt/presence`). It opens `new WebTransport(url)`, reads
 * `datagrams.readable`, JSON-parses each frame to the contract shape, and exposes a
 * tiny subscribe API (`onDatagram`, `onState`) plus a `stats()` snapshot.
 *
 * WHY A SPIKE, NOT A SURFACE
 * --------------------------
 * Phase-5 measured the reliable MCP/SSE read path at ~61 Hz p95 — above any realistic
 * single-user UI rate. This client PROVES the datagram pipe end-to-end; it does NOT
 * replace or beat the reliable path, and NOTHING durable (tool calls, HG rewrites)
 * ever moves onto it. See docs/phase5-data-plane.md.
 *
 * HARD INVARIANTS
 * ---------------
 *   - READ-ONLY: it only RECEIVES datagrams. There is no write/POST/apply path — the
 *     WebTransport session is used purely to read `datagrams.readable`. The reliable
 *     SSE/MCP paths are untouched.
 *   - FEATURE-FLAGGED OFF by default: resolved from chrome.storage.local['pilot.wt']
 *     = { enabled:boolean, url?:string, certHash?:string } (mirrors adapter-factory).
 *   - GRACEFUL FEATURE-DETECT: if `WebTransport` is undefined, the flag is off, or the
 *     connect fails/rejects, the client is INERT and NEVER throws into the panel; the
 *     UI strip stays hidden. Same posture as the PiP feature-detect.
 *   - PANEL-ONLY: `WebTransport` lives in a DOM (side-panel) realm, NOT the MV3 worker.
 *     Imported only from panel code, never from worker.ts.
 *
 * The pure wire/config logic lives in `wt-datagram.js` (shared with the node smoke
 * harness); this module holds only the browser-API connection machinery.
 */

import {
  WT_STORAGE_KEY,
  DEFAULT_WT_URL,
  parsePresenceDatagram,
  parseCertHash,
  normalizeWtConfig,
  evaluateWtGate,
} from "./wt-datagram.js";

export { WT_STORAGE_KEY, DEFAULT_WT_URL };

/**
 * The decoded datagram contract shape (moos-kernel #59). Defined here (not imported as a
 * JSDoc typedef) so the type flow is robust under verbatimModuleSyntax; the runtime parse
 * lives in `wt-datagram.js`.
 */
export interface PresenceDatagram {
  /** Per-session monotonic counter (starts at 1); gaps allowed (lossy). */
  seq: number;
  /** Server wall-clock ms (UnixMilli) at emit time. */
  t_ms: number;
  /** Synthetic signal clamped into [0,1] for rendering. */
  value: number;
  /** Always the fabricated marker. */
  kind: "synthetic.presence";
}

/** The feature-flag config stored at chrome.storage.local['pilot.wt']. */
export interface WtFeatureConfig {
  /** Master flag. DEFAULT false — the spike is OFF by default. */
  enabled: boolean;
  /** Optional endpoint override; defaults to DEFAULT_WT_URL. */
  url?: string;
  /** Optional SHA-256 cert hash (hex or base64) for a self-signed dev cert. */
  certHash?: string;
}

/**
 * Client lifecycle state, surfaced through `onState`:
 *   - "idle"        constructed, gate not yet evaluated
 *   - "unavailable" WebTransport missing OR flag off OR bad cert config → inert
 *   - "connecting"  gate passed; dialing / awaiting `ready`
 *   - "connected"   session open; reading datagrams
 *   - "closed"      cleanly closed (by us or the server)
 *   - "error"       connect rejected / stream errored (inert; strip hides)
 */
export type WtClientState =
  | "idle"
  | "unavailable"
  | "connecting"
  | "connected"
  | "closed"
  | "error";

/** A point-in-time snapshot of the datagram stream, for the UI strip + bench. */
export interface WtStats {
  state: WtClientState;
  /** Total datagrams accepted (parsed to the contract shape). */
  count: number;
  /** Highest `seq` seen, or null before the first datagram. */
  lastSeq: number | null;
  /** Total missed datagrams inferred from `seq` jumps (lossy — gaps expected). */
  gaps: number;
  /** Measured arrival rate (Hz) over a rolling window of recent arrivals. */
  hz: number;
  /** Most recent synthetic value in [0,1], or null. */
  lastValue: number | null;
  /** Server emit timestamp (UnixMilli) of the last datagram, or null. */
  lastTMs: number | null;
  /** Recent values (oldest→newest) for a sparkline. Capped length. */
  history: number[];
  /** Human-readable reason for the current state (esp. unavailable/error). */
  detail: string;
}

export interface WtPresenceHandlers {
  /** Fired per accepted datagram. */
  onDatagram?: (d: PresenceDatagram) => void;
  /** Fired on every state transition. */
  onState?: (state: WtClientState, detail: string) => void;
}

export interface WtPresenceClientOptions extends WtPresenceHandlers {
  /**
   * Pre-resolved config. When omitted, the client resolves it from
   * chrome.storage.local['pilot.wt'] (default OFF). Passing it explicitly is what the
   * smoke harness uses to drive the gate deterministically.
   */
  config?: WtFeatureConfig;
}

export interface WtPresenceClient {
  /** Tear down the session + reader. Idempotent. Safe to call before connect resolves. */
  close(): void;
  /** Current state. */
  getState(): WtClientState;
  /** A snapshot of the stream stats (for the UI strip + bench readout). */
  stats(): WtStats;
}

/** Recent-values ring length for the sparkline. */
const HISTORY_CAP = 60;
/** Rolling window (arrivals) used to measure Hz. */
const HZ_WINDOW = 24;

/**
 * Resolve the spike config from chrome.storage.local['pilot.wt'] (mirrors
 * adapter-factory / prefs). Safe outside an extension: returns the fail-closed default
 * `{ enabled:false }`. Never throws.
 */
export async function resolveWtConfig(): Promise<WtFeatureConfig> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const got = await chrome.storage.local.get(WT_STORAGE_KEY);
      return normalizeWtConfig(got?.[WT_STORAGE_KEY]);
    }
  } catch {
    // storage unavailable → fail closed
  }
  return { enabled: false };
}

/**
 * Create the presence client. Returns synchronously with an inert handle; connection
 * work (config resolution, dial, read loop) runs asynchronously in the background and
 * reports via `onState` / `onDatagram`. NEVER throws.
 *
 * If `opts.config` is supplied, the feature-detect gate is evaluated SYNCHRONOUSLY so
 * an off/unsupported client is inert (state "unavailable") before this returns — the
 * property the structural tests assert.
 */
export function createWtPresenceClient(
  opts: WtPresenceClientOptions = {},
): WtPresenceClient {
  let state: WtClientState = "idle";
  let detail = "";
  let closed = false;

  let transport: WebTransport | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  // Stats accumulators.
  let count = 0;
  let lastSeq: number | null = null;
  let gaps = 0;
  let lastValue: number | null = null;
  let lastTMs: number | null = null;
  const history: number[] = [];
  const arrivals: number[] = []; // wall-clock arrival times (ms) for Hz

  const setState = (next: WtClientState, why = "") => {
    state = next;
    detail = why;
    try {
      opts.onState?.(next, why);
    } catch {
      // a handler must never break the client
    }
  };

  const now = (): number =>
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  const measuredHz = (): number => {
    if (arrivals.length < 2) return 0;
    const span = arrivals[arrivals.length - 1] - arrivals[0];
    if (span <= 0) return 0;
    return ((arrivals.length - 1) / span) * 1000;
  };

  const record = (d: PresenceDatagram) => {
    count++;
    if (lastSeq != null && d.seq > lastSeq + 1) gaps += d.seq - lastSeq - 1;
    lastSeq = d.seq;
    lastValue = d.value;
    lastTMs = d.t_ms;
    history.push(d.value);
    if (history.length > HISTORY_CAP) history.shift();
    arrivals.push(now());
    if (arrivals.length > HZ_WINDOW) arrivals.shift();
    try {
      opts.onDatagram?.(d);
    } catch {
      // handler errors are contained
    }
  };

  /** Build WebTransportOptions, wiring serverCertificateHashes when a hash is configured. */
  const buildTransportOptions = (
    cfg: WtFeatureConfig,
  ): { options: WebTransportOptions; note: string } => {
    if (!cfg.certHash) return { options: {}, note: "" };
    const buf = parseCertHash(cfg.certHash);
    if (!buf) {
      return { options: {}, note: "certHash could not be decoded (hex/base64)" };
    }
    // Browsers require the hashed cert to be ECDSA and ≤14 days validity. The kernel's
    // ephemeral dev cert is ECDSA P-256 (compatible) but its hash CHANGES each restart
    // — see the operational caveat in docs/phase5-data-plane.md.
    const note =
      buf.byteLength !== 32
        ? `certHash decoded to ${buf.byteLength} bytes (expected 32 for SHA-256)`
        : "";
    return {
      options: {
        serverCertificateHashes: [{ algorithm: "sha-256", value: buf }],
      },
      note,
    };
  };

  const teardown = () => {
    if (reader) {
      try {
        void reader.cancel();
      } catch {
        // already released
      }
      reader = null;
    }
    if (transport) {
      try {
        transport.close();
      } catch {
        // already closing
      }
      transport = null;
    }
  };

  /** The datagram read loop. Each chunk is a Uint8Array; malformed frames are dropped. */
  const pump = async (rdr: ReadableStreamDefaultReader<Uint8Array>) => {
    for (;;) {
      let res: ReadableStreamReadResult<Uint8Array>;
      try {
        res = await rdr.read();
      } catch {
        // stream errored (session lost) — treat as a clean stop, strip hides.
        if (!closed) setState("error", "datagram stream errored");
        return;
      }
      if (res.done) {
        if (!closed) setState("closed", "datagram stream ended");
        return;
      }
      const frame = parsePresenceDatagram(res.value);
      if (frame) record(frame); // malformed/partial frames are silently dropped
    }
  };

  const connect = async (cfg: WtFeatureConfig) => {
    const gate = evaluateWtGate(cfg);
    if (!gate.available) {
      setState("unavailable", gate.reason);
      return;
    }
    const url = cfg.url && cfg.url.length > 0 ? cfg.url : DEFAULT_WT_URL;
    const { options, note } = buildTransportOptions(cfg);

    setState("connecting", note ? `connecting (${note})` : `connecting to ${url}`);

    let wt: WebTransport;
    try {
      wt = new WebTransport(url, options);
    } catch (err) {
      setState("error", `WebTransport construction failed: ${errMsg(err)}`);
      return;
    }
    transport = wt;

    // If the session closes/errors on its own, reflect it (unless we closed first).
    void wt.closed
      .then(() => {
        if (!closed) setState("closed", "session closed by server");
      })
      .catch((err: unknown) => {
        if (!closed) setState("error", `session error: ${errMsg(err)}`);
      });

    try {
      await wt.ready;
    } catch (err) {
      // The self-signed-cert failure (no/!matching certHash) lands here.
      if (!closed) setState("error", `connect rejected: ${errMsg(err)}`);
      teardown();
      return;
    }
    if (closed) {
      teardown();
      return;
    }

    setState("connected", "receiving synthetic presence datagrams");
    try {
      reader = wt.datagrams.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    } catch (err) {
      if (!closed) setState("error", `datagram reader unavailable: ${errMsg(err)}`);
      teardown();
      return;
    }
    await pump(reader);
  };

  // Kick off. If config was supplied, evaluate the gate SYNCHRONOUSLY so an inert
  // client is already "unavailable" before this factory returns (structural-test hook).
  if (opts.config) {
    const cfg = opts.config;
    const gate = evaluateWtGate(cfg);
    if (!gate.available) {
      setState("unavailable", gate.reason);
    } else {
      void connect(cfg);
    }
  } else {
    void resolveWtConfig().then((cfg) => {
      if (closed) return;
      void connect(cfg);
    });
  }

  return {
    close() {
      if (closed) return;
      closed = true;
      teardown();
      if (state !== "unavailable" && state !== "error") {
        setState("closed", "client closed");
      }
    },
    getState() {
      return state;
    },
    stats(): WtStats {
      return {
        state,
        count,
        lastSeq,
        gaps,
        hz: measuredHz(),
        lastValue,
        lastTMs,
        history: history.slice(),
        detail,
      };
    },
  };
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
