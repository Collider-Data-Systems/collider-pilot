/**
 * Collider Pilot - Actions section (Phase 4)
 * ==========================================
 * The side-panel section that mounts the FIRST apply capability. It:
 *   - projects the actor/workspace/purpose affordance pack (live tools/list or mock),
 *   - offers a provider-neutral model selector (default 'manual'; a seam, no calls),
 *   - exposes the two curated mutating acts, each behind the confirmation UI:
 *       1. copy_urn_to_clipboard — a harmless BROWSER act (executes on Confirm),
 *       2. pin_ki_to_workspace  — a REVIEW-ONLY HG rewrite preview (reveals on Confirm),
 *   - lists the discovered catalog for transparency (read + gated mutate; not actionable).
 *
 * SAFETY: every mutating path passes through `openAction` → the confirmation modal →
 * `resolve`. There is no code path that reaches an act without a Confirm. The HG act only
 * ever builds/reveals a preview; it has no posting path. Actions are PANEL-ONLY — the PiP
 * mirror never mounts this (it stays read/observe); a note states so.
 *
 * Defensive + ErrorBoundary-wrapped: guarded fields, and the parent wraps this subtree.
 */

import { useCallback, useMemo, useState } from "react";
import type { HgFrame, RawMcpTool } from "../mcp/types";
import type { PendingAction, ToolSpec } from "../tools/types";
import {
  CLIPBOARD_TOOL,
  PIN_PREVIEW_TOOL,
  actionableTools,
  catalogTools,
  deriveAffordancePack,
  deriveFrameActor,
} from "../tools/affordance";
import { makeToolCall, validateToolCall } from "../tools/tool-call";
import { runBrowserAct } from "../tools/browser-acts";
import {
  buildPinPreview,
  previewToJson,
  type HgProgramPreview,
} from "../tools/hg-program-preview";
import {
  DEFAULT_PROVIDER_ID,
  MODEL_PROVIDERS,
  getProvider,
  hasWebGpu,
  isProviderAvailable,
} from "../tools/model-providers";
import { ConfirmActionModal } from "./ConfirmActionModal";

export interface ActionsPanelProps {
  frame: HgFrame;
  selectedUrn: string | null;
  /** Raw MCP tools/list result from the worker, or null (offline / mock adapter). */
  liveTools: RawMcpTool[] | null;
  /** Non-fatal note if tool discovery failed (drives the "using mock pack" hint). */
  affordanceError?: string | null;
}

interface ActResult {
  ok: boolean;
  message: string;
}

