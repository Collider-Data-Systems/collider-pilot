/**
 * Pilot Content Script - Per-Tab DOM Observer
 * 
 * Responsibilities:
 * - Observes DOM changes via MutationObserver
 * - Reports page structure and content to service worker
 * - Tracks user selection
 * - Handles commands from service worker (scroll, click, fill)
 * - Manages Picture-in-Picture window lifecycle
 */

import type { DOMSnapshot, Message } from '../sdk/types';

// ============================================================================
// State
// ============================================================================

interface ContentState {
  observer: MutationObserver | null;
  lastSnapshot: DOMSnapshot | null;
  lastSnapshotTime: number;
  pipWindow: Window | null;
  debounceTimer: number | null;
}

const state: ContentState = {
  observer: null,
  lastSnapshot: null,
  lastSnapshotTime: 0,
  pipWindow: null,
  debounceTimer: null,
};

// Debounce interval for DOM snapshots (ms)
const SNAPSHOT_DEBOUNCE = 1000;

// ============================================================================
// DOM Snapshot Creation
// ============================================================================

function createDOMSnapshot(): DOMSnapshot {
  // Extract headings
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .map(h => h.textContent?.trim() || '')
    .filter(Boolean)
    .slice(0, 20);

  // Extract main content (simplified)
  const mainContent = extractMainContent();

  // Extract links
  const links = Array.from(document.querySelectorAll('a[href]'))
    .map(a => ({
      text: a.textContent?.trim() || '',
      href: (a as HTMLAnchorElement).href,
      isExternal: !(a as HTMLAnchorElement).href.startsWith(window.location.origin),
    }))
    .filter(l => l.text && l.href)
    .slice(0, 50);

  // Extract forms
  const forms = Array.from(document.querySelectorAll('form'))
    .map(form => ({
      id: form.id,
      action: form.action,
      method: form.method,
      inputs: Array.from(form.querySelectorAll('input, select, textarea'))
        .map(input => ({
          name: (input as HTMLInputElement).name,
          type: (input as HTMLInputElement).type || 'text',
          placeholder: (input as HTMLInputElement).placeholder,
          value: (input as HTMLInputElement).type === 'password' ? '' : (input as HTMLInputElement).value,
        }))
        .filter(i => i.name)
        .slice(0, 10),
    }))
    .slice(0, 5);

  // Get interactive elements
  const interactiveElements = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'))
    .map(el => ({
      tag: el.tagName.toLowerCase(),
      text: el.textContent?.trim() || (el as HTMLInputElement).value || '',
      selector: generateSelector(el),
    }))
    .filter(e => e.text)
    .slice(0, 20);

  return {
    url: window.location.href,
    title: document.title,
    headings,
    mainContent,
    links,
    forms,
    interactiveElements,
    timestamp: Date.now(),
  };
}

function extractMainContent(): string {
  // Try common main content containers
  const mainSelectors = [
    'main',
    'article',
    '[role="main"]',
    '#content',
    '.content',
    '#main',
    '.main',
  ];

  let mainElement: Element | null = null;
  for (const selector of mainSelectors) {
    mainElement = document.querySelector(selector);
    if (mainElement) break;
  }

  if (!mainElement) {
    mainElement = document.body;
  }

  // Clone to avoid modifying the page
  const clone = mainElement.cloneNode(true) as Element;

  // Remove script, style, nav, header, footer, aside elements
  const removeSelectors = 'script, style, nav, header, footer, aside, .nav, .header, .footer, .sidebar, [role="navigation"], [role="banner"], [role="contentinfo"]';
  clone.querySelectorAll(removeSelectors).forEach(el => el.remove());

  // Get text content
  const text = clone.textContent || '';
  
  // Clean up whitespace and truncate
  const cleaned = text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 10000); // Limit to ~10KB

  return cleaned;
}

function generateSelector(element: Element): string {
  // Generate a unique CSS selector for an element
  if (element.id) {
    return `#${element.id}`;
  }

  // Try class-based selector
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(' ').filter(Boolean).slice(0, 2).join('.');
    if (classes) {
      const selector = `${element.tagName.toLowerCase()}.${classes}`;
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    }
  }

  // Fallback to nth-child path
  const path: string[] = [];
  let current: Element | null = element;
  
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children).filter(
        c => c.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }
    path.unshift(selector);
    current = current.parentElement;
  }

  return path.join(' > ');
}

