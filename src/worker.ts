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

import type {
  FrameRequest,
  McpAdapter,
  PilotRequest,
  PilotResponse,
  ToolDiscoveryAdapter,
} from "./mcp/types";
import {
  createAdapter,
  resolveAdapterMode,
  resolveAdapterConfig,
} from "./mcp/adapter-factory";
import { resolveTrustedAccess } from "./state/access-identity";
import { readRequestedMode } from "./mcp/access.js";

/**
 * The ACCESS TRUST SEAM (invariant 3). Rebuild `view_filter.access` AUTHORITATIVELY: read
 * the ONLY page-influenced input — `access.mode` — from the inbound request, then re-inject
 * the trusted scope resolved from chrome.storage.local. Any inbound user/workstation/role/
 * identity_source is DISCARDED and overwritten. A compromised panel or page-bridge can
 * toggle posture ("anon" | "identified") but can NEVER assert an identity or name a
 * workstation — the identity is page-inaccessible by construction.
 */
async function withTrustedAccess(
  request: FrameRequest | undefined,
): Promise<FrameRequest> {
  const requestedMode = readRequestedMode(request); // extracts ONLY inbound access.mode
  const trusted = await resolveTrustedAccess(requestedMode); // from chrome.storage.local
  return {
    ...request,
    view_filter: { ...(request?.view_filter ?? {}), access: trusted },
  };
}

/** Duck-type: does this adapter expose the read-only `tools/list` discovery seam? */
function hasToolDiscovery(
  adapter: McpAdapter,
): adapter is McpAdapter & ToolDiscoveryAdapter {
  return typeof (adapter as Partial<ToolDiscoveryAdapter>).listTools === "function";
}

// Lazily resolve the adapter (mode = build-time default 'live', overridable via storage),
// then memoize it. No correctness-critical global: if the worker is terminated, the next
// message rebuilds it identically.
let adapterPromise: Promise<McpAdapter> | null = null;
function getAdapter(): Promise<McpAdapter> {
  if (!adapterPromise) {
    adapterPromise = Promise.all([resolveAdapterMode(), resolveAdapterConfig()]).then(
      ([mode, config]) => {
        console.log(
          `[pilot] adapter mode: ${mode} · access tier: ${config.enforcement ?? "client-presentation"}`,
        );
        return createAdapter(mode, config);
      },
    );
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
      // Strip inbound access + re-inject the trusted identity BEFORE the adapter reads. The
      // panel only ever contributes view_filter.access.mode; identity comes from storage.
      Promise.all([getAdapter(), withTrustedAccess(message.request)])
        .then(([adapter, request]) => adapter.getFrame(request))
        .then((frame) => sendResponse({ type: "FRAME", frame }))
        .catch((err: unknown) =>
          sendResponse({
            type: "ERROR",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      return true; // keep the message channel open for the async response
    }

    // Phase 4: READ-ONLY tool discovery. The live adapter answers with the MCP
    // `tools/list` catalog; the mock adapter has no discovery seam, so we answer with
    // an empty list and the side panel falls back to the MOCK affordance pack. No tool
    // is ever invoked here — this only enumerates what exists.
    if (message?.type === "LIST_TOOLS") {
      getAdapter()
        .then((adapter) =>
          hasToolDiscovery(adapter) ? adapter.listTools() : Promise.resolve([]),
        )
        .then((tools) => sendResponse({ type: "TOOLS", tools }))
        .catch((err: unknown) =>
          sendResponse({
            type: "ERROR",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      return true;
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
