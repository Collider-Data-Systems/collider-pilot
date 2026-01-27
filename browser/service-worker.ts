/**
 * Pilot Service Worker - Central Orchestrator
 * 
 * Responsibilities:
 * - Manages all chrome.* API access
 * - Routes messages between content scripts, offscreen doc, and PiP
 * - Aggregates browser context from all sources
 * - Coordinates tool execution
 * - Maintains session state
 */

import type { BrowserContext, TabContext, Message, ToolCall, ToolResult } from '../sdk/types';

// ============================================================================
// State Management
// ============================================================================

interface PilotState {
  isOffscreenReady: boolean;
  isPipOpen: boolean;
  activeTabId: number | null;
  tabContexts: Map<number, TabContext>;
  pendingToolCalls: Map<string, (result: ToolResult) => void>;
}

const state: PilotState = {
  isOffscreenReady: false,
  isPipOpen: false,
  activeTabId: null,
  tabContexts: new Map(),
  pendingToolCalls: new Map(),
};

// ============================================================================
// Offscreen Document Management
// ============================================================================

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

async function ensureOffscreenDocument(): Promise<void> {
  // Check if offscreen document exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });

  if (existingContexts.length > 0) {
    state.isOffscreenReady = true;
    return;
  }

  // Create offscreen document for WebLLM
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [
      chrome.offscreen.Reason.LOCAL_STORAGE,  // Keeps document alive
      chrome.offscreen.Reason.WORKERS,        // For WebGPU compute
    ],
    justification: 'WebLLM inference engine requires WebGPU access',
  });

  state.isOffscreenReady = true;
  console.log('[Pilot] Offscreen document created for WebLLM');
}

// ============================================================================
// Context Aggregation
// ============================================================================

async function aggregateBrowserContext(): Promise<BrowserContext> {
  // Get all tabs
  const tabs = await chrome.tabs.query({});
  const activeTab = tabs.find(t => t.active && t.windowId === (await chrome.windows.getCurrent()).id);
  
  // Get recent history (last 24 hours)
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const history = await chrome.history.search({
    text: '',
    startTime: oneDayAgo,
    maxResults: 50,
  });

  // Get bookmarks from toolbar/recent
  const bookmarkTree = await chrome.bookmarks.getTree();
  const flattenBookmarks = (nodes: chrome.bookmarks.BookmarkTreeNode[]): chrome.bookmarks.BookmarkTreeNode[] => {
    return nodes.flatMap(node => 
      node.children ? flattenBookmarks(node.children) : [node]
    ).filter(node => node.url);
  };
  const bookmarks = flattenBookmarks(bookmarkTree).slice(0, 20);

  // Get current selection from active tab (if content script reported it)
  const activeContext = state.activeTabId ? state.tabContexts.get(state.activeTabId) : null;
  const selection = activeContext?.selection || null;

  // Build tab contexts (use cached DOM snapshots from content scripts)
  const tabContexts: TabContext[] = tabs.map(tab => {
    const cached = state.tabContexts.get(tab.id!);
    return {
      id: tab.id!,
      url: tab.url || '',
      title: tab.title || '',
      isActive: tab.active || false,
      dom: cached?.dom || null,
      scrollPosition: cached?.scrollPosition || 0,
      selection: cached?.selection || null,
    };
  });

  return {
    tabs: tabContexts,
    activeTab: tabContexts.find(t => t.isActive) || null,
    recentHistory: history.map(h => ({
      url: h.url!,
      title: h.title || '',
      lastVisit: h.lastVisitTime || 0,
      visitCount: h.visitCount || 0,
    })),
    relevantBookmarks: bookmarks.map(b => ({
      id: b.id,
      url: b.url!,
      title: b.title,
    })),
    selection,
  };
}

