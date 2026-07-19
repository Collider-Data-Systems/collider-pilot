/**
 * Collider Pilot - fixed mock HG frame
 * ====================================
 * A realistic, fully-typed frame drawn from the real Cowork seat model so the shell
 * exercises the provenance header + inspector against representative data:
 *
 *   engine   urn:moos:kernel:hp-z440.primary        (:8000 HTTP / :8080 MCP)
 *   session  urn:moos:session:sam.z440-cowork-workspace
 *   purpose  urn:moos:purpose:sam.cowork-workspace-curation
 *
 * Nodes are the kind of t259/t260 curation artifacts that seat actually holds:
 * two knowledge_items, two derivations (the t259 access-law + symmetries staging,
 * apply held at gate 2), plus the purpose and session anchors. Relations use real
 * rewrite_category / relation kinds (WF12 provides-kb, cites, depends-on, curates).
 *
 * This is DATA, not a live read. `provenance.mock === true` and `folded_at` is a
 * fixed timestamp — nothing here connects to any engine, endpoint, or credential.
 */

import type { HgFrame } from "./types";

const ENGINE = "urn:moos:kernel:hp-z440.primary";
const SESSION = "urn:moos:session:sam.z440-cowork-workspace";
const PURPOSE = "urn:moos:purpose:sam.cowork-workspace-curation";

export const MOCK_FRAME: HgFrame = {
  provenance: {
    engine: ENGINE,
    engine_endpoint: "http://localhost:8000 (HTTP) · http://localhost:8080 (MCP)",
    log_seq: 2607,
    t_day: 260,
    workspace: SESSION,
    purpose: PURPOSE,
    view_filter: {
      purpose: PURPOSE,
      scope_urns: [
        SESSION,
        "urn:moos:program:zappa.t259-manifold-axes-staging",
      ],
      t: 260,
      types: ["knowledge_item", "derivation", "purpose", "session"],
    },
    folded_at: "2026-07-19T09:14:22.000Z",
    ontology_version: "4.0.0",
    mock: true,
  },
  nodes: [
    {
      urn: "urn:moos:session:sam.z440-cowork-workspace",
      type_id: "session",
      label: "z440-cowork-workspace",
      properties: {
        occupant: "urn:moos:agent:claude-cowork.hp-z440",
        emit_target: "urn:moos:kernel:hp-z440.primary",
        single_occupant: true,
        created_at: "2026-05-02T08:00:00.000Z",
      },
    },
    {
      urn: "urn:moos:purpose:sam.cowork-workspace-curation",
      type_id: "purpose",
      label: "cowork-workspace-curation",
      properties: {
        gates: 6,
        colors_frame: true,
        created_at: "2026-05-02T08:00:00.000Z",
      },
    },
    {
      urn: "urn:moos:knowledge_item:sam.t260-steinberger-readback",
      type_id: "knowledge_item",
      label: "t260 Steinberger readback",
      properties: {
        title: "Collider Pilot readback & revival recommendation",
        t_day: 260,
        log_seq: 2603,
        chunk_grain: "document",
        source: "github:Collider-Data-Systems/ffs0#158",
        created_at: "2026-07-17T11:42:00.000Z",
      },
    },
    {
      urn: "urn:moos:knowledge_item:sam.t259-manifold-axes",
      type_id: "knowledge_item",
      label: "t259 manifold-axes staging",
      properties: {
        title: "Manifold axes / symmetries / access-law staging",
        t_day: 259,
        log_seq: 2571,
        chunk_grain: "program",
        source: "dev/scripts/ops/t259-manifold-axes-staging.program.json",
        created_at: "2026-07-15T16:20:00.000Z",
      },
    },
    {
      urn: "urn:moos:derivation:zappa.t259-access-law",
      type_id: "derivation",
      label: "t259 access-law",
      properties: {
        rule: "access-law",
        stage: "staged",
        apply_state: "held-at-gate-2",
        t_day: 259,
        log_seq: 2574,
        created_at: "2026-07-15T16:28:00.000Z",
      },
    },
    {
      urn: "urn:moos:derivation:zappa.t259-symmetries",
      type_id: "derivation",
      label: "t259 symmetries",
      properties: {
        rule: "symmetries",
        stage: "staged",
        apply_state: "held-at-gate-2",
        t_day: 259,
        log_seq: 2573,
        created_at: "2026-07-15T16:26:00.000Z",
      },
    },
  ],
  relations: [
    {
      urn: "urn:moos:relation:curates.purpose-session",
      type_id: "WF12",
      label: "curates",
      source_urn: "urn:moos:purpose:sam.cowork-workspace-curation",
      target_urn: "urn:moos:session:sam.z440-cowork-workspace",
    },
    {
      urn: "urn:moos:relation:provides-kb.t260-readback",
      type_id: "WF12",
      label: "provides-kb",
      source_urn: "urn:moos:knowledge_item:sam.t260-steinberger-readback",
      target_urn: "urn:moos:session:sam.z440-cowork-workspace",
    },
    {
      urn: "urn:moos:relation:provides-kb.t259-axes",
      type_id: "WF12",
      label: "provides-kb",
      source_urn: "urn:moos:knowledge_item:sam.t259-manifold-axes",
      target_urn: "urn:moos:session:sam.z440-cowork-workspace",
    },
    {
      urn: "urn:moos:relation:cites.access-law-axes",
      type_id: "WF14",
      label: "cites",
      source_urn: "urn:moos:derivation:zappa.t259-access-law",
      target_urn: "urn:moos:knowledge_item:sam.t259-manifold-axes",
    },
    {
      urn: "urn:moos:relation:cites.symmetries-axes",
      type_id: "WF14",
      label: "cites",
      source_urn: "urn:moos:derivation:zappa.t259-symmetries",
      target_urn: "urn:moos:knowledge_item:sam.t259-manifold-axes",
    },
    {
      urn: "urn:moos:relation:depends-on.access-law-symmetries",
      type_id: "WF14",
      label: "depends-on",
      source_urn: "urn:moos:derivation:zappa.t259-access-law",
      target_urn: "urn:moos:derivation:zappa.t259-symmetries",
    },
  ],
};
