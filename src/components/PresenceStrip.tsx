/**
 * Collider Pilot - P9 WebTransport SPIKE: presence strip (panel-only, READ-ONLY)
 * =============================================================================
 * A compact live readout of the kernel's SYNTHETIC WebTransport presence datagrams,
 * rendered UNDER the graph. It is:
 *   - HIDDEN ENTIRELY when the `pilot.wt` flag is off / WebTransport is unavailable /
 *     the connection fails (the hook returns `available:false`) — graceful, no throw.
 *   - Clearly labelled "WebTransport spike (synthetic)" so it is never mistaken for
 *     real HG data. The value is fabricated (0.5 + 0.5·sin(seq/10)) — see the kernel
 *     spike (moos-kernel #59). It carries NO HG state.
 *
 * It shows: the current `value` as a tiny sparkline + bar, the latest `seq`, the
 * measured arrival rate (Hz, from datagram deltas), and the inferred gap count.
 *
 * READ-ONLY: driven solely by received datagrams; nothing here writes to the HG.
 */

import { useWtPresence } from "../state/use-wt-presence";

/** Build an SVG polyline `points` string for the recent-values sparkline. */
function sparklinePoints(history: number[], w: number, h: number): string {
  if (history.length === 0) return "";
  if (history.length === 1) {
    const y = h - history[0] * h;
    return `0,${y.toFixed(1)} ${w},${y.toFixed(1)}`;
  }
  const step = w / (history.length - 1);
  return history
    .map((v, i) => {
      const x = i * step;
      const y = h - Math.max(0, Math.min(1, v)) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function PresenceStrip() {
  const { available, state, stats } = useWtPresence();

  // Hidden entirely when the spike is off / unavailable / failed.
  if (!available) return null;

  const value = stats.lastValue ?? 0;
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const hz = stats.hz > 0 ? stats.hz.toFixed(1) : "—";
  const connecting = state === "connecting";

  return (
    <section
      className="wt-strip"
      aria-label="WebTransport presence spike (synthetic)"
      title="Synthetic presence datagrams over WebTransport (HTTP/3). Spike only — proves the pipe; not a real surface."
    >
      <div className="wt-strip-head">
        <span className="wt-badge">
          <span className={`wt-dot ${connecting ? "connecting" : "connected"}`} />
          WebTransport spike
        </span>
        <span className="wt-synth">synthetic</span>
      </div>

      {connecting ? (
        <div className="wt-strip-connecting">connecting to datagram endpoint…</div>
      ) : (
        <div className="wt-strip-body">
          <svg
            className="wt-spark"
            viewBox="0 0 100 24"
            preserveAspectRatio="none"
            role="img"
            aria-label="recent synthetic presence values"
          >
            <polyline points={sparklinePoints(stats.history, 100, 24)} />
          </svg>
          <div className="wt-bar-wrap" title={`value ${value.toFixed(3)}`}>
            <div className="wt-bar" style={{ width: `${pct}%` }} />
          </div>
          <dl className="wt-metrics">
            <div>
              <dt>value</dt>
              <dd>{value.toFixed(3)}</dd>
            </div>
            <div>
              <dt>seq</dt>
              <dd>{stats.lastSeq ?? "—"}</dd>
            </div>
            <div>
              <dt>Hz</dt>
              <dd>{hz}</dd>
            </div>
            <div>
              <dt>gaps</dt>
              <dd>{stats.gaps}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
