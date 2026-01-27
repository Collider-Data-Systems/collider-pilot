/**
 * Collider Pilot - Service Worker
 * ================================
 * Background script that runs the Gemini SDK and coordinates tool execution.
 *
 * This is the "brain" - handles LLM calls, fetches PilotConfig from backend,
 * and relays tool dispatch commands to the content script.
 */

import {
  GoogleGenerativeAI,
  type GenerativeModel,
  type ChatSession,
} from "@google/generative-ai";

// =============================================================================
// Types
// =============================================================================

interface PilotConfig {
  app_id: string;
  skills: string[];
  tools_manifest: ToolManifest[];
  instructions?: string;
  model?: string;
  ui_config?: {
    welcome_message?: string;
  };
}

interface ToolManifest {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface AppContext {
  appId: string | null;
  containerId: string | null;
  containerName: string | null;
  canvasId: string | null;
  pageUrl: string;
}

// Message types
type IncomingMessage =
  | { type: "CHAT_REQUEST"; message: string; context: AppContext }
  | { type: "SWITCH_APP"; appId: string }
  | { type: "GET_CONFIG" }
  | { type: "TOOL_RESULT"; toolName: string; result: unknown }
  | { type: "CONTEXT_UPDATE"; context: AppContext }
  | {
      type: "AUTH_UPDATED";
      authToken: string | null;
      geminiKey: string | null;
    };

// =============================================================================
// State
// =============================================================================

let genAI: GoogleGenerativeAI | null = null;
let model: GenerativeModel | null = null;
let chat: ChatSession | null = null;
let config: PilotConfig | null = null;
let currentContext: AppContext | null = null;
let pendingToolCall: { name: string; args: Record<string, unknown> } | null =
  null;

const API_BASE_URL = "http://localhost:8000";

// =============================================================================
// Chrome Storage Helpers
// =============================================================================

async function getApiKey(): Promise<string | null> {
  const result = await chrome.storage.local.get("geminiApiKey");
  return result.geminiApiKey || null;
}

async function getAuthToken(): Promise<string | null> {
  const result = await chrome.storage.local.get("authToken");
  return result.authToken || null;
}

// =============================================================================
// PilotConfig Fetching
// =============================================================================

async function fetchPilotConfig(token: string): Promise<PilotConfig> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/pilot-config`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch pilot config: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.warn("[Worker] Failed to fetch config, using fallback:", error);
    return getDefaultConfig();
  }
}

function getDefaultConfig(): PilotConfig {
  return {
    app_id: "container_app",
    skills: [],
    tools_manifest: [
      {
        name: "createContainer",
        description: "Create a new container",
        parameters: {
          name: { type: "string" },
          description: { type: "string" },
        },
      },
      {
        name: "createCanvas",
        description: "Create a new canvas in a container",
        parameters: {
          containerId: { type: "string" },
          name: { type: "string" },
        },
      },
      {
        name: "navigateToContainer",
        description: "Navigate to a specific container",
        parameters: { containerId: { type: "string" } },
      },
    ],
    instructions:
      "You are the Collider Pilot, helping users manage containers and canvases.",
    model: "gemini-2.0-flash",
    ui_config: {
      welcome_message:
        "👋 Hi! I'm your Collider Pilot. I can help you create containers, canvases, and navigate your workspace.",
    },
  };
}

// =============================================================================
// System Prompt Builder
// =============================================================================

function buildSystemPrompt(): string {
  if (!config) return "";

  let prompt = config.instructions || "You are the Collider Pilot.\n";

  // Inject skills
  if (config.skills && config.skills.length > 0) {
    prompt += "\n\n# YOUR SKILLS (JOB TRAINING)\n";
    prompt += config.skills.join("\n\n---\n\n");
  }

  // Inject tools manifest
  if (config.tools_manifest && config.tools_manifest.length > 0) {
    prompt += "\n\n# AVAILABLE TOOLS\n";
    prompt +=
      "You can execute actions by responding with a tool call in this format:\n";
    prompt +=
      '```tool\n{"name": "toolName", "args": {"param": "value"}}\n```\n\n';
    prompt += "Available tools:\n";
    for (const tool of config.tools_manifest) {
      prompt += `- **${tool.name}**: ${tool.description}\n`;
      prompt += `  Parameters: ${JSON.stringify(tool.parameters)}\n`;
    }
  }

  // Inject current context
  if (currentContext) {
    prompt += "\n\n# CURRENT CONTEXT\n";
    if (currentContext.appId) {
      prompt += `- Current App ID: ${currentContext.appId}\n`;
    }
    if (currentContext.containerName) {
      prompt += `- Current container: ${currentContext.containerName} (ID: ${currentContext.containerId})\n`;
    }
    if (currentContext.canvasId) {
      prompt += `- Current canvas ID: ${currentContext.canvasId}\n`;
    }
    if (currentContext.pageUrl) {
      prompt += `- Page URL: ${currentContext.pageUrl}\n`;
    }
  }

  return prompt;
}

// =============================================================================
// Model Initialization
// =============================================================================

async function initializeModel(apiKey: string): Promise<void> {
  genAI = new GoogleGenerativeAI(apiKey);

  const systemInstruction = buildSystemPrompt();

  model = genAI.getGenerativeModel({
    model: config?.model || "gemini-2.0-flash",
    systemInstruction,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
    },
  });

  // Reset chat on model change
  chat = null;
}

function rebuildModel(): void {
  if (!genAI || !config) return;

  const systemInstruction = buildSystemPrompt();

  model = genAI.getGenerativeModel({
    model: config.model || "gemini-2.0-flash",
    systemInstruction,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
    },
  });

  chat = null;
}

// =============================================================================
// Tool Parsing
// =============================================================================

function parseToolCall(
  text: string,
): { name: string; args: Record<string, unknown> } | null {
  // Look for ```tool blocks
  const toolMatch = text.match(/```tool\s*\n?([\s\S]*?)\n?```/);
  if (toolMatch) {
    try {
      return JSON.parse(toolMatch[1].trim());
    } catch {
      console.warn("[Worker] Failed to parse tool call JSON");
    }
  }

