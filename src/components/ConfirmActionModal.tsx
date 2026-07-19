/**
 * Collider Pilot - confirmation UI (Phase 4)
 * ==========================================
 * Criterion 3: a confirmation modal for EVERY mutating act. It shows the tool, target,
 * args, actor, workspace, purpose, and expected effect, with Confirm / Cancel. Cancel is
 * a strict no-op. Confirm's meaning is fixed by the tool's `channel`:
 *   - 'browser' → the resolver executes the local browser act.
 *   - 'hg'      → the resolver ONLY builds/reveals the review-only preview (never posts).
 *
 * The modal itself performs NO act — it emits `onConfirm` / `onCancel` and the parent
 * resolver decides. Confirm is disabled unless the structured ToolCall validated against
 * the tool's args_schema. Defensive: every field is guarded; the whole subtree is wrapped
 * by the panel's ErrorBoundary.
 */

import { useEffect, useRef } from "react";
import type { PendingAction } from "../tools/types";

export interface ConfirmActionModalProps {
  pending: PendingAction | null;
  resolving?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="cam-row">
      <span className="cam-label">{label}</span>
      <span className={`cam-value${mono ? " mono" : ""}`} title={value}>
        {value}
      </span>
    </div>
  );
}

export function ConfirmActionModal({
  pending,
  resolving,
  onConfirm,
  onCancel,
}: ConfirmActionModalProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // Focus Cancel by default (safe default) and wire Escape → Cancel.
  useEffect(() => {
    if (!pending) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onCancel]);

  if (!pending) return null;

  const { tool, call, target, actor, workspace, purpose, validation } = pending;
  const valid = validation?.ok === true;
  const isHg = tool.channel === "hg";
  const argsJson = (() => {
    try {
      return JSON.stringify(call.args ?? {}, null, 2);
    } catch {
      return "{ /* unserialisable args */ }";
    }
  })();

  const confirmLabel = isHg ? "Reveal review-only preview" : "Confirm & run";

  return (
    <div className="cam-overlay" role="dialog" aria-modal="true" aria-label="Confirm action">
      <div className="cam-modal">
        <div className="cam-head">
          <span className="cam-title">Confirm mutating act</span>
          <span className={`cam-badge ${isHg ? "hg" : "browser"}`}>
            {isHg ? "HG rewrite · review-only" : "browser act"}
          </span>
        </div>

        <div className="cam-body">
          <Row label="tool" value={tool.name} mono />
          <Row label="kind · channel" value={`${tool.kind} · ${tool.channel}`} />
          <Row label="target" value={target} mono />
          <Row label="actor" value={actor} mono />
          <Row label="workspace" value={workspace} mono />
          <Row label="purpose" value={purpose} mono />

          <div className="cam-section">
            <div className="cam-section-title">arguments</div>
            <pre className="cam-args">{argsJson}</pre>
          </div>

          <div className="cam-section">
            <div className="cam-section-title">expected effect</div>
            <div className="cam-effect">{tool.expected_effect}</div>
          </div>

          {isHg && (
            <div className="cam-note">
              Confirm builds a review-only <code>apply_program</code> envelope and displays
              it. It is <strong>not</strong> posted to the kernel.
            </div>
          )}

          {!valid && (
            <div className="cam-invalid" role="alert">
              <strong>Structured call invalid</strong>
              <ul>
                {(validation?.errors ?? ["unknown validation error"]).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="cam-actions">
          <button ref={cancelRef} className="cam-btn cancel" onClick={onCancel} disabled={resolving}>
            Cancel
          </button>
          <button
            className={`cam-btn confirm${isHg ? " hg" : ""}`}
            onClick={onConfirm}
            disabled={!valid || resolving}
            title={valid ? confirmLabel : "Fix the invalid structured call first"}
          >
            {resolving ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
