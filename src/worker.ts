/**
 * Collider Pilot - MV3 service worker
 * ===================================
 * Deliberately thin. Two jobs in Phase 1:
 *
 *   1. Open the side panel from the toolbar action.
 *      There is NO `action.default_popup` in the manifest, so `action.onClicked`
 *      fires (Chrome suppresses onClicked when a popup is set — the conflict
 *      Steinberger flagged). We open the panel explicitly on the user gesture.
 *
 *   2. Answer GET_FRAME with a mock frame via the MCP adapter.
 *
 * There are NO correctness-critical service-worker globals. Both adapters are effectively
 * stateless (the live one holds no session — the server is stateless per request), so a
 * worker terminated between request and response restarts and re-answers. Durable UI
 * state (selected node, cached frame) lives in chrome.storage.session, owned by the side
 * panel — not here.
 *
 * Phase 2: the adapter is chosen at runtime by src/mcp/adapter-factory.ts. The EXTENSION
 * defaults to the LIVE StreamableHttpMcpAdapter (read-only MCP over :8080 + REST :8000);
 * 'mock' remains selectable via VITE_PILOT_ADAPTER_MODE or chrome.storage.local. Still
 * READ-ONLY: only graph_state / node_lookup / healthz / state are ever called — no apply.
 *
 * Stripped from the legacy scaffold (per #158): Gemini SDK, API-key/auth-token
 * handling, page-provided secret relay, ad-hoc ```tool``` parser, global broadcast, and
 * all in-memory chat/model/context state.
 */

import type { McpAdapter, PilotRequest, PilotResponse } from "./mcp/types";
import { createAdapter, resolveAdapterMode } from "./mcp/adapter-factory";

// Lazily resolve the adapter (mode = build-time default 'live', overridable via storage),
// then memoize it. No correctness-critical global: if the worker is terminated, the next
// message rebuilds it identically.
let adapterPromise: Promise<McpAdapter> | null = null;
function getAdapter(): Promise<McpAdapter> {
  if (!adapterPromise) {
    adapterPromise = resolveAdapterMode().then((mode) => {
      console.log(`[pilot] adapter mode: ${mode}`);
      return createAdapter(mode);
    });
  }
  return adapterPromise;
}

// No popup is configured, so let onClicked drive panel opening explicitly.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch((err: unknown) =>
    console.error("[pilot] setPanelBehavior failed:", err),
  );

// Toolbar action -> open the side panel (the user click is the required gesture).
chrome.action.onClicked.addListener((tab) => {
  const windowId = tab.windowId;
  if (windowId === undefined) return;
  chrome.sidePanel
    .open({ windowId })
    .catch((err: unknown) => console.error("[pilot] sidePanel.open failed:", err));
});

// Read-only frame requests from the side panel.
chrome.runtime.onMessage.addListener(
  (
    message: PilotRequest,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: PilotResponse) => void,
  ): boolean => {
    if (message?.type === "GET_FRAME") {
      getAdapter()
        .then((adapter) => adapter.getFrame(message.request))
        .then((frame) => sendResponse({ type: "FRAME", frame }))
        .catch((err: unknown) =>
          sendResponse({
            type: "ERROR",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      return true; // keep the message channel open for the async response
    }
    return false;
  },
);

chrome.runtime.onInstalled.addListener(() => {
  console.log(
    "[pilot] service worker installed (Phase 2: read-only; live MCP by default)",
  );
});

console.log("[pilot] service worker started");