  // Also try inline JSON pattern
  const inlineMatch = text.match(/\{["\s]*name["\s]*:[^}]+\}/);
  if (inlineMatch) {
    try {
      const parsed = JSON.parse(inlineMatch[0]);
      if (parsed.name && parsed.args) {
        return parsed;
      }
    } catch {
      // Not valid JSON
    }
  }

  return null;
}

// =============================================================================
// Chat Handler
// =============================================================================

// Helper to broadcast messages to all extension pages (for streaming)
function broadcast(message: unknown): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Ignore errors when no listeners
  });
}

async function handleChatRequest(
  message: string,
  context: AppContext,
  _sendResponse: (msg: unknown) => void,
): Promise<void> {
  // Update context
  currentContext = context;

  // Check API key
  const apiKey = await getApiKey();
  if (!apiKey) {
    broadcast({
      type: "ERROR",
      error: "No API key configured. Open settings to add your Gemini API key.",
    });
    return;
  }

  // Ensure model is initialized
  if (!model) {
    const token = await getAuthToken();
    if (token) {
      config = await fetchPilotConfig(token);
    } else {
      config = getDefaultConfig();
    }
    await initializeModel(apiKey);
  }

  // Rebuild if context changed
  rebuildModel();

  if (!model) {
    broadcast({ type: "ERROR", error: "Failed to initialize Gemini model" });
    return;
  }

  // Get or create chat session
  if (!chat) {
    chat = model.startChat({ history: [] });
  }

  try {
    // Stream response
    const result = await chat.sendMessageStream(message);
    let fullResponse = "";

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        fullResponse += text;
        broadcast({ type: "CHAT_CHUNK", content: text });
      }
    }

    // Check for tool calls in response
    const toolCall = parseToolCall(fullResponse);
    if (toolCall) {
      pendingToolCall = toolCall;
      broadcast({
        type: "TOOL_CALL",
        name: toolCall.name,
        args: toolCall.args,
      });

      // Dispatch to content script
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: "DISPATCH_TOOL",
          name: toolCall.name,
          args: toolCall.args,
        });
      }
    }

    // Send complete signal
    broadcast({ type: "CHAT_COMPLETE", content: fullResponse });
  } catch (error) {
    console.error("[Worker] Chat error:", error);
    broadcast({ type: "ERROR", error: String(error) });
  }
}

// =============================================================================
// Message Handler
// =============================================================================

chrome.runtime.onMessage.addListener(
  (
    message: IncomingMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    // Handle async with IIFE
    (async () => {
      switch (message.type) {
        case "GET_CONFIG": {
          const apiKey = await getApiKey();
          if (!apiKey) {
            sendResponse({ type: "ERROR", error: "No API key" });
            return;
          }

          const token = await getAuthToken();
          if (token) {
            config = await fetchPilotConfig(token);
          } else {
            config = getDefaultConfig();
          }

          await initializeModel(apiKey);
          sendResponse({ type: "CONFIG_LOADED", config });
          break;
        }

        case "CHAT_REQUEST":
          await handleChatRequest(
            message.message,
            message.context,
            sendResponse,
          );
          break;

        case "CONTEXT_UPDATE":
          currentContext = message.context;
          rebuildModel();
          break;

        case "TOOL_RESULT":
          // Tool completed, clear pending
          if (pendingToolCall && pendingToolCall.name === message.toolName) {
            pendingToolCall = null;
            // Optionally feed result back to chat
            if (chat) {
              // Inject tool result as system message
              await chat.sendMessage(
                `[Tool ${message.toolName} completed with result: ${JSON.stringify(message.result)}]`,
              );
            }
          }
          break;

        case "SWITCH_APP": {
          // Re-fetch config for new app
          const token = await getAuthToken();
          if (token) {
            config = await fetchPilotConfig(token);
            rebuildModel();
            sendResponse({ type: "CONFIG_LOADED", config });
          }
          break;
        }

        case "AUTH_UPDATED": {
          // Auth tokens synced from page
          console.log("[Worker] Auth updated from page");
          if (message.geminiKey && !genAI) {
            // Initialize model with new key
            const token = message.authToken;
            if (token) {
              config = await fetchPilotConfig(token);
            } else {
              config = getDefaultConfig();
            }
            await initializeModel(message.geminiKey);
            sendResponse({ type: "CONFIG_LOADED", config });
          }
          break;
        }
      }
    })();

    // Return true to indicate async response
    return true;
  },
);

// =============================================================================
// Side Panel Behavior
// =============================================================================

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: unknown) =>
    console.error("[Worker] Side panel error:", error),
  );

// =============================================================================
// Extension Install Handler
// =============================================================================

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Collider Pilot] Extension installed");
});

console.log("[Collider Pilot] Service worker started");
