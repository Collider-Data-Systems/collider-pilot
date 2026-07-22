/**
 * Collider Pilot - Actions section (Phase 4 + Phase 7 LLM, re-cut by the t263 UX eval)
 * ====================================================================================
 * The side-panel section that mounts the apply capability. It:
 *   - projects the actor/workspace/purpose affordance pack (live tools/list or mock),
 *   - offers the "ask the model" box: the SELECTED provider (now configured in the
 *     SettingsPanel — t263 item 4; this section only consumes providerId/modelName)
 *     PROPOSES one structured tool call, which is then GATED exactly like a hand-composed
 *     act,
 *   - exposes the two curated mutating acts, each behind the confirmation UI:
 *       1. copy_urn_to_clipboard — a harmless BROWSER act (executes on Confirm),
 *       2. pin_ki_to_workspace  — a REVIEW-ONLY HG rewrite preview (reveals on Confirm),
 *   - lists the discovered catalog for transparency (read + gated mutate; not actionable).
 *
 * SAFETY: every mutating path — whether a button or a model proposal — passes through
 * `dispatchProposal`/`openAction` → `validateToolCall` → the confirmation modal → `resolve`.
 * There is no code path that reaches a mutate without a Confirm. The LLM only PROPOSES; a
 * malformed/hallucinated call is rejected by validateToolCall, never executed. t263 item 6
 * NARROWS that gate further: urn-typed args are now checked against the URN shape and the
 * current frame's resolvable urns (Gemini's live `{urn:"t263"}` now rejects instead of
 * executing), with a "did you mean <selected node>" recovery button that only ever re-enters
 * the SAME gate. The HG act only ever builds/reveals a preview; it has no posting path.
 * Cloud egress (Phase 7) is gated on the A3 access resolution — an anon frame never sends a
 * prompt to a cloud model; the on-box Ollama endpoint is always allowed. Actions are
 * PANEL-ONLY — the PiP mirror never mounts this (it stays read/observe); a note states so.
 *
 * Defensive + ErrorBoundary-wrapped: guarded fields, and the parent wraps this subtree.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HgFrame, RawMcpTool } from "../mcp/types";
import type { PendingAction, ToolCall, ToolSpec } from "../tools/types";
import {
  CLIPBOARD_TOOL,
  PIN_PREVIEW_TOOL,
  actionableTools,
  catalogTools,
  deriveAffordancePack,
  deriveFrameActor,
} from "../tools/affordance";
import {
  URN_PATTERN,
  collectFrameNodeTypes,
  collectFrameUrns,
  makeToolCall,
  validateToolCall,
  type ToolCallContext,
} from "../tools/tool-call";
import { runBrowserAct } from "../tools/browser-acts";
import {
  buildPinPreview,
  previewToJson,
  type HgProgramPreview,
} from "../tools/hg-program-preview";
import {
  getProvider,
  isCloudProvider,
  isModelProvider,
  isProviderAvailable,
} from "../tools/model-providers";
import { evaluateEgress, proposeToolCall } from "../tools/llm-provider";
import { ConfirmActionModal } from "./ConfirmActionModal";

export interface ActionsPanelProps {
  frame: HgFrame;
  selectedUrn: string | null;
  /** Raw MCP tools/list result from the worker, or null (offline / mock adapter). */
  liveTools: RawMcpTool[] | null;
  /** Non-fatal note if tool discovery failed (drives the "using mock pack" hint). */
  affordanceError?: string | null;
  /** Provider/model selection — configured in the SettingsPanel, consumed here. */
  providerId: string;
  modelName: string;
  /** Whether the scope-split LLM bearer is stored (set in Settings; read at call time). */
  llmTokenSet: boolean;
}

interface ActResult {
  ok: boolean;
  message: string;
}

/** A urn suggestion for a rejected proposal ("did you mean …"). */
interface UrnSuggestion {
  field: string;
  urn: string;
  label: string;
  /** Where the candidate came from — drives honest wording in the notice/button. */
  kind: "selection" | "workspace";
}