export function ActionsPanel({
  frame,
  selectedUrn,
  liveTools,
  affordanceError,
}: ActionsPanelProps) {
  const workspace = frame?.provenance?.workspace ?? "";
  const purpose = frame?.provenance?.purpose ?? "";
  const engineUrn = frame?.provenance?.engine ?? "";
  const actor = useMemo(() => deriveFrameActor(frame), [frame]);

  const pack = useMemo(
    () => deriveAffordancePack({ actor, workspace, purpose, liveTools }),
    [actor, workspace, purpose, liveTools],
  );
  const actions = useMemo(() => actionableTools(pack), [pack]);
  const catalog = useMemo(() => catalogTools(pack), [pack]);

  const [providerId, setProviderId] = useState<string>(DEFAULT_PROVIDER_ID);
  const provider = getProvider(providerId);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [resolving, setResolving] = useState(false);
  const [result, setResult] = useState<ActResult | null>(null);
  const [preview, setPreview] = useState<HgProgramPreview | null>(null);

  const selectedNode = useMemo(
    () => (frame?.nodes ?? []).find((n) => n.urn === selectedUrn) ?? null,
    [frame, selectedUrn],
  );

  // Build a STRUCTURED ToolCall (typed object — never parsed from text), validate it
  // against the tool's args_schema, and stage it for confirmation. Nothing acts here.
  const openAction = useCallback(
    (tool: ToolSpec, args: Record<string, unknown>, target: string) => {
      const call = makeToolCall(tool.name, args);
      const validation = validateToolCall(call, tool);
      setPending({ tool, call, target, actor, workspace, purpose, validation });
    },
    [actor, workspace, purpose],
  );

  const openClipboard = useCallback(() => {
    if (!selectedUrn) return;
    setResult(null);
    openAction(CLIPBOARD_TOOL, { urn: selectedUrn }, selectedUrn);
  }, [selectedUrn, openAction]);

  const openPin = useCallback(() => {
    if (!selectedUrn) return;
    setResult(null);
    setPreview(null);
    openAction(
      PIN_PREVIEW_TOOL,
      { ki_urn: selectedUrn, workspace_urn: workspace },
      selectedUrn,
    );
  }, [selectedUrn, workspace, openAction]);

  const handleCancel = useCallback(() => {
    // Cancel is a strict no-op: drop the pending intent, touch nothing else.
    setPending(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pending) return;
    // Re-validate at the moment of action (guard against a stale/edited intent).
    const revalidation = validateToolCall(pending.call, pending.tool);
    if (!revalidation.ok) {
      setPending({ ...pending, validation: revalidation });
      return;
    }
    setResolving(true);
    try {
      if (pending.tool.channel === "browser") {
        const r = await runBrowserAct(pending.call);
        setResult(r);
        setPreview(null);
      } else if (pending.tool.channel === "hg") {
        // REVIEW-ONLY: build + reveal the envelope preview. No post, ever.
        const built = buildPinPreview({
          kiUrn: String(pending.call.args.ki_urn ?? ""),
          workspaceUrn: String(pending.call.args.workspace_urn ?? ""),
          engineUrn,
          purposeUrn: purpose,
        });
        setPreview(built);
        setResult({
          ok: true,
          message: "Review-only preview built. Not posted to the kernel.",
        });
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setResolving(false);
      setPending(null);
    }
  }, [pending, engineUrn, purpose]);

  const downloadPreview = useCallback(() => {
    if (!preview) return;
    try {
      const blob = new Blob([previewToJson(preview)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "wf19-pin-preview.review-only.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setResult({ ok: false, message: "download was blocked by the browser" });
    }
  }, [preview]);

  const canClipboard = !!selectedUrn;
  const canPin = !!selectedUrn && selectedNode?.type_id === "knowledge_item";

  return (
    <section className="actions" aria-label="Actions">
      <div className="actions-head">
        <span className="actions-title">Actions</span>
        <span className={`actions-src ${pack.source}`}>{pack.source.toUpperCase()}</span>
      </div>

      <div className="actions-note pip-note">
        Actions run in the side panel only — the PiP mirror stays read-only / observe.
      </div>

      {/* Affordance pack: actor / workspace / purpose projection (criterion 1). */}
      <div className="actions-block">
        <div className="actions-block-title">affordance pack</div>
        <div className="aff-meta">
          <div><span className="aff-k">actor</span> <code>{actor}</code></div>
          <div><span className="aff-k">workspace</span> <code>{workspace}</code></div>
          <div><span className="aff-k">purpose</span> <code>{purpose}</code></div>
          <div className="aff-label">{pack.label}</div>
          {affordanceError && (
            <div className="aff-warn">
              tools/list unavailable ({affordanceError}) — using the mock pack.
            </div>
          )}
        </div>
      </div>

      {/* Provider-neutral model seam (criteria 5 + 6). Default manual; no calls. */}
      <div className="actions-block">
        <div className="actions-block-title">model provider (seam — no calls)</div>
        <select
          className="provider-select"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
        >
          {MODEL_PROVIDERS.map((p) => {
            const avail = isProviderAvailable(p);
            return (
              <option key={p.id} value={p.id} disabled={!avail}>
                {p.label}
                {p.requiresCapability === "webgpu" && !avail ? " (no WebGPU)" : ""}
              </option>
            );
          })}
        </select>
        <div className="provider-note">{provider.note}</div>
        <div className="provider-cap">
          WebGPU capability (stub): {hasWebGpu() ? "present" : "absent"}
        </div>
      </div>

      {/* The two curated mutating acts — each behind the confirmation UI. */}
      <div className="actions-block">
        <div className="actions-block-title">controlled acts (confirmation-gated)</div>
        <div className="act-buttons">
          <button
            className="act-btn"
            onClick={openClipboard}
            disabled={!canClipboard}
            title={
              canClipboard
                ? CLIPBOARD_TOOL.description
                : "Select a node first"
            }
          >
            Copy urn to clipboard
            <span className="act-kind browser">browser</span>
          </button>
          <button
            className="act-btn"
            onClick={openPin}
            disabled={!canPin}
            title={
              canPin
                ? PIN_PREVIEW_TOOL.description
                : "Select a knowledge_item to preview a pin"
            }
          >
            Preview: pin KI to workspace
            <span className="act-kind hg">HG · review-only</span>
          </button>
        </div>
        {actions.length !== 2 && (
          <div className="aff-warn">
            expected 2 curated actions, pack advertised {actions.length}
          </div>
        )}
      </div>

      {/* Result / status. */}
      {result && (
        <div className={`act-result ${result.ok ? "ok" : "err"}`} role="status">
          {result.message}
        </div>
      )}

      {/* Revealed REVIEW-ONLY preview (never posted). */}
      {preview && (
        <div className="actions-block preview-block">
          <div className="actions-block-title">
            review-only apply_program preview
            <button className="mini-btn" onClick={downloadPreview}>
              download
            </button>
            <button className="mini-btn" onClick={() => setPreview(null)}>
              dismiss
            </button>
          </div>
          <div className="preview-warn">
            Not posted. This is an artifact for review; applying is a separate, out-of-band,
            human step.
          </div>
          <pre className="preview-json">{previewToJson(preview)}</pre>
        </div>
      )}

      {/* Discovered catalog — transparency (criterion 1); not actionable. */}
      <div className="actions-block">
        <div className="actions-block-title">discovered tools ({catalog.length})</div>
        <ul className="catalog">
          {catalog.map((t) => (
            <li key={t.name} className="catalog-item">
              <span className={`cat-kind ${t.kind}`}>{t.kind}</span>
              <code className="cat-name">{t.name}</code>
              <span className="cat-desc" title={t.description}>{t.description}</span>
            </li>
          ))}
          {catalog.length === 0 && <li className="aff-warn">no tools discovered</li>}
        </ul>
      </div>

      <ConfirmActionModal
        pending={pending}
        resolving={resolving}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </section>
  );
}
