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

/* -------------------------------------------------------------------------- */
/* SURFACE ROOMS — name a generated Z440 window's tab group                   */
/* -------------------------------------------------------------------------- */

/**
 * The launcher opens `sidepanel.html?surface=<key>` as a tab in each generated surface
 * window; that page hands the key to us and we title the window's tab group.
 *
 * WHY THE HANDSHAKE AND NOT A TAB-TITLE MARKER. Reading `tab.title` requires the `tabs`
 * permission, which grants url/title/favIconUrl for EVERY tab in EVERY window and shows up
 * to the user as "Read your browsing history" — an enormous grant for a cosmetic label, on
 * a seat whose whole design is minimal privilege. A page can also SET its own title, so a
 * title marker is attacker-controlled: any site could make us regroup and rename the window
 * it happens to be in. The key instead arrives from the launcher through our OWN page's URL,
 * and the window comes from `sender.tab.windowId`. Neither needs a permission, and neither
 * can be forged by a web page. Only `tabGroups` is required (for the group title/color);
 * `tabs.query`/`tabs.group` themselves need no permission.
 */
const SURFACE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/i;

const GROUP_COLORS: chrome.tabGroups.ColorEnum[] = [
  "blue",
  "cyan",
  "green",
  "orange",
  "pink",
  "purple",
  "red",
  "yellow",
  "grey",
];

/** Stable per-key colour: the same room keeps its colour across restarts. */
function colorForKey(key: string): chrome.tabGroups.ColorEnum {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 100000;
  return GROUP_COLORS[h % GROUP_COLORS.length];
}

/**
 * Group + title the tabs of ONE window.
 *
 * Only tabs that are ungrouped, or already in this window's mo:os group, are absorbed —
 * a group the user made themselves is left intact (`chrome.tabs.group` MOVES tabs, so
 * sweeping everything would empty and destroy it). Pinned tabs are skipped too.
 */
async function nameSurfaceRoom(
  windowId: number,
  surfaceKey: string,
): Promise<{ groupId: number; grouped: number; title: string }> {
  const title = `mo:os - ${surfaceKey}`;
  const tabs = await chrome.tabs.query({ windowId });
  const NONE = chrome.tabGroups.TAB_GROUP_ID_NONE;

  // An existing mo:os group in this window is the one we extend.
  let target: number = NONE;
  for (const t of tabs) {
    if (typeof t.groupId === "number" && t.groupId !== NONE) {
      try {
        const g = await chrome.tabGroups.get(t.groupId);
        if (g.title === title) {
          target = t.groupId;
          break;
        }
      } catch {
        // a group that vanished mid-read is not an error worth failing the handshake for
      }
    }
  }

  const absorb = tabs
    .filter((t) => !t.pinned && (t.groupId === NONE || t.groupId === target))
    .map((t) => t.id)
    .filter((id): id is number => typeof id === "number");

  let groupId: number = target;
  if (absorb.length > 0) {
    groupId =
      target !== NONE
        ? await chrome.tabs.group({ tabIds: absorb, groupId: target })
        : await chrome.tabs.group({ tabIds: absorb, createProperties: { windowId } });
  }
  if (groupId === NONE) {
    throw new Error("no ungrouped tab to place in the surface group");
  }
  await chrome.tabGroups.update(groupId, { title, color: colorForKey(surfaceKey) });
  return { groupId, grouped: absorb.length, title };
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
    _sender: chrome.runtime.MessageSender,  // read for SURFACE_ROOM's windowId
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

    // SURFACE ROOM handshake (see nameSurfaceRoom). The window is taken from the SENDER,
    // never from the message, so a page cannot name a window it is not in; the key is
    // pattern-checked before it reaches a group title.
    if (message?.type === "SURFACE_ROOM") {
      const key = typeof message.surfaceKey === "string" ? message.surfaceKey : "";
      const windowId = _sender?.tab?.windowId;
      if (!SURFACE_KEY_PATTERN.test(key)) {
        sendResponse({ type: "ERROR", error: `invalid surface key: ${JSON.stringify(key)}` });
        return true;
      }
      if (typeof windowId !== "number") {
        // The docked side panel is not a tab and has no window to group — not an error,
        // just nothing to do (only the launcher's TAB copy carries ?surface=).
        sendResponse({ type: "ERROR", error: "sender has no window (not a tab)" });
        return true;
      }
      nameSurfaceRoom(windowId, key)
        .then((r) => sendResponse({ type: "SURFACE_ROOM_OK", ...r }))
        .catch((err: unknown) =>
          sendResponse({
            type: "ERROR",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      return true;
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
