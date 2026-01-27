/**
 * Collider Pilot - Content Script
 * ================================
 * Bridge between the extension and the web page.
 *
 * Responsibilities:
 * 1. Inject colliderBridge listener on page
 * 2. Relay TOOL_DISPATCH from extension → page
 * 3. Relay CONTEXT_UPDATE from page → extension
 */

// =============================================================================
// Types
// =============================================================================

interface AppContext {
  appId: string | null;
  containerId: string | null;
  containerName: string | null;
  canvasId: string | null;
  pageUrl: string;
}

interface ToolDispatch {
  type: "DISPATCH_TOOL";
  name: string;
  args: Record<string, unknown>;
}

interface BridgeMessage {
  source: "collider-page";
  type: "CONTEXT_UPDATE" | "TOOL_RESULT" | "BRIDGE_READY" | "AUTH_INFO";
  payload?: unknown;
}

// =============================================================================
// Extension → Page: Tool Dispatch
// =============================================================================

chrome.runtime.onMessage.addListener(
  (
    message: ToolDispatch,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    if (message.type === "DISPATCH_TOOL") {
      console.log("[ContentScript] Dispatching tool to page:", message.name);

      // Send to page via postMessage
      window.postMessage(
        {
          source: "collider-extension",
          type: "TOOL_DISPATCH",
          name: message.name,
          args: message.args,
        },
        "*",
      );

      sendResponse({ success: true });
    }
    return true;
  },
);

// =============================================================================
// Page → Extension: Context Updates & Tool Results
// =============================================================================

window.addEventListener("message", (event) => {
  // Only accept messages from our page
  if (event.source !== window) return;

  const data = event.data as BridgeMessage;
  if (data.source !== "collider-page") return;

  switch (data.type) {
    case "CONTEXT_UPDATE": {
      const context = data.payload as AppContext;
      console.log("[ContentScript] Relaying context update:", context);
      chrome.runtime.sendMessage({
        type: "CONTEXT_UPDATE",
        context,
      });
      break;
    }

    case "TOOL_RESULT": {
      const result = data.payload as { name: string; result: unknown };
      console.log("[ContentScript] Relaying tool result:", result.name);
      chrome.runtime.sendMessage({
        type: "TOOL_RESULT",
        toolName: result.name,
        result: result.result,
      });
      break;
    }

    case "BRIDGE_READY": {
      console.log(
        "[ContentScript] Bridge ready, requesting initial context and auth",
      );
      window.postMessage(
        {
          source: "collider-extension",
          type: "GET_CONTEXT",
        },
        "*",
      );
      // Also request auth
      window.postMessage(
        {
          source: "collider-extension",
          type: "GET_AUTH",
        },
        "*",
      );
      break;
    }

    case "AUTH_INFO": {
      const authInfo = data.payload as {
        authToken: string | null;
        geminiKey: string | null;
      };
      console.log("[ContentScript] Relaying auth info to extension");
      // Store in chrome.storage for service worker
      chrome.storage.local.set({
        authToken: authInfo.authToken,
        geminiApiKey: authInfo.geminiKey,
      });
      chrome.runtime.sendMessage({
        type: "AUTH_UPDATED",
        authToken: authInfo.authToken,
        geminiKey: authInfo.geminiKey,
      });
      break;
    }
  }
});

// =============================================================================
// Inject Page Script (if needed for deeper integration)
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function injectPageScript() {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("bridge.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

// Only inject if we're on a Collider page
if (
  window.location.hostname === "localhost" ||
  window.location.hostname.endsWith(".collider.app")
) {
  // Check if page already has colliderBridge
  // The bridge is set up in main.tsx, so we just need to signal ready
  setTimeout(() => {
    window.postMessage(
      {
        source: "collider-extension",
        type: "EXTENSION_READY",
      },
      "*",
    );
  }, 500);
}

// =============================================================================
// Periodic Context Polling (fallback)
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _lastContextJson = "";

function pollContext() {
  window.postMessage(
    {
      source: "collider-extension",
      type: "GET_CONTEXT",
    },
    "*",
  );
}

// Poll every 2 seconds for context changes
setInterval(pollContext, 2000);

console.log("[Collider Pilot] Content script loaded");
