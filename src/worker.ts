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
 * There are NO correctness-critical service-worker globals. The adapter is pure and
 * stateless, so a worker terminated between request and response restarts and
 * re-answers identically. Durable UI state (selected node, cached frame) lives in
 * chrome.storage.session, owned by the side panel — not here.
 *
 * Stripped from the legacy scaffold (per #158): Gemini SDK, API-key/auth-token
 * handling, page-provided secret relay, ad-hoc ```tool``` parser, old :8000 backend
 * fetch, global broadcast, and all in-memory chat/model/context state.
 */

import type { PilotRequest, PilotResponse } from "./mcp/types";
import { MockMcpAdapter } from "./mcp/mock-adapter";

// Phase 1: mock adapter. Phase 2 seam -> new StreamableHttpMcpAdapter().
const adapter = new MockMcpAdapter();

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
      adapter
        .getFrame(message.request)
        .then((frame) => sendResponse({ type: "FRAME", frame }))
        .catch((err: unknown) =>
          sendResponse({ type: "ERROR", error: String(err) }),
        );
      return true; // keep the message channel open for the async response
    }
    return false;
  },
);

chrome.runtime.onInstalled.addListener(() => {
  console.log("[pilot] service worker installed (Phase 1: read-only, mock frame)");
});

console.log("[pilot] service worker started");