// ============================================================================
// Message Handling
// ============================================================================

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message: Message, sender: chrome.runtime.MessageSender): Promise<any> {
  switch (message.type) {
    // From content scripts
    case 'DOM_SNAPSHOT':
      if (sender.tab?.id) {
        state.tabContexts.set(sender.tab.id, {
          id: sender.tab.id,
          url: sender.tab.url || '',
          title: sender.tab.title || '',
          isActive: sender.tab.active || false,
          dom: message.payload.snapshot,
          scrollPosition: message.payload.scrollPosition,
          selection: message.payload.selection,
        });
      }
      return { success: true };

    case 'SELECTION_CHANGED':
      if (sender.tab?.id) {
        const existing = state.tabContexts.get(sender.tab.id);
        if (existing) {
          existing.selection = message.payload.selection;
        }
      }
      return { success: true };

    // From PiP window
    case 'GET_CONTEXT':
      return await aggregateBrowserContext();

    case 'CHAT_MESSAGE':
      return await handleChatMessage(message.payload);

    case 'EXECUTE_TOOL':
      return await executeTool(message.payload.tool, message.payload.params);

    // From offscreen document
    case 'LLM_READY':
      state.isOffscreenReady = true;
      console.log('[Pilot] WebLLM ready');
      return { success: true };

    case 'TOOL_CALL':
      // LLM requested a tool call
      const result = await executeTool(message.payload.name, message.payload.arguments);
      return result;

    default:
      console.warn('[Pilot] Unknown message type:', message.type);
      return { error: 'Unknown message type' };
  }
}

// ============================================================================
// Chat Processing
// ============================================================================

async function handleChatMessage(payload: { message: string; context?: BrowserContext }): Promise<any> {
  await ensureOffscreenDocument();

  // Get fresh context if not provided
  const context = payload.context || await aggregateBrowserContext();

  // Send to offscreen document for LLM inference
  const response = await chrome.runtime.sendMessage({
    type: 'INFERENCE_REQUEST',
    payload: {
      message: payload.message,
      context: context,
      tools: getAvailableTools(),
    },
  });

  return response;
}

// ============================================================================
// Tool System
// ============================================================================

function getAvailableTools(): any[] {
  return [
    {
      name: 'navigate_to_tab',
      description: 'Switch to a specific browser tab',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: 'The tab ID to switch to' },
        },
        required: ['tabId'],
      },
    },
    {
      name: 'open_url',
      description: 'Open a URL in a new tab or the current tab',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to open' },
          newTab: { type: 'boolean', description: 'Whether to open in a new tab', default: true },
        },
        required: ['url'],
      },
    },
    {
      name: 'search_history',
      description: 'Search browser history for pages matching a query',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Maximum results to return', default: 10 },
        },
        required: ['query'],
      },
    },
    {
      name: 'search_bookmarks',
      description: 'Search bookmarks for pages matching a query',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_page_content',
      description: 'Get the text content of a specific tab',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: 'The tab ID to get content from' },
        },
        required: ['tabId'],
      },
    },
    {
      name: 'scroll_page',
      description: 'Scroll the active page up, down, or to a specific position',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] },
          amount: { type: 'number', description: 'Pixels to scroll (for up/down)' },
        },
        required: ['direction'],
      },
    },
    {
      name: 'click_element',
      description: 'Click an element on the page identified by selector',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for the element' },
        },
        required: ['selector'],
      },
    },
    {
      name: 'fill_input',
      description: 'Fill a form input with a value',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for the input' },
          value: { type: 'string', description: 'Value to fill' },
        },
        required: ['selector', 'value'],
      },
    },
    {
      name: 'summarize_tab',
      description: 'Use Chrome Built-in Summarizer to summarize tab content',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: 'The tab ID to summarize' },
        },
        required: ['tabId'],
      },
    },
    {
      name: 'create_tab_group',
      description: 'Group specified tabs together',
      parameters: {
        type: 'object',
        properties: {
          tabIds: { type: 'array', items: { type: 'number' }, description: 'Tab IDs to group' },
          title: { type: 'string', description: 'Group title' },
          color: { type: 'string', enum: ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'] },
        },
        required: ['tabIds'],
      },
    },
  ];
}

