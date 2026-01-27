/**
 * Collider Pilot - Side Panel UI
 * ===============================
 * React-based chat interface for the Pilot extension.
 *
 * This is the "seat" - the permanent home for the DeepAgent.
 * It communicates with the service worker for LLM calls and
 * receives tool execution results from the content script.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";

// =============================================================================
// Types
// =============================================================================

interface PilotMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  toolCall?: {
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
  };
}

interface AppContext {
  appId: string | null;
  containerId: string | null;
  containerName: string | null;
  canvasId: string | null;
  pageUrl: string;
}

interface PilotConfig {
  app_id: string;
  skills: string[];
  tools_manifest: ToolManifest[];
  ui_config?: {
    welcome_message?: string;
  };
}

interface ToolManifest {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// =============================================================================
// Message Types (Extension Communication)
// =============================================================================

type WorkerMessage =
  | { type: "CHAT_REQUEST"; message: string; context: AppContext }
  | { type: "SWITCH_APP"; appId: string }
  | { type: "GET_CONFIG" }
  | { type: "TOOL_RESULT"; toolName: string; result: unknown };

type WorkerResponse =
  | { type: "CHAT_CHUNK"; content: string }
  | { type: "CHAT_COMPLETE"; content: string }
  | { type: "TOOL_CALL"; name: string; args: Record<string, unknown> }
  | { type: "CONFIG_LOADED"; config: PilotConfig }
  | { type: "ERROR"; error: string };

// =============================================================================
// Side Panel Component
// =============================================================================

function SidePanel() {
  // State
  const [messages, setMessages] = useState<PilotMessage[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [config, setConfig] = useState<PilotConfig | null>(null);
  const [context, setContext] = useState<AppContext>({
    appId: null,
    containerId: null,
    containerName: null,
    canvasId: null,
    pageUrl: "",
  });
  const [isConnected, setIsConnected] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // Load chat history from storage
  useEffect(() => {
    chrome.storage.local.get("chatHistory").then((result) => {
      if (result.chatHistory && Array.isArray(result.chatHistory)) {
        setMessages(result.chatHistory);
      }
    });
  }, []);

  // Save chat history when messages change
  useEffect(() => {
    if (messages.length > 0) {
      // Only save last 50 messages to avoid storage limits
      const toSave = messages.slice(-50);
      chrome.storage.local.set({ chatHistory: toSave });
    }
  }, [messages]);

  // Initialize: Listen for messages from service worker
  useEffect(() => {
    const handleMessage = (message: WorkerResponse) => {
      switch (message.type) {
        case "CHAT_CHUNK":
          setStreamingContent((prev) => prev + message.content);
          break;

        case "CHAT_COMPLETE":
          setMessages((prev) => [
            ...prev,
            {
              id: `msg-${Date.now()}`,
              role: "assistant",
              content: message.content,
              timestamp: new Date().toISOString(),
            },
          ]);
          setStreamingContent("");
          setIsThinking(false);
          break;

        case "TOOL_CALL":
          // Show tool being called
          setMessages((prev) => [
            ...prev,
            {
              id: `tool-${Date.now()}`,
              role: "tool",
              content: `Executing: ${message.name}`,
              timestamp: new Date().toISOString(),
              toolCall: { name: message.name, args: message.args },
            },
          ]);
          break;

        case "CONFIG_LOADED":
          setConfig(message.config);
          setIsConnected(true);
          // Add welcome message
          if (message.config.ui_config?.welcome_message) {
            setMessages([
              {
                id: "welcome",
                role: "assistant",
                content: message.config.ui_config.welcome_message,
                timestamp: new Date().toISOString(),
              },
            ]);
          }
          break;

        case "ERROR":
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: "system",
              content: `Error: ${message.error}`,
              timestamp: new Date().toISOString(),
            },
          ]);
          setIsThinking(false);
          break;
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    // Request initial config (use callback for direct response)
    chrome.runtime.sendMessage(
      { type: "GET_CONFIG" },
      (response: WorkerResponse) => {
        if (response) {
          handleMessage(response);
        }
      },
    );

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  // Listen for context updates from content script
  useEffect(() => {
    const handleContextUpdate = (message: {
      type: string;
      context: AppContext;
    }) => {
      if (message.type === "CONTEXT_UPDATE") {
        setContext(message.context);
      }
    };

    chrome.runtime.onMessage.addListener(handleContextUpdate);
    return () => chrome.runtime.onMessage.removeListener(handleContextUpdate);
  }, []);

  // Send message
  const handleSend = useCallback(async () => {
    if (!input.trim() || isThinking) return;

    const userMessage: PilotMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: input,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsThinking(true);
    setStreamingContent("");

    // Send to service worker
    chrome.runtime.sendMessage({
      type: "CHAT_REQUEST",
      message: input,
      context,
    } as WorkerMessage);
  }, [input, isThinking, context]);

  // Save API key
  const handleSaveApiKey = useCallback(() => {
    if (apiKeyInput.trim()) {
      chrome.storage.local.set({ geminiApiKey: apiKeyInput.trim() }, () => {
        setApiKeyInput("");
        setShowSettings(false);
        // Reload config with callback
        chrome.runtime.sendMessage(
          { type: "GET_CONFIG" },
          (response: WorkerResponse) => {
            if (response?.type === "CONFIG_LOADED") {
              setConfig(response.config);
              setIsConnected(true);
            } else if (response?.type === "ERROR") {
              console.error("[SidePanel] Config error:", response.error);
            }
          },
        );
      });
    }
  }, [apiKeyInput]);

  // Clear chat history
  const handleClearHistory = useCallback(() => {
    setMessages([]);
    chrome.storage.local.remove("chatHistory");
    // Add welcome message back
    if (config?.ui_config?.welcome_message) {
      setMessages([
        {
          id: "welcome",
          role: "assistant",
          content: config.ui_config.welcome_message,
          timestamp: new Date().toISOString(),
        },
      ]);
    }
  }, [config]);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="pilot-container">
      {/* Header */}
      <header className="pilot-header">
        <div className="header-left">
          <span
            className={`status-dot ${isConnected ? "connected" : "disconnected"}`}
          />
          <h1>Collider Pilot</h1>
        </div>
        <div className="header-right">
          <button
            className="icon-btn"
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >
            ⚙️
          </button>
        </div>
      </header>

      {/* Context Bar */}
      {context.containerName && (
        <div className="context-bar">
          <span className="context-label">Context:</span>
          <span className="context-value">{context.containerName}</span>
          {context.canvasId && <span className="context-badge">Canvas</span>}
        </div>
      )}

      {/* Settings Panel */}
      {showSettings && (
        <div className="settings-panel">
          <h3>Settings</h3>
          <div className="setting-row">
            <label>Gemini API Key</label>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="Enter API key..."
            />
            <button onClick={handleSaveApiKey}>Save</button>
          </div>
          {config && (
            <div className="setting-info">
              <p>App: {config.app_id}</p>
              <p>Skills: {config.skills.length}</p>
              <p>Tools: {config.tools_manifest.length}</p>
            </div>
          )}
          <div className="setting-row">
            <button onClick={handleClearHistory} className="danger-btn">
              🗑️ Clear Chat History
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="messages-container">
        {messages.length === 0 && !streamingContent && (
          <div className="empty-state">
            <p>👋 Hi! I'm your Collider Pilot.</p>
            <p>Ask me to help manage your containers and canvases.</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            {msg.role === "tool" && msg.toolCall && (
              <div className="tool-indicator">🔧 {msg.toolCall.name}</div>
            )}
            <div className="message-content">{msg.content}</div>
          </div>
        ))}

        {streamingContent && (
          <div className="message assistant streaming">
            <div className="message-content">{streamingContent}</div>
          </div>
        )}

        {isThinking && !streamingContent && (
          <div className="message assistant thinking">
            <div className="thinking-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="input-container">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ask Pilot..."
          disabled={isThinking}
        />
        <button
          onClick={handleSend}
          disabled={isThinking || !input.trim()}
          className="send-btn"
        >
          ➤
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Mount
// =============================================================================

const root = createRoot(document.getElementById("root")!);
root.render(<SidePanel />);
