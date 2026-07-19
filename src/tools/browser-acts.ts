/**
 * Collider Pilot - browser acts (Phase 4)
 * =======================================
 * The executable side of a `channel: 'browser'` tool. These run LOCALLY in the panel —
 * no engine, no MCP, no HG write. They still only run AFTER the confirmation UI's Confirm
 * (the resolver calls them), so every mutating act — even a harmless clipboard write — is
 * gated. Criterion 4's harmless act: copy the selected node urn to the clipboard.
 *
 * The Confirm click is the user gesture the Clipboard API requires; a `document.execCommand`
 * fallback covers contexts where the async Clipboard API is unavailable.
 */

import type { ToolCall } from "./types";

export interface BrowserActResult {
  ok: boolean;
  message: string;
}

/** Best-effort clipboard write: async Clipboard API first, execCommand fallback. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the execCommand path
  }
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Execute a validated browser-act ToolCall. Only `copy_urn_to_clipboard` is implemented;
 * an unknown browser act is a no-op error (never a silent success). The caller has
 * already validated the call against the tool's args_schema.
 */
export async function runBrowserAct(call: ToolCall): Promise<BrowserActResult> {
  if (call.name === "copy_urn_to_clipboard") {
    const urn = String((call.args as Record<string, unknown>).urn ?? "");
    if (!urn) return { ok: false, message: "no urn to copy" };
    const ok = await writeClipboard(urn);
    return ok
      ? { ok: true, message: `copied to clipboard: ${urn}` }
      : { ok: false, message: "clipboard write was blocked by the browser" };
  }
  return { ok: false, message: `unknown browser act: ${call.name}` };
}
