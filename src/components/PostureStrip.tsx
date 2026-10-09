/**
 * Collider Pilot - posture strip (t263 UX eval, item 1; supersedes ProvenanceHeader)
 * ==================================================================================
 * The Steinberger provenance requirement, compressed to ONE line: a frame must visibly
 * state where it came from, but the full key-value wall cost too much vertical space on a
 * narrow panel. The strip carries the load-bearing posture signals inline —
 *
 *   LIVE/MOCK · READ-ONLY · ACCESS tier · user · workspace · in-frame/fold · access −N ·
 *   engine · seq · T-day · ontology
 *
 * (t342: on a narrow panel the summary takes its own line under the badges, and the counts in
 * it never shrink — the tail after them is what an ellipsis cuts.)
 *
 * — and an expandable AUDIT drawer holds the complete key-value block (access resolution,
 * engine/endpoint/purpose/folded_at grid, view_filter echo) for when provenance must be
 * read in full. Nothing safety-relevant hides: every badge that used to render is still on
 * the strip, now in exactly ONE place (the header duplicates were removed — item 1 dedupe).
 *
 * The LIVE badge doubles as the stream indicator: when the panel is subscribed to the
 * kernel fold stream, the badge carries the pulse dot and flips to RECONNECTING while the
 * stream is down — one LIVE signal instead of two.
 *
 * Insider strings (tier names, workspace_path values, the widened/failed-closed honesty
 * notes) stay VERBATIM — they are part of the audit surface — but every one now carries a
 * glossary tooltip (t263 item 7).
 */

import { useState } from "react";
import type { FrameProvenance } from "../mcp/types";
import type { AccessPosture } from "../state/prefs";
import type { StreamStatus } from "../state/use-fold-stream";
import { glossaryTitle } from "../ui/glossary";

function Field({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="prov-field">
      <span className="prov-label">{label}</span>
      <span className="prov-value" title={title ?? value}>
        {value}
      </span>
    </div>
  );
}

/** Last urn segment (e.g. "hp-z440.primary"), guarded for non-string/empty input. */
function urnShort(urn: unknown, fallback = "—"): string {
  if (typeof urn !== "string" || urn.length === 0) return fallback;
  return urn.split(":").pop() || urn;
}

