/**
 * Collider Pilot - provenance header (collapsible in Phase 6)
 * ==========================================================
 * The header Steinberger requires: a frame must visibly state where it came from.
 * Renders source engine, log sequence + t_day, workspace/session, purpose, and the
 * view_filter. The MOCK badge makes the read-only, no-engine status unmissable.
 *
 * Phase 6: it now DEFAULTS COLLAPSED to a one-line summary (engine short · log_seq·T-day
 * · LIVE/MOCK badge) to reclaim vertical space on a narrow panel; a click expands the
 * full grid + view_filter. The collapsed summary still carries the load-bearing
 * provenance signals (source + position + live/mock), so nothing safety-relevant hides.
 */

import { useState } from "react";
import type { FrameProvenance } from "../mcp/types";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="prov-field">
      <span className="prov-label">{label}</span>
      <span className="prov-value" title={value}>
        {value}
      </span>
    </div>
  );
}

/** Short engine label: the last urn segment (e.g. "hp-z440.primary"), guarded. */
function engineShort(engine: string): string {
  if (typeof engine !== "string" || engine.length === 0) return "unknown engine";
  return engine.split(":").pop() || engine;
}

export function ProvenanceHeader({
  provenance,
  defaultCollapsed = true,
}: {
  provenance: FrameProvenance;
  /** Start collapsed to a one-line summary (default true). */
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  // Defensive: any of these may be absent on a live/partial frame. A missing
  // sub-field must never blank the whole panel.
  const vf = provenance.view_filter ?? {};
  const vfTypes = Array.isArray(vf.types) ? vf.types : [];
  const vfScope = Array.isArray(vf.scope_urns) ? vf.scope_urns : [];

  const badge = provenance.mock ? (
    <span className="prov-badge mock">MOCK</span>
  ) : (
    <span className="prov-badge live">LIVE</span>
  );

  return (
    <section className="provenance" aria-label="Frame provenance">
      <button
        type="button"
        className="prov-top prov-toggle"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? "Expand frame provenance" : "Collapse frame provenance"}
      >
        <span className="prov-caret" aria-hidden="true">
          {collapsed ? "▸" : "▾"}
        </span>
        <span className="prov-title">Frame provenance</span>
        {collapsed && (
          <span className="prov-summary" title={provenance.engine}>
            {engineShort(provenance.engine)} · seq {provenance.log_seq} · T=
            {provenance.t_day}
          </span>
        )}
        {badge}
        <span className="prov-badge readonly">READ-ONLY</span>
      </button>

      {!collapsed && (
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
