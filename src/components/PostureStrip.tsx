/**
 * Collider Pilot - posture strip (t263 UX eval, item 1; supersedes ProvenanceHeader)
 * ==================================================================================
 * The Steinberger provenance requirement, compressed to ONE line: a frame must visibly
 * state where it came from, but the full key-value wall cost too much vertical space on a
 * narrow panel. The strip carries the load-bearing posture signals inline —
 *
 *   LIVE/MOCK · READ-ONLY · ACCESS tier · user · workspace · seq · T-day · ontology
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
}: {
  provenance: FrameProvenance;
  /** Live fold-stream status; "off" when this surface holds no stream (PiP, previews). */
  streamStatus?: StreamStatus;
  pulseKey?: number;
  /** Start with the audit drawer open (default false — the strip is the point). */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Defensive: any of these may be absent on a live/partial frame. A missing
  // sub-field must never blank the whole panel.
  const vf = provenance.view_filter ?? {};
  const vfTypes = Array.isArray(vf.types) ? vf.types : [];
  const vfScope = Array.isArray(vf.scope_urns) ? vf.scope_urns : [];

  const reconnecting = streamStatus === "reconnecting";
  const streaming = streamStatus === "live" || reconnecting;
  const liveBadge = provenance.mock ? (
    <span className="prov-badge mock" title="Fixture data — not a live engine read.">
      MOCK
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

  const stripUser = effectiveAnon ? "anon" : urnShort(access?.scope?.user, "anon");

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
        <span className="prov-summary" title={`${access?.scope?.user ?? "anon"} · ${provenance.workspace}`}>
          {stripUser} · {urnShort(provenance.workspace)} · seq {provenance.log_seq} · T=
          {provenance.t_day} · {provenance.ontology_version}
        </span>
        <span className="prov-audit-toggle" aria-hidden="true">
          audit {open ? "▾" : "▸"}
        </span>
      </button>

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
            <Field label="endpoint" value={provenance.engine_endpoint} />
            <Field
              label="log_seq · t_day"
              value={`${provenance.log_seq} · T=${provenance.t_day}`}
            />
            <Field label="ontology" value={provenance.ontology_version} />
            <Field label="workspace" value={provenance.workspace} />
            <Field label="purpose" value={provenance.purpose} />
            <Field label="folded_at" value={provenance.folded_at} />
          </div>
          <div className="prov-filter">
            <span className="prov-label">view_filter</span>
            <div className="prov-filter-body">
              <div>
                <span className="prov-k">t</span> {vf.t ?? "—"}
              </div>
              <div>
                <span className="prov-k">types</span> {vfTypes.join(", ")}
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
