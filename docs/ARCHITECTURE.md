# Pilot Architecture

## Overview

Pilot is a browser extension that provides a cross-application "OS" layer with local AI capabilities. It observes browser state, aggregates context from all open tabs, and provides AI assistance through a floating Picture-in-Picture window.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CHROME BROWSER                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     SERVICE WORKER (MV3)                          │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────┐  │  │
│  │  │ Tab Manager │  │Event Router │  │ Context Aggregator       │  │  │
│  │  │ (chrome.    │  │ (message    │  │ - DOM snapshots          │  │  │
│  │  │  tabs API)  │  │  passing)   │  │ - Tab metadata           │  │  │
│  │  └─────────────┘  └─────────────┘  │ - History context        │  │  │
│  │                                     │ - Active selection       │  │  │
│  │  ┌─────────────────────────────┐   └──────────────────────────┘  │  │
│  │  │      Tool Router            │                                  │  │
│  │  │  - Chrome API tools         │                                  │  │
│  │  │  - Page manipulation        │                                  │  │
│  │  │  - Cross-tab coordination   │                                  │  │
│  │  └─────────────────────────────┘                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              ▲                                          │
│                              │ chrome.runtime.sendMessage               │
│                              ▼                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │   Tab 1      │  │   Tab 2      │  │   Tab 3      │                 │
│  │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │                 │
│  │ │ Content  │ │  │ │ Content  │ │  │ │ Content  │ │                 │
│  │ │ Script   │ │  │ │ Script   │ │  │ │ Script   │ │                 │
│  │ │ - DOM    │ │  │ │ - DOM    │ │  │ │ - DOM    │ │                 │
│  │ │ - Events │ │  │ │ - Events │ │  │ │ - Events │ │                 │
│  │ └──────────┘ │  │ └──────────┘ │  │ └──────────┘ │                 │
│  └──────────────┘  └──────────────┘  └──────────────┘                 │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │                    OFFSCREEN DOCUMENT                              │ │
│  │  ┌─────────────────────────────────────────────────────────────┐  │ │
│  │  │                    WebLLM Engine                             │  │ │
│  │  │  - Llama 3.1 8B Instruct (q4f16_1)                          │  │ │
│  │  │  - WebGPU acceleration                                       │  │ │
│  │  │  - Tool calling support                                      │  │ │
│  │  └─────────────────────────────────────────────────────────────┘  │ │
│  │  ┌─────────────────────────────────────────────────────────────┐  │ │
│  │  │                  Chrome Built-in AI                          │  │ │
│  │  │  - Prompt API (fallback)                                     │  │ │
│  │  │  - Summarizer API                                            │  │ │
│  │  │  - Translator API                                            │  │ │
│  │  └─────────────────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │              DOCUMENT PICTURE-IN-PICTURE WINDOW                   │ │
│  │  ┌─────────────────────────────────────────────────────────────┐  │ │
│  │  │  Floating UI                                                 │  │ │
│  │  │  - Chat interface                                            │  │ │
│  │  │  - Context preview                                           │  │ │
│  │  │  - Tool suggestions                                          │  │ │
│  │  │  - Quick actions                                             │  │ │
│  │  └─────────────────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### Service Worker (Central Orchestrator)
- Lifecycle: Runs persistently (with keep-alive patterns)
- Manages all chrome.* API access
- Routes messages between components
- Maintains global state in chrome.storage.session
- Coordinates tool execution

### Content Scripts (Per-Tab Observers)
- Injected into every allowed page
- Observes DOM via MutationObserver
- Reports page structure, text content, active element
- Listens for user selections
- Bridges page scripts to extension

### Offscreen Document (AI Compute)
- Hosts WebLLM with WebGPU access
- Persistent document (remains loaded)
- Handles inference requests from service worker
- Falls back to Chrome Built-in AI when appropriate

### Document Picture-in-Picture (UI)
- Always-on-top floating window
- Shows AI chat interface
- Displays context preview
- Offers quick action buttons
- Persists across tab navigation

## Communication Flow

```
Page Content → Content Script → Service Worker → Offscreen (WebLLM)
                                      ↓
                               Document PiP (UI)
```

1. **Context Collection**: Content scripts observe DOM, send snapshots to service worker
2. **State Aggregation**: Service worker combines all tab contexts + history + bookmarks
3. **User Interaction**: PiP window receives user input, sends to service worker
4. **AI Processing**: Service worker forwards to offscreen document for inference
5. **Tool Execution**: Service worker executes tools using chrome.* APIs
6. **Response Delivery**: Results flow back through service worker to PiP UI

## Data Flow Types

### BrowserContext (Aggregated State)
```typescript
interface BrowserContext {
  tabs: TabContext[];
  activeTab: TabContext | null;
  recentHistory: HistoryItem[];
  relevantBookmarks: Bookmark[];
  selection: string | null;
}

interface TabContext {
  id: number;
  url: string;
  title: string;
  dom: DOMSnapshot;
  scrollPosition: number;
  isActive: boolean;
}

interface DOMSnapshot {
  headings: string[];
  mainContent: string;
  links: LinkInfo[];
  forms: FormInfo[];
  timestamp: number;
}
```

### Tool Definition
```typescript
interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  handler: (params: any) => Promise<any>;
  requiresPermission?: string[];
}
```

## Key Design Decisions

### Why Offscreen Document for WebLLM?
- Service workers cannot access WebGPU
- Offscreen documents have full DOM/WebGPU access
- Can be kept alive indefinitely with `reasons: ['LOCAL_STORAGE']`
- Isolated from page content (security)

### Why Document PiP instead of Side Panel?
- Always visible across tab switches
- Doesn't consume page real estate
- Can be positioned anywhere on screen
- Better for quick interactions

### Why Local-First AI?
- Privacy: No data leaves the browser
- Speed: No network latency
- Offline: Works without internet
- Cost: No API fees
- Control: User owns the model

### Context Protocol (llms.txt inspired)
- Apps can expose `/llms.txt` for Pilot to discover capabilities
- Structured markdown format for tool/context sharing
- Fallback to DOM analysis for non-participating pages