// ============================================================================
// Snapshot Reporting
// ============================================================================

function reportSnapshot(): void {
  // Debounce
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
  }

  state.debounceTimer = window.setTimeout(() => {
    const snapshot = createDOMSnapshot();
    state.lastSnapshot = snapshot;
    state.lastSnapshotTime = Date.now();

    // Send to service worker
    chrome.runtime.sendMessage({
      type: 'DOM_SNAPSHOT',
      payload: {
        snapshot,
        scrollPosition: window.scrollY,
        selection: window.getSelection()?.toString() || null,
      },
    });
  }, SNAPSHOT_DEBOUNCE);
}

// ============================================================================
// Selection Tracking
// ============================================================================

function handleSelectionChange(): void {
  const selection = window.getSelection()?.toString();
  if (selection && selection.length > 0) {
    chrome.runtime.sendMessage({
      type: 'SELECTION_CHANGED',
      payload: { selection },
    });
  }
}

// ============================================================================
// Message Handling (from Service Worker)
// ============================================================================

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true;
});

async function handleMessage(message: Message): Promise<any> {
  switch (message.type) {
    case 'GET_FULL_CONTENT':
      return createDOMSnapshot();

    case 'SCROLL':
      handleScroll(message.payload);
      return { success: true };

    case 'CLICK':
      return handleClick(message.payload);

    case 'FILL_INPUT':
      return handleFillInput(message.payload);

    case 'OPEN_PIP':
      return await openPictureInPicture();

    case 'CLOSE_PIP':
      closePictureInPicture();
      return { success: true };

    default:
      return { error: 'Unknown message type' };
  }
}

// ============================================================================
// Action Handlers
// ============================================================================

function handleScroll(payload: { direction: string; amount?: number }): void {
  const amount = payload.amount || 500;

  switch (payload.direction) {
    case 'up':
      window.scrollBy({ top: -amount, behavior: 'smooth' });
      break;
    case 'down':
      window.scrollBy({ top: amount, behavior: 'smooth' });
      break;
    case 'top':
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    case 'bottom':
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      break;
  }
}

function handleClick(payload: { selector: string }): { success: boolean; error?: string } {
  const element = document.querySelector(payload.selector);
  if (!element) {
    return { success: false, error: `Element not found: ${payload.selector}` };
  }

  if (element instanceof HTMLElement) {
    element.click();
    return { success: true };
  }

  return { success: false, error: 'Element is not clickable' };
}

function handleFillInput(payload: { selector: string; value: string }): { success: boolean; error?: string } {
  const element = document.querySelector(payload.selector);
  if (!element) {
    return { success: false, error: `Element not found: ${payload.selector}` };
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.value = payload.value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true };
  }

  return { success: false, error: 'Element is not an input' };
}

// ============================================================================
// Picture-in-Picture Window
// ============================================================================