export function PostureStrip({
  provenance,
  streamStatus = "off",
  pulseKey = 0,
  defaultOpen = false,
  stale = false,
  cached = false,
  requestedMode,
}: {
  provenance: FrameProvenance;
  /** Live fold-stream status; "off" when this surface holds no stream (PiP, previews). */
  streamStatus?: StreamStatus;
  pulseKey?: number;
  /** Start with the audit drawer open (default false — the strip is the point). */
  defaultOpen?: boolean;
  /**
   * The last read FAILED and this frame is the previous good one. The badge must stop
   * saying LIVE: the strip's whole job is to state what is true now, and a frame kept
   * after a failed refresh is not current — its seq/T-day may be behind the engine.
   */
  stale?: boolean;
  /**
   * t342: this frame was restored from the panel's session scratch and the opening read has
   * not landed yet. It was read under an earlier slice (a narrower lens, a focus), so the
   * badge must not say LIVE over it, and it names the lens it was read under.
   */
  cached?: boolean;
  /**
   * t342: the posture this surface ASKED for (the "Bring me in" toggle). A requested
   * "identified" that resolved to anon means no identity is stored — the strip then points
   * at Settings instead of at a toggle that is already on. Absent where the surface holds no
   * toggle (PiP, fixture previews).
   */
  requestedMode?: AccessPosture;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Defensive: any of these may be absent on a live/partial frame. A missing
  // sub-field must never blank the whole panel.
  const vf = provenance.view_filter ?? {};
  const vfTypes = Array.isArray(vf.types) ? vf.types : [];
  const vfScope = Array.isArray(vf.scope_urns) ? vf.scope_urns : [];
  // t342: the slice this frame was read under, for the CACHED / STALE titles — the lens row
  // above may already name another one.
  const readUnder = `read under the ${vf.lens ?? "custom"} lens${vfScope.length > 0 ? " with a focus" : ""}`;

  const reconnecting = streamStatus === "reconnecting";
  const streaming = streamStatus === "live" || reconnecting;
  const liveBadge = provenance.mock ? (
    <span className="prov-badge mock" title="Fixture data — not a live engine read.">
      MOCK
    </span>
  ) : stale ? (
    <span
      className="prov-badge stale"
      title={`The last read FAILED — this is the previous good frame (${readUnder}). Its seq and T-day may be behind the engine; do not read it as current.`}
    >
      STALE
    </span>
  ) : cached ? (
    <span
      className="prov-badge stale"
      title={`Restored from this panel's session, ${readUnder} — the opening read replaces it. Do not read it as current.`}
    >
      CACHED
    </span>
  ) : (
    <span
      className={`prov-badge live${reconnecting ? " reconnecting" : ""}`}
      title={
        reconnecting
          ? "Stream dropped — reconnecting with backoff"
          : streaming
            ? "Live engine read · subscribed to the kernel fold stream"
            : "Live engine read"
      }
    >
      {streaming && <span key={pulseKey} className="live-dot" />}
      {reconnecting ? "RECONNECTING" : "LIVE"}
    </span>
  );

  // ACCESS (A3). The tier badge is verbatim + load-bearing: it names which tier is
  // authoritative so the client-presentation posture is NEVER socially misread as
  // enforcement. `enforced` is gated ONLY on provably-server-computed provenance
  // (`computed_by === "server-authoritative"`), NEVER on the config's intent flag.
  const access = provenance.access;
  const enforced = access?.computed_by === "server-authoritative";
  // Verbatim strings — do not reword. "ACCESS: PRESENTATION" (client) vs "ACCESS: ENFORCED".
  const tierText = enforced ? "ACCESS: ENFORCED" : "ACCESS: PRESENTATION";
  const effectiveAnon =
    !access ||
    access.scope?.identity_source !== "trusted-storage" ||
    access.scope?.mode !== "identified";
  const permittedCount = Array.isArray(access?.permitted_workspaces)
    ? access.permitted_workspaces.length
    : 0;
  const roleTopoCount = Array.isArray(access?.role_topology)
    ? access.role_topology.length
    : 0;
  const accessBadge = access ? (
    <span
      className={`prov-badge access-tier ${enforced ? "enforced" : "presentation"}`}
      title={glossaryTitle(access.computed_by)}
    >
      {tierText}
    </span>
  ) : null;

  // t342: a stored identity that is not a user urn (a bare "sam") governs nothing and owns
  // no session, so the permitted set collapses to the public workspaces (the frame keeps
  // those and the unattributed nodes) — yet its tail read exactly like `urn:moos:user:sam`. Show it as it is instead of shortening the difference away.
  const scopeUser = access?.scope?.user;
  const userIsUrn = typeof scopeUser === "string" && /^urn:moos:user:\S+$/.test(scopeUser);
  const stripUser = effectiveAnon
    ? "anon"
    : userIsUrn
      ? urnShort(scopeUser, "anon")
      : `"${String(scopeUser ?? "")}" (not a user urn)`;

  // t342: with no focus the frame is the whole permitted fold, and `provenance.workspace`
  // holds only the transform's fallback anchor (DEFAULT_SCOPE_URN, the Z440 Cowork seat).
  // The strip printed that anchor as if the view were scoped to it. Under anon the permitted
  // fold is the public workspaces only, and the strip says that instead.
  const focused = vfScope.length > 0;
  const publicOnly = !!access && effectiveAnon;
  const whereText = focused
    ? urnShort(provenance.workspace)
    : publicOnly
      ? "public only"
      : "all permitted";
  const whereTitle = focused
    ? provenance.workspace
    : publicOnly
      ? "no focus — the anon posture draws the public workspaces only"
      : `no focus — the whole permitted fold (anchor ${provenance.workspace})`;

  // t342 HONEST COUNTS: how much of the fold is in this frame and, apart from that, how much
  // the access posture alone left out (provenance.fold_counts) — "444/447 · access −3". What
  // the lens, focus and t narrow is a choice and is never counted as access. "In the frame" is
  // not "on the canvas": the graph's legend and `unlinked` chip can hide more. Not protection
  // — the sentence below follows the tier badge.
  const counts = provenance.fold_counts;
  const narrowed = counts
    ? {
        nodes: counts.total - counts.withheld_by_access - counts.in_frame,
        relations:
          counts.relations.total - counts.relations.withheld_by_access - counts.relations.in_frame,
      }
    : null;
  const countsTitle =
    counts && narrowed
      ? `${counts.in_frame} of ${counts.total} nodes and ${counts.relations.in_frame} of ` +
        `${counts.relations.total} relations are in this frame.` +
        (access
          ? ` Left out by the access posture alone: ${counts.withheld_by_access} nodes, ` +
            `${counts.relations.withheld_by_access} relations.`
          : "") +
        ` Left out by the lens, focus or t: ${narrowed.nodes} nodes, ${narrowed.relations} relations.` +
        " The graph's legend and its unlinked chip can hide more on the canvas; that is not counted here. " +
        (enforced
          ? `${tierText} — the counts say what is in the frame, not what is protected.`
          : `${tierText} — the whole fold reached this browser (in the extension, its worker); ` +
            "the counts say what is in the frame, not what is protected.")
      : undefined;

  // t342: under anon the strip points at the way in — or, when "Bring me in" is already on
  // and resolved to anon anyway, at the missing identity (the worker fails closed to the same
  // anon scope either way, so only the surface's own request tells the two apart).
  const identityMissing = publicOnly && requestedMode === "identified";

  // t342: the engine this frame was READ from (what it reports on /healthz, else the surface's
  // label) — the kb extension reads scratch-kb while main reads primary.
  const engineRead = provenance.engine_reported ?? provenance.engine;

  // A16 ENGINE MISMATCH: `engine` is what this surface RESOLVES TO (its label);
  // `engine_reported` is what the connected engine SAYS it is (/healthz kernel_urn).
  // They disagree when a surface's engine is unreachable from this seat (the read fell
  // back to the default) or when an endpoint serves a different kernel than the channel
  // names — both are exactly the wrong-fold defect, so the strip must say so.
  const reported = provenance.engine_reported;
  const engineMismatch =
    typeof reported === "string" && reported.length > 0 && reported !== provenance.engine;

  return (
    <section className="provenance posture-strip" aria-label="Frame posture">
      <button
        type="button"
        className="prov-top prov-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={open ? "Collapse the provenance audit drawer" : "Expand the full provenance audit drawer"}
      >
        {liveBadge}
        <span
          className="prov-badge readonly"
          title="No write path exists: mutating acts are confirmation-gated; HG rewrites are review-only previews that are never posted."
        >
          READ-ONLY
        </span>
        {accessBadge}
        {/* t342: three parts — who/where, the counts (never shrink), the rest (what room is left).
            The separators are no-break spaces: a flex item drops plain leading spaces. */}
        <span className="prov-summary">
          <span
            className="prov-who"
            title={
              `${access?.scope?.user ?? "anon"} · ${whereTitle}` +
              (counts ? ` · ${counts.in_frame}/${counts.total} nodes in frame` : "")
            }
          >
            {stripUser} · {whereText}
          </span>
          {(counts || publicOnly) && (
            <span className="prov-counts">
              {counts && (
                <span title={countsTitle}>
                  {"\u00a0"}· {counts.in_frame}/{counts.total}
                  {!publicOnly && counts.withheld_by_access > 0 && ` · access −${counts.withheld_by_access}`}
                </span>
              )}
              {identityMissing ? (
                <span title={'"Bring me in" is on, but no identity is stored, so the posture failed closed to anon. Set a user urn in Settings.'}>
                  {"\u00a0"}· no identity — Settings
                </span>
              ) : (
                publicOnly && (
                  <span title="Bring me in (the access toggle in the panel) draws the workspaces the identity saved in Settings permits.">
                    {"\u00a0"}· Bring me in
                  </span>
                )
              )}
            </span>
          )}
          <span
            className="prov-rest"
            title={`engine read: ${engineRead} · log_seq ${provenance.log_seq} · T=${provenance.t_day} · ontology ${provenance.ontology_version}`}
          >
            {"\u00a0"}· {urnShort(engineRead)} · seq {provenance.log_seq} · T={provenance.t_day} ·{" "}
            {provenance.ontology_version}
          </span>
        </span>
        <span className="prov-audit-toggle" aria-hidden="true">
          audit {open ? "▾" : "▸"}
        </span>
      </button>

      {engineMismatch && (
        <div
          className="prov-engine-mismatch"
          role="alert"
          title="The surface's channel names one engine, but the engine actually read reports a different kernel_urn on /healthz. The frame below comes from the REPORTING engine — do not read it as the labelled one."
        >
          ENGINE MISMATCH — this surface expects{" "}
          <strong>{urnShort(provenance.engine)}</strong>, the connected engine reports{" "}
          <strong>{urnShort(reported)}</strong>
        </div>
      )}

      {open && counts && narrowed && (
        <div className="prov-access" aria-label="Fold counts" title={countsTitle}>
          <div className="prov-access-row">
            <span className="prov-label">counts · in frame / whole fold</span>
            <span className="prov-access-body">
              <span className="prov-k">nodes</span> {counts.in_frame}/{counts.total}
              <span className="prov-k">relations</span> {counts.relations.in_frame}/
              {counts.relations.total}
              {access && (
                <>
                  <span className="prov-k">access</span> −{counts.withheld_by_access} nodes · −
                  {counts.relations.withheld_by_access} relations
                </>
              )}
              <span className="prov-k">lens·focus·t</span> −{narrowed.nodes} nodes · −
              {narrowed.relations} relations
            </span>
          </div>
        </div>
      )}

      {open && access && (
        <div className="prov-access" aria-label="Access resolution">
          <div className="prov-access-row">
            <span className="prov-label">access</span>
            <span className="prov-access-body">
              <span className="prov-k">mode</span> {access.scope?.mode ?? "anon"}
              <span className="prov-k">identity</span>{" "}
              <span title={glossaryTitle(access.scope?.identity_source ?? "anon")}>
                {access.scope?.identity_source ?? "anon"}
              </span>
              <span className="prov-k">user</span>{" "}
              <span title={access.scope?.user ?? ""}>
                {(access.scope?.user ?? "—").split(":").pop()}
              </span>
              <span className="prov-k">permitted</span> {permittedCount}
              <span className="prov-k">role_topology</span> {roleTopoCount}
              <span className="prov-k">tier</span>{" "}
              <span title={glossaryTitle(access.computed_by)}>{access.computed_by}</span>
              <span className="prov-k">path</span>{" "}
              <span title={glossaryTitle(access.workspace_path)}>{access.workspace_path}</span>
              <span className="prov-k">ws ∩</span>{" "}
              <span title={glossaryTitle(access.workstation_intersection)}>
                {access.workstation_intersection}
              </span>
            </span>
          </div>
          {permittedCount > 0 && (
            <div className="prov-access-list" title="permitted_workspaces = f(group_topology × user × workstation)">
              <span className="prov-label">permitted_workspaces</span>
              <ul className="prov-scope">
                {access.permitted_workspaces.map((u) => (
                  <li key={u} title={u}>
                    {u.split(":").slice(-1)[0]}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {access.workstation_intersection === "skipped-widened" && access.scope?.workstation && (
            <div className="prov-access-note" title={glossaryTitle("widened, not narrowed")}>
              workstation ∩ skipped — {String(access.scope.workstation).split(":").pop()}{" "}
              (widened, not narrowed)
            </div>
          )}
          {access.workstation_intersection === "failed-closed" && (
            <div className="prov-access-note failclosed" title={glossaryTitle("failed-closed")}>
              workstation binding UNRESOLVED — {String(access.scope?.workstation).split(":").pop()}{" "}
              (FAILED CLOSED · governs-closure dropped)
            </div>
          )}
          {effectiveAnon && permittedCount === 0 && (
            <div className="prov-access-empty">
              ANON — no public workspaces exposed
            </div>
          )}
        </div>
      )}

      {open && (
        <>
          <div className="prov-grid">
            <Field label="engine" value={provenance.engine} />
            <Field
              label="engine (reported)"
              value={reported ?? "—"}
              title="The connected engine's self-reported /healthz kernel_urn (A6). Should equal `engine`; the strip warns when it does not."
            />
            <Field label="endpoint" value={provenance.engine_endpoint} />
            <Field
              label="log_seq · t_day"
              value={`${provenance.log_seq} · T=${provenance.t_day}`}
            />
            <Field label="ontology" value={provenance.ontology_version} />
            <Field label="workspace" value={provenance.workspace} />
            <Field label="purpose" value={provenance.purpose} />
            <Field label="folded_at" value={provenance.folded_at} />
            {/* WHICH BUILD is running — the loaded extension is a copy of dist/, so this
                answers "did my reload take?" without guesswork. */}
            <Field
              label="pilot build"
              value={typeof __PILOT_BUILD__ === "string" ? __PILOT_BUILD__ : "dev"}
              title="The build this panel is running (short git sha + build time). Reload the extension if it is older than your last build."
            />
          </div>
          <div className="prov-filter">
            <span className="prov-label">view_filter</span>
            <div className="prov-filter-body">
              <div>
                <span className="prov-k">t</span> {vf.t ?? "—"}
              </div>
              <div>
                <span className="prov-k">lens</span> {vf.lens ?? "—"}
              </div>
              <div>
                <span className="prov-k">types</span>{" "}
                {vfTypes.length === 0 ? "all" : vfTypes.join(", ")}
              </div>
              <div>
                <span className="prov-k">ports</span>{" "}
                {Array.isArray(vf.ports) && vf.ports.length > 0 ? vf.ports.join(", ") : "all"}
              </div>
              <div>
                <span className="prov-k">hops</span> {vf.scope_hops ?? 1}
              </div>
              <div>
                <span className="prov-k">scope</span>
                <ul className="prov-scope">
                  {vfScope.map((u) => (
                    <li key={u} title={u}>
                      {u}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
