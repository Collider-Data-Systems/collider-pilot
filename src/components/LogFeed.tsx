/**
 * Collider Pilot - live log feed (t264 — "see additions to the engine jsonl")
 * ===========================================================================
 * The append-only log IS the truth (state is derived), so the panel projects it
 * directly: a newest-first tail of persisted rewrites from `GET /log`, kept live by the
 * kernel's `GET /log/stream` SSE (one event per persisted rewrite). This is the surface
 * that answers "what just landed?" — e.g. an applied program's envelopes arriving as
 * seq 612‥640 — without leaving the panel.
 *
 * READ-ONLY: two GETs (the tail fetch + the EventSource). No POST path exists here; the
 * feed renders what the engine already persisted and never composes an envelope.
 * LIVE-ONLY: the mock adapter has no log; the section self-hides on mock frames.
 *
 * ACCESS (presentation-tier consistency): /log returns the raw log — the kernel does no
 * per-user filtering on reads (that is the ruled-but-unbuilt server-side enforcement).
 * The panel's client-presentation posture must not leak through this side door: under an
 * effective-anon frame the feed renders a "bring yourself in" note and does NOT fetch or
 * subscribe at all — the same what-is-RENDERED discipline the graph follows. Honesty
 * caveat unchanged: this is presentation, not a security boundary — any local process
 * (or this browser, outside the panel) can still call the open read endpoint directly;
 * only server-side enforcement closes that.
 *
 * Clicking an entry selects its subject node when the current frame renders it (the
 * shared scratch mirrors the selection to the PiP / pop-out / full-tab). Entries whose
 * subject is outside the current slice still render — the log is the log — with a
 * "not in slice" affordance instead of a selectable link.
 */

import { useCallback, useEffect, useState } from "react";
import type { HgFrame } from "../mcp/types";
import { DEFAULT_ENGINE_URL } from "../mcp/transform.js";

/** One persisted rewrite as GET /log and GET /log/stream deliver it. */
interface LogEntry {
  log_seq: number;
  applied_at?: string;
  timestamp?: string;
  envelope?: {
    rewrite_type?: string;
    rewrite_category?: string;
    actor?: string;
    node_urn?: string;
    relation_urn?: string;
    target_urn?: string;
    src_urn?: string;
    tgt_urn?: string;
    src_port?: string;
    type_id?: string;
    field?: string;
  };
}

/** Newest-first cap — enough to show a whole applied batch without unbounded growth. */
export const LOG_FEED_CAP = 200;

const REWRITE_KINDS = ["ADD", "LINK", "MUTATE", "UNLINK"] as const;
type KindFilter = "all" | (typeof REWRITE_KINDS)[number];

/** The urn an entry is ABOUT (selection target), in preference order. */
function subjectUrn(e: LogEntry): string | null {
  const env = e.envelope ?? {};
  return env.node_urn ?? env.target_urn ?? env.src_urn ?? env.relation_urn ?? null;
}

/** Short human line for the entry's subject. */
function subjectLabel(e: LogEntry): string {
  const env = e.envelope ?? {};
  const short = (u?: string) => (u ? u.split(":").pop() || u : "?");
  if (env.node_urn) return `${env.type_id ?? "node"} ${short(env.node_urn)}`;
  if (env.src_urn || env.tgt_urn) {
    const port = env.src_port ? ` ${env.src_port} ` : " → ";
    return `${short(env.src_urn)}${port}${short(env.tgt_urn)}`;
  }
  if (env.target_urn) {
    return `${short(env.target_urn)}${env.field ? ` .${env.field}` : ""}`;
  }
  if (env.relation_urn) return `rel ${short(env.relation_urn)}`;
  return "(no subject)";
}

function timeLabel(e: LogEntry): string {
  const iso = e.applied_at ?? e.timestamp ?? "";
  const m = iso.match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : iso.slice(0, 19);
}

export interface LogFeedProps {
  /** Only a live frame has a log behind it; the feed self-hides otherwise. */
  live: boolean;
  frame: HgFrame | null;
  /**
   * The panel's CHOSEN posture. The stream's lifetime keys on this, not (only) on the
   * frame's provenance: "Stay anon" must close the stream immediately, even when the
   * posture-flip frame reload fails and the old identified frame stays mounted
   * (t264 review major — the gate was keyed to the stale frame).
   */
  accessMode: "anon" | "identified";
  onSelect: (urn: string | null) => void;
  /** Engine REST base (host-permitted; the SSE precedent). Default :8000. */
  engineUrl?: string;
}