export function ActionsPanel({
  frame,
  selectedUrn,
  liveTools,
  affordanceError,
  providerId,
  modelName,
  llmTokenSet,
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

  const provider = getProvider(providerId);

  // t263 item 6: the frame-resolvable urn set + node types — the context every
  // validateToolCall in this section runs under (modal open, proposal dispatch, AND the
  // pre-resolve re-validation).
  const urnContext = useMemo<ToolCallContext>(
    () => ({
      knownUrns: collectFrameUrns(frame),
      nodeTypes: collectFrameNodeTypes(frame),
    }),
    [frame],
  );

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [resolving, setResolving] = useState(false);
  const [result, setResult] = useState<ActResult | null>(null);
  const [preview, setPreview] = useState<HgProgramPreview | null>(null);

  // Phase 7 LLM state (all panel-local).
  const [llmText, setLlmText] = useState<string>("");
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmNotice, setLlmNotice] = useState<ActResult | null>(null);
  const [proposed, setProposed] = useState<{
    call: ToolCall;
    tool: ToolSpec | null;
    source: string;
    valid: boolean;
    errors: string[];
    suggestion: UrnSuggestion | null;
  } | null>(null);

  // A provider switch in Settings invalidates any stale proposal/notice here.
  useEffect(() => {
    setProposed(null);
    setLlmNotice(null);
  }, [providerId]);

  // The DERIVED access fiber for THIS frame (A3). Gates cloud egress.
  const access = frame?.provenance?.access ?? null;

  const selectedNode = useMemo(
    () => (frame?.nodes ?? []).find((n) => n.urn === selectedUrn) ?? null,
    [frame, selectedUrn],
  );

  // Build a STRUCTURED ToolCall (typed object — never parsed from text), validate it
  // against the tool's args_schema + the frame's urn context, and stage it for
  // confirmation. Nothing acts here.
  const openAction = useCallback(
    (tool: ToolSpec, args: Record<string, unknown>, target: string) => {
      const call = makeToolCall(tool.name, args);
      const validation = validateToolCall(call, tool, urnContext);
      setPending({ tool, call, target, actor, workspace, purpose, validation });
    },
    [actor, workspace, purpose, urnContext],
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
    // Re-validate at the moment of action (guard against a stale/edited intent) — under
    // the SAME urn context, so a frame refresh that dropped the target also blocks here.
    const revalidation = validateToolCall(pending.call, pending.tool, urnContext);
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
  }, [pending, engineUrn, purpose, urnContext]);

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

  /**
   * t263 item 6 recovery path: when a proposal fails on a urn-typed field, suggest the urn
   * the panel can actually vouch for — the frame workspace for *workspace* fields, the
   * SELECTED node otherwise. The suggestion must itself pass the pattern + frame check, and
   * accepting it re-enters dispatchProposal, i.e. the same gate — never a bypass.
   */
  const suggestUrnFix = useCallback(
    (tool: ToolSpec, call: ToolCall, errors: string[]): UrnSuggestion | null => {
      const fields = tool.args_schema?.fields ?? {};
      for (const field of Object.keys(fields)) {
        const spec = fields[field];
        if (!spec?.urn) continue;
        // Match the error's FIELD position, not a bare substring — a quoted got-value in
        // another field's error (e.g. `(got "urn")`) must never select this field.
        const failing = errors.some(
          (e) =>
            e.startsWith(`arg "${field}"`) || e.startsWith(`missing required arg "${field}"`),
        );
        if (!failing) continue;
        const isWorkspaceField = field.includes("workspace");
        const candidate = isWorkspaceField ? workspace : selectedUrn;
        if (!candidate || candidate === call.args[field]) continue;
        if (!URN_PATTERN.test(candidate)) continue;
        if (spec.mustExistInFrame && !urnContext.knownUrns?.has(candidate)) continue;
        // Copilot #18 catch: never suggest a candidate the validator would reject on
        // node type (e.g. a selected derivation for pin's knowledge_item-only ki_urn).
        if (spec.nodeType && urnContext.nodeTypes?.[candidate] !== spec.nodeType) continue;
        const label = candidate.split(":").pop() || candidate;
        return { field, urn: candidate, label, kind: isWorkspaceField ? "workspace" : "selection" };
      }
      return null;
    },
    [workspace, selectedUrn, urnContext],
  );

  // THE GATE. A model-proposed structured call is validated (the security net) and then
  // routed: READ auto-runs; MUTATE goes into the EXISTING ConfirmActionModal. Nothing is
  // ever auto-applied, and a call outside the actionable allowlist / a malformed call is
  // rejected here, never executed.
  const dispatchProposal = useCallback(
    (call: ToolCall, source: string) => {
      setResult(null);
      setPreview(null);
      // The model is only ever shown actionable tools; a name outside that set is a
      // hallucination — reject it (never fall through to execution).
      const tool = actions.find((t) => t.name === call.name) ?? null;
      if (!tool) {
        setProposed({
          call,
          tool: null,
          source,
          valid: false,
          errors: [`"${call.name}" is not in the actionable allowlist`],
          suggestion: null,
        });
        setLlmNotice({
          ok: false,
          message: `Rejected: "${call.name}" is not an available action.`,
        });
        return;
      }
      // The safety net (src/tools/tool-call.ts). Same validator the modal + resolver use —
      // now with the urn context, so shape-valid-but-meaningless urns reject here too.
      const validation = validateToolCall(call, tool, urnContext);
      if (!validation.ok) {
        const suggestion = suggestUrnFix(tool, call, validation.errors);
        setProposed({
          call,
          tool,
          source,
          valid: false,
          errors: validation.errors,
          suggestion,
        });
        setLlmNotice({
          ok: false,
          message: suggestion
            ? `Rejected by validateToolCall — bad urn arg. Did you mean the ${suggestion.kind === "workspace" ? "frame workspace" : "selected"} "${suggestion.label}"?`
            : "Rejected by validateToolCall — the proposed call is malformed.",
        });
        return; // never execute an invalid/hallucinated call
      }
      setProposed({ call, tool, source, valid: true, errors: [], suggestion: null });
      if (tool.kind === "read") {
        // General contract: read tools auto-run. The current actionable set is mutate-only,
        // so this branch is unreachable via the LLM (only actionable tools are exposed, and
        // validateToolCall rejects any name outside them). Kept for the read-tool future.
        setLlmNotice({
          ok: true,
          message: `read tool ${tool.name} would auto-run (no wired read executor in this build).`,
        });
        return;
      }
      // MUTATE: route into the EXISTING confirmation modal. No auto-apply, ever. The HG
      // channel stays a review-only preview that never POSTs.
      const target = String(
        call.args.urn ?? call.args.ki_urn ?? selectedUrn ?? "(model-proposed)",
      );
      setLlmNotice({
        ok: true,
        message: `Proposed ${tool.name} — review and confirm in the modal.`,
      });
      openAction(tool, call.args as Record<string, unknown>, target);
    },
    [actions, openAction, selectedUrn, urnContext, suggestUrnFix],
  );

  // Accept the "did you mean" fix: substitute the failing field, DROP any args outside
  // the tool's schema (they would fail the unknown-arg check forever and dead-end the
  // recovery), and re-dispatch the corrected call through the full gate again.
  const applySuggestion = useCallback(() => {
    if (!proposed?.suggestion || !proposed.tool) return;
    const { field, urn } = proposed.suggestion;
    const fields = proposed.tool.args_schema?.fields ?? {};
    const args: Record<string, unknown> = {};
    for (const key of Object.keys(proposed.call.args)) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) args[key] = proposed.call.args[key];
    }
    args[field] = urn;
    dispatchProposal({ name: proposed.call.name, args }, `${proposed.source}+fix`);
  }, [proposed, dispatchProposal]);

  // Send the user's request to the selected model. The cloud-egress access gate runs FIRST;
  // an on-box provider (Ollama) is always allowed. The model only PROPOSES — dispatchProposal
  // then validates + routes.
  const runLlm = useCallback(async () => {
    const text = llmText.trim();
    if (!text) return;
    setProposed(null);
    setResult(null);
    setPreview(null);
    setLlmNotice(null);

    const egress = evaluateEgress(provider, access);
    if (!egress.allowed) {
      setLlmNotice({
        ok: false,
        message: `${egress.reason}${egress.fallbackProviderId ? " — switch to Ollama (local) in Settings to proceed." : ""}`,
      });
      return;
    }

    setLlmBusy(true);
    try {
      const res = await proposeToolCall({
        provider,
        model: modelName,
        userText: text,
        tools: actions,
        context: { actor, workspace, purpose, selectedUrn },
      });
      if (!res.ok) {
        setLlmNotice({ ok: false, message: `LLM error: ${res.error}` });
        return;
      }
      if (res.kind === "message") {
        setLlmNotice({
          ok: false,
          message: `The model proposed no tool call${res.content ? `: ${res.content.slice(0, 300)}` : "."}`,
        });
        return;
      }
      dispatchProposal(res.call, res.source);
    } catch (err) {
      setLlmNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setLlmBusy(false);
    }
  }, [
    llmText,
    provider,
    access,
    modelName,
    actions,
    actor,
    workspace,
    purpose,
    selectedUrn,
    dispatchProposal,
  ]);

  const canClipboard = !!selectedUrn;
  const canPin = !!selectedUrn && selectedNode?.type_id === "knowledge_item";
  const llmUsable = isModelProvider(provider) && isProviderAvailable(provider);
  const bearerMissing = provider.viaKernelProxy === true && !llmTokenSet;
  // Pre-flight egress verdict, visible AT the propose surface (t263 review catch: the
  // Settings move buried the always-visible banner in a collapsed disclosure — the user
  // must see BLOCKED before typing, not after pressing Propose).
  const egressPreview = isCloudProvider(provider) ? evaluateEgress(provider, access) : null;

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

      {/* Phase 7: the LLM request box. The provider/model/bearer live in Settings (t263
          item 4); this box only consumes them. Type a request → the model proposes ONE
          structured tool call → validateToolCall → read auto-runs / mutate hits the modal.
          Never applied. */}
      <div className="actions-block llm-block">
        <div className="actions-block-title">ask the model (proposes only)</div>
        <textarea
          className="llm-input"
          rows={3}
          value={llmText}
          placeholder={
            llmUsable
              ? "e.g. copy the selected node's urn to my clipboard"
              : "Select a callable model provider in Settings to enable the model"
          }
          onChange={(e) => setLlmText(e.target.value)}
          disabled={!llmUsable || llmBusy}
        />
        <div className="llm-actions">
          <button
            className="act-btn llm-send"
            onClick={() => void runLlm()}
            disabled={!llmUsable || llmBusy || llmText.trim() === ""}
            title={
              llmUsable
                ? "Send to the model — it PROPOSES a tool call; you gate it"
                : provider.enabled === false
                  ? "This provider is not yet available (pending kernel-proxy)"
                  : "Manual mode — no model is invoked"
            }
          >
            {llmBusy ? "Proposing…" : "Propose"}
          </button>
          <span className="llm-model-tag">
            {isModelProvider(provider) ? `${provider.id} · ${modelName}` : "manual"}
          </span>
        </div>
        {bearerMissing && (
          <div className="aff-warn">
            this provider needs the scope-split LLM bearer — set it in Settings.
          </div>
        )}
        {egressPreview && (
          <div className={`provider-egress ${egressPreview.allowed ? "ok" : "blocked"}`}>
            cloud egress: {egressPreview.allowed ? "permitted" : "BLOCKED"} —{" "}
            {egressPreview.reason}
          </div>
        )}
        <div className="llm-hint">
          The model NEVER auto-applies. Reads auto-run; mutating acts go through the
          confirmation modal (HG rewrites stay review-only previews that never POST).
        </div>

        {llmNotice && (
          <div className={`act-result ${llmNotice.ok ? "ok" : "err"}`} role="status">
            {llmNotice.message}
          </div>
        )}

        {proposed && (
          <div className={`llm-proposed ${proposed.valid ? "valid" : "invalid"}`}>
            <div className="llm-proposed-head">
              proposed tool call
              <span className={`llm-source ${proposed.source}`}>{proposed.source}</span>
              <span className={`llm-valid ${proposed.valid ? "ok" : "bad"}`}>
                {proposed.valid ? "validated" : "rejected"}
              </span>
            </div>
            <pre className="llm-proposed-json">
              {JSON.stringify(proposed.call, null, 2)}
            </pre>
            {!proposed.valid && proposed.errors.length > 0 && (
              <ul className="llm-proposed-errors">
                {proposed.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
            {proposed.suggestion && (
              <button
                className="gc-btn llm-suggest-btn"
                onClick={applySuggestion}
                title={`Re-propose with ${proposed.suggestion.field} = ${proposed.suggestion.urn} — goes through the same validation + confirm gate`}
              >
                Did you mean the{" "}
                {proposed.suggestion.kind === "workspace" ? "frame workspace" : "selected"}{" "}
                {proposed.suggestion.label}? Use it
              </button>
            )}
          </div>
        )}
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

      {/* Discovered catalog — transparency (criterion 1); not actionable. Phase 6: behind
          a <details> disclosure (collapsed by default) to reclaim vertical space. */}
      <details className="actions-block catalog-details">
        <summary className="actions-block-title catalog-summary">
          discovered tools ({catalog.length})
        </summary>
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
      </details>

      <ConfirmActionModal
        pending={pending}
        resolving={resolving}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </section>
  );
}