async function openPictureInPicture(): Promise<{ success: boolean; error?: string }> {
  // Check if Document PiP is supported (Chrome 130+)
  if (!('documentPictureInPicture' in window)) {
    return { success: false, error: 'Document Picture-in-Picture not supported' };
  }

  try {
    // Request PiP window
    const pipWindow = await (window as any).documentPictureInPicture.requestWindow({
      width: 400,
      height: 600,
      disallowReturnToOpener: false,
    });

    state.pipWindow = pipWindow;

    // Copy styles to PiP window
    const styles = Array.from(document.styleSheets)
      .filter(sheet => {
        try {
          return sheet.href?.startsWith(chrome.runtime.getURL(''));
        } catch {
          return false;
        }
      });

    // Inject Pilot UI into PiP window
    const pipDocument = pipWindow.document;
    
    // Add base styles
    const styleEl = pipDocument.createElement('style');
    styleEl.textContent = `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: #1a1a2e;
        color: #e0e0e0;
        height: 100vh;
        display: flex;
        flex-direction: column;
      }
      .pilot-header {
        background: #16213e;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 8px;
        border-bottom: 1px solid #0f3460;
      }
      .pilot-header h1 {
        font-size: 14px;
        font-weight: 600;
      }
      .pilot-chat {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
      }
      .pilot-input-area {
        padding: 16px;
        border-top: 1px solid #0f3460;
        background: #16213e;
      }
      .pilot-input {
        width: 100%;
        background: #1a1a2e;
        border: 1px solid #0f3460;
        border-radius: 8px;
        padding: 12px;
        color: #e0e0e0;
        font-size: 14px;
        resize: none;
      }
      .pilot-input:focus {
        outline: none;
        border-color: #e94560;
      }
      .pilot-message {
        margin-bottom: 12px;
        padding: 12px;
        border-radius: 8px;
      }
      .pilot-message.user {
        background: #0f3460;
        margin-left: 24px;
      }
      .pilot-message.assistant {
        background: #16213e;
        margin-right: 24px;
      }
      .pilot-context {
        font-size: 12px;
        color: #888;
        padding: 8px 12px;
        background: #0f0f1a;
        border-radius: 4px;
        margin-bottom: 12px;
      }
    `;
    pipDocument.head.appendChild(styleEl);

    // Add UI structure
    pipDocument.body.innerHTML = `
      <div class="pilot-header">
        <span>🚀</span>
        <h1>Pilot</h1>
      </div>
      <div class="pilot-chat" id="pilot-chat">
        <div class="pilot-context" id="pilot-context">
          Watching: <strong id="pilot-page-title">${document.title}</strong>
        </div>
      </div>
      <div class="pilot-input-area">
        <textarea 
          class="pilot-input" 
          id="pilot-input"
          placeholder="Ask me anything about this page..."
          rows="2"
        ></textarea>
      </div>
    `;

    // Handle input
    const input = pipDocument.getElementById('pilot-input') as HTMLTextAreaElement;
    input?.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const message = input.value.trim();
        if (message) {
          input.value = '';
          await sendChatMessage(message, pipDocument);
        }
      }
    });

    // Handle PiP window close
    pipWindow.addEventListener('pagehide', () => {
      state.pipWindow = null;
      chrome.runtime.sendMessage({ type: 'PIP_CLOSED' });
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

function closePictureInPicture(): void {
  if (state.pipWindow) {
    state.pipWindow.close();
    state.pipWindow = null;
  }
}

async function sendChatMessage(message: string, pipDocument: Document): Promise<void> {
  const chatContainer = pipDocument.getElementById('pilot-chat');
  if (!chatContainer) return;

  // Add user message
  const userMsg = pipDocument.createElement('div');
  userMsg.className = 'pilot-message user';
  userMsg.textContent = message;
  chatContainer.appendChild(userMsg);

  // Add loading indicator
  const loadingMsg = pipDocument.createElement('div');
  loadingMsg.className = 'pilot-message assistant';
  loadingMsg.textContent = '...';
  chatContainer.appendChild(loadingMsg);

  // Scroll to bottom
  chatContainer.scrollTop = chatContainer.scrollHeight;

  try {
    // Send to service worker
    const response = await chrome.runtime.sendMessage({
      type: 'CHAT_MESSAGE',
      payload: { message },
    });

    // Update with response
    loadingMsg.textContent = response.text || response.error || 'No response';
  } catch (error) {
    loadingMsg.textContent = `Error: ${error}`;
  }

  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ============================================================================
// MutationObserver Setup
// ============================================================================

function setupObserver(): void {
  state.observer = new MutationObserver((mutations) => {
    // Filter out insignificant mutations
    const significantMutation = mutations.some(m => {
      // Ignore our own PiP-related changes
      if ((m.target as Element).closest?.('[data-pilot]')) return false;
      
      // Check for meaningful DOM changes
      if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
        return true;
      }
      if (m.type === 'characterData') {
        return true;
      }
      return false;
    });

    if (significantMutation) {
      reportSnapshot();
    }
  });

  state.observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

// ============================================================================
// Initialization
// ============================================================================

function initialize(): void {
  console.log('[Pilot] Content script initializing...');

  // Initial snapshot
  reportSnapshot();

  // Set up observers
  setupObserver();

  // Track selection changes
  document.addEventListener('selectionchange', handleSelectionChange);

  // Track scroll position
  let scrollTimeout: number;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = window.setTimeout(() => {
      chrome.runtime.sendMessage({
        type: 'DOM_SNAPSHOT',
        payload: {
          snapshot: state.lastSnapshot,
          scrollPosition: window.scrollY,
          selection: window.getSelection()?.toString() || null,
        },
      });
    }, 200);
  });

  console.log('[Pilot] Content script ready');
}

// Wait for DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