export function LogFeed({
  live,
  frame,
  accessMode,
  onSelect,
  engineUrl = DEFAULT_ENGINE_URL,
}: LogFeedProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "stream-down" | "error">("loading");
  const [kind, setKind] = useState<KindFilter>("all");
  const [open, setOpen] = useState(true);

  // Effective-anon MIRRORS the PostureStrip predicate exactly, including the
  // fail-CLOSED missing-fiber case (t264 review major: `!!access && (...)` inverted
  // it): no access fiber ⇒ anon. The chosen posture composes on top — either signal
  // reading anon closes the feed.
  const access = frame?.provenance?.access;
  const frameAnon =
    !access ||
    access.scope?.identity_source !== "trusted-storage" ||
    access.scope?.mode !== "identified";
  const effectiveAnon = accessMode !== "identified" || frameAnon;

  // Pure, idempotent merge — no ref mutation inside the updater (t264 review major:
  // a ref-marking updater loses entries when React replays it). Dedupe by log_seq via
  // a Map; newest first; cap.
  const push = useCallback((incoming: LogEntry[]) => {
    setEntries((prev) => {
      const bySeq = new Map(prev.map((e) => [e.log_seq, e]));
      for (const e of incoming) {
        if (typeof e?.log_seq !== "number") continue;
        bySeq.set(e.log_seq, e);
      }
      return [...bySeq.values()].sort((a, b) => b.log_seq - a.log_seq).slice(0, LOG_FEED_CAP);
    });
  }, []);

  // SSE subscription, only while live AND identity-backed (the anon posture neither
  // renders nor even requests the log).
  //
  // The tail is fetched IMMEDIATELY, not from `onopen`: the kernel's handleLogStream
  // writes no bytes until the first rewrite arrives, so Go buffers the response head
  // and `onopen` does not fire on a quiet log — an onopen-only tail leaves the feed
  // stuck on "loading" until someone happens to write. `onopen` still fires on a
  // RECONNECT (the reconnect follows a completed prior response), so it re-fetches
  // then to backfill the missed window — guarded so the initial connect, if it does
  // fire, never double-fetches.
  useEffect(() => {
    if (!live || effectiveAnon) return;
    let cancelled = false;
    let opened = false;
    setEntries([]);
    setStatus("loading");

    const fetchTail = async () => {
      try {
        const res = await fetch(`${engineUrl}/log`);
        if (!res.ok) throw new Error(`GET /log -> HTTP ${res.status}`);
        const all = (await res.json()) as LogEntry[];
        if (cancelled || !Array.isArray(all)) return;
        push(all.slice(-LOG_FEED_CAP));
        setStatus("ok");
      } catch {
        if (!cancelled) setStatus("error");
      }
    };

    void fetchTail(); // the initial tail — never gated on a head-flush that may not come
    const es = new EventSource(`${engineUrl}/log/stream`);
    es.onopen = () => {
      if (cancelled) return;
      setStatus("ok");
      if (opened) void fetchTail(); // reconnect ⇒ backfill the missed window
      opened = true;
    };
    es.onmessage = (ev) => {
      if (cancelled) return;
      try {
        const e = JSON.parse(ev.data) as LogEntry;
        push([e]);
      } catch {
        // a malformed event never breaks the feed
      }
    };
    es.onerror = () => {
      if (!cancelled) setStatus("stream-down");
    };
    return () => {
      cancelled = true;
      es.close();
    };
  }, [live, effectiveAnon, engineUrl, push]);

  if (!live) return null;

  if (effectiveAnon) {
    return (
      <details className="log-feed" open>
        <summary className="log-feed-summary">
          <span className="gc-label">log</span>
          <span className="log-feed-state">hidden under anon posture</span>
        </summary>
        <div className="log-empty">
          the raw log is identity-scoped at this tier — "Bring me in" to render it
        </div>
      </details>
    );
  }

  const frameUrns = new Set((frame?.nodes ?? []).map((n) => n.urn));
  const shown = kind === "all" ? entries : entries.filter((e) => e.envelope?.rewrite_type === kind);
  const headSeq = entries.length > 0 ? entries[0].log_seq : null;

  return (
    <details
      className="log-feed"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="log-feed-summary">
        <span className="gc-label">log</span>
        <span className="log-feed-state">
          {headSeq !== null ? `seq ${headSeq}` : "—"} ·{" "}
          {status === "ok"
            ? "live"
            : status === "stream-down"
              ? "stream reconnecting"
              : status}
        </span>
        <span className="log-feed-kinds" role="group" aria-label="Rewrite kind filter">
          {(["all", ...REWRITE_KINDS] as KindFilter[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`log-kind-btn ${kind === k ? "is-on" : ""} k-${k.toLowerCase()}`}
              aria-pressed={kind === k}
              onClick={(ev) => {
                ev.preventDefault(); // keep the <summary> from toggling
                setKind(k);
              }}
            >
              {k}
            </button>
          ))}
        </span>
      </summary>
      {/* Render-tier honesty (t264 review major, accepted limitation): the log is the
          WHOLE engine history — the per-workspace access presentation that narrows the
          graph does not narrow the log at this tier. Single-user seat today; per-slice
          log filtering is the ruled server-side-enforcement lane (pre-second-user). */}
      <div className="log-caveat">
        whole-engine log — workspace-level access presentation does not narrow it (server-side slice filtering is the ruled follow-up)
      </div>
      <ol className="log-entries" aria-label="Persisted rewrites, newest first">
        {shown.map((e) => {
          const urn = subjectUrn(e);
          const inFrame = urn !== null && frameUrns.has(urn);
          return (
            <li key={e.log_seq} className="log-entry">
              <span className="log-seq">{e.log_seq}</span>
              <span className={`log-kind k-${(e.envelope?.rewrite_type ?? "?").toLowerCase()}`}>
                {e.envelope?.rewrite_type ?? "?"}
              </span>
              <span className="log-wf" title={e.envelope?.rewrite_category}>
                {e.envelope?.rewrite_category ?? ""}
              </span>
              {inFrame ? (
                <button
                  type="button"
                  className="log-subject is-link"
                  title={`${urn} — select it (mirrors follow)`}
                  onClick={() => onSelect(urn)}
                >
                  {subjectLabel(e)}
                </button>
              ) : (
                <span
                  className="log-subject"
                  title={urn ? `${urn} — not in the current slice` : undefined}
                >
                  {subjectLabel(e)}
                </span>
              )}
              <span className="log-actor" title={e.envelope?.actor}>
                {(e.envelope?.actor ?? "").split(":").pop()}
              </span>
              <span className="log-time">{timeLabel(e)}</span>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="log-empty">
            {status === "error" ? "log unreachable (kernel down?)" : "no entries"}
          </li>
        )}
      </ol>
    </details>
  );
}
