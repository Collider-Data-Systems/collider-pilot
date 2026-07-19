/**
 * Collider Pilot - REVIEW-ONLY HG program preview builder (Phase 4)
 * =================================================================
 * SAFETY INVARIANT (the heart of Phase 4): this module builds a mo:os rewrite envelope
 * as a DATA STRUCTURE and STRINGIFIES it for display/download. It performs NO network
 * I/O. There is no `fetch`, no MCP client, no adapter reference in this file. Nothing
 * here posts anything. The word for a live write ("apply_program") appears ONLY as a
 * string VALUE inside the preview payload — it names the tool a human WOULD invoke if
 * they chose to hand-post the reviewed envelope. This code never invokes it.
 *
 * What it builds (criterion 4's second act): a WF19 `pins-urn` LINK proposing that the
 * selected knowledge_item be pinned into the workspace session. The envelope shape
 * follows the mo:os `apply_program` contract (an atomic `envelopes` array); the port
 * pair `pins-urn` / `pinned-by-session` and the kernel actor match the canonical WF19
 * pin form. The confirmation UI's Confirm on an `hg`-channel tool reveals THIS artifact
 * and offers a local download — it does not, and cannot, post it.
 */

/** One LINK rewrite envelope, in the exact on-wire shape the kernel would accept. */
export interface LinkEnvelope {
  rewrite_type: "LINK";
  actor: string;
  relation_urn: string;
  src_urn: string;
  src_port: string;
  tgt_urn: string;
  tgt_port: string;
  rewrite_category: string;
}

/**
 * The review-only preview wrapper. `arguments` is the EXACT wire payload a human could
 * hand-post; the sibling `preview` / `note` / `context` fields are review metadata that
 * are NOT part of the wire payload. Keeping them siblings (not merged into `arguments`)
 * means the reviewer sees a faithful envelope, and this app never sends any of it.
 */
export interface HgProgramPreview {
  /** Unmissable marker: this is an artifact for inspection, never a live call. */
  preview: true;
  note: string;
  /** The tool a human would invoke to APPLY this — named as data, never called here. */
  tool: string;
  context: {
    actor: string;
    workspace: string;
    purpose: string;
    rewrite_category: string;
    relation: string;
  };
  /** The exact atomic-program wire payload (envelopes array). */
  arguments: { envelopes: LinkEnvelope[] };
}

/** Last `:`-delimited segment of a urn, for building a readable relation urn. */
function shortUrn(urn: string): string {
  const s = String(urn || "");
  const seg = s.split(":").pop();
  return seg && seg.trim() ? seg : "unknown";
}

export interface BuildPinPreviewInput {
  /** knowledge_item being proposed for pinning. */
  kiUrn: string;
  /** session/workspace urn the KI would be pinned into. */
  workspaceUrn: string;
  /** kernel/engine urn that would author the WF19 pin (Authority=kernel). */
  engineUrn: string;
  /** purpose urn the frame is coloured by (review context only, not on the wire). */
  purposeUrn: string;
}

/**
 * Build the review-only WF19 pins-urn preview. Pure: returns a data object. Never posts.
 */
export function buildPinPreview(input: BuildPinPreviewInput): HgProgramPreview {
  const relationUrn = `urn:moos:rel:pilot-pin.${shortUrn(input.workspaceUrn)}.${shortUrn(input.kiUrn)}`;
  const envelope: LinkEnvelope = {
    rewrite_type: "LINK",
    actor: input.engineUrn, // WF19 pins-urn is kernel-authored
    relation_urn: relationUrn,
    src_urn: input.workspaceUrn,
    src_port: "pins-urn",
    tgt_urn: input.kiUrn,
    tgt_port: "pinned-by-session",
    rewrite_category: "WF19",
  };
  return {
    preview: true,
    note:
      "REVIEW-ONLY preview. This app does NOT post it. To apply, a human would review " +
      "and hand-submit the `arguments` payload to the kernel out of band.",
    tool: "apply_program", // data only: names the tool a human would invoke; never called
    context: {
      actor: input.engineUrn,
      workspace: input.workspaceUrn,
      purpose: input.purposeUrn,
      rewrite_category: "WF19",
      relation: "pins-urn / pinned-by-session",
    },
    arguments: { envelopes: [envelope] },
  };
}

/** Stringify a preview for display / download. Indented, stable. Purely a to-string. */
export function previewToJson(preview: HgProgramPreview): string {
  return JSON.stringify(preview, null, 2);
}
