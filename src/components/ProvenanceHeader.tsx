/**
 * Collider Pilot - provenance header
 * ==================================
 * The header Steinberger requires: a frame must visibly state where it came from.
 * Renders source engine, log sequence + t_day, workspace/session, purpose, and the
 * view_filter. The MOCK badge makes the read-only, no-engine status unmissable.
 */

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

export function ProvenanceHeader({ provenance }: { provenance: FrameProvenance }) {
  const vf = provenance.view_filter;
  return (
    <section className="provenance" aria-label="Frame provenance">
      <div className="prov-top">
        <span className="prov-title">Frame provenance</span>
        {provenance.mock ? (
          <span className="prov-badge mock">MOCK</span>
        ) : (
          <span className="prov-badge live">LIVE</span>
        )}
        <span className="prov-badge readonly">READ-ONLY</span>
      </div>
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
            <span className="prov-k">t</span> {vf.t}
          </div>
          <div>
            <span className="prov-k">types</span> {vf.types.join(", ")}
          </div>
          <div>
            <span className="prov-k">scope</span>
            <ul className="prov-scope">
              {vf.scope_urns.map((u) => (
                <li key={u} title={u}>
                  {u}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