async function executeTool(name: string, params: any): Promise<ToolResult> {
  try {
    switch (name) {
      case 'navigate_to_tab': {
        await chrome.tabs.update(params.tabId, { active: true });
        const tab = await chrome.tabs.get(params.tabId);
        await chrome.windows.update(tab.windowId, { focused: true });
        return { success: true, result: `Switched to tab: ${tab.title}` };
      }

      case 'open_url': {
        if (params.newTab) {
          const tab = await chrome.tabs.create({ url: params.url });
          return { success: true, result: `Opened ${params.url} in new tab (id: ${tab.id})` };
        } else {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          await chrome.tabs.update(activeTab.id!, { url: params.url });
          return { success: true, result: `Navigated to ${params.url}` };
        }
      }

      case 'search_history': {
        const results = await chrome.history.search({
          text: params.query,
          maxResults: params.maxResults || 10,
        });
        return { 
          success: true, 
          result: results.map(r => ({ url: r.url, title: r.title, lastVisit: r.lastVisitTime }))
        };
      }

      case 'search_bookmarks': {
        const results = await chrome.bookmarks.search(params.query);
        return {
          success: true,
          result: results.filter(b => b.url).map(b => ({ url: b.url, title: b.title }))
        };
      }

      case 'get_page_content': {
        const cached = state.tabContexts.get(params.tabId);
        if (cached?.dom) {
          return { success: true, result: cached.dom };
        }
        // Request fresh content from content script
        const response = await chrome.tabs.sendMessage(params.tabId, { type: 'GET_FULL_CONTENT' });
        return { success: true, result: response };
      }

      case 'scroll_page': {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.tabs.sendMessage(activeTab.id!, {
          type: 'SCROLL',
          payload: { direction: params.direction, amount: params.amount },
        });
        return { success: true, result: `Scrolled ${params.direction}` };
      }

      case 'click_element': {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const result = await chrome.tabs.sendMessage(activeTab.id!, {
          type: 'CLICK',
          payload: { selector: params.selector },
        });
        return result;
      }

      case 'fill_input': {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const result = await chrome.tabs.sendMessage(activeTab.id!, {
          type: 'FILL_INPUT',
          payload: { selector: params.selector, value: params.value },
        });
        return result;
      }

      case 'summarize_tab': {
        // Use Chrome Built-in Summarizer API
        const cached = state.tabContexts.get(params.tabId);
        if (!cached?.dom?.mainContent) {
          return { success: false, error: 'No content available for summarization' };
        }
        
        // Forward to offscreen document which has access to AI APIs
        const response = await chrome.runtime.sendMessage({
          type: 'SUMMARIZE',
          payload: { content: cached.dom.mainContent },
        });
        return response;
      }

      case 'create_tab_group': {
        const groupId = await chrome.tabs.group({ tabIds: params.tabIds });
        if (params.title || params.color) {
          await chrome.tabGroups.update(groupId, {
            title: params.title,
            color: params.color,
          });
        }
        return { success: true, result: `Created tab group "${params.title || 'Untitled'}" with ${params.tabIds.length} tabs` };
      }

      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ============================================================================
// Event Listeners
// ============================================================================

// Track active tab changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  state.activeTabId = activeInfo.tabId;
  console.log('[Pilot] Active tab changed:', activeInfo.tabId);
});

// Clean up when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  state.tabContexts.delete(tabId);
});

// Handle extension icon click - toggle PiP window
chrome.action.onClicked.addListener(async (tab) => {
  if (state.isPipOpen) {
    // Close PiP via content script
    await chrome.tabs.sendMessage(tab.id!, { type: 'CLOSE_PIP' });
    state.isPipOpen = false;
  } else {
    // Open PiP via content script (PiP must be user-initiated)
    await chrome.tabs.sendMessage(tab.id!, { type: 'OPEN_PIP' });
    state.isPipOpen = true;
  }
});

// Keyboard shortcut handling
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle_pip') {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) {
      if (state.isPipOpen) {
        await chrome.tabs.sendMessage(activeTab.id, { type: 'CLOSE_PIP' });
        state.isPipOpen = false;
      } else {
        await chrome.tabs.sendMessage(activeTab.id, { type: 'OPEN_PIP' });
        state.isPipOpen = true;
      }
    }
  }
});

// ============================================================================
// Initialization
// ============================================================================

async function initialize(): Promise<void> {
  console.log('[Pilot] Service worker starting...');
  
  // Get current active tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id) {
    state.activeTabId = activeTab.id;
  }

  // Pre-warm offscreen document (for faster first inference)
  await ensureOffscreenDocument();
  
  console.log('[Pilot] Service worker ready');
}

// Service worker keep-alive pattern
const KEEP_ALIVE_INTERVAL = 20000; // 20 seconds

function keepAlive(): void {
  setInterval(() => {
    // Ping storage to keep service worker active
    chrome.storage.session.get('keepAlive').then(() => {
      chrome.storage.session.set({ keepAlive: Date.now() });
    });
  }, KEEP_ALIVE_INTERVAL);
}

initialize();
keepAlive();
