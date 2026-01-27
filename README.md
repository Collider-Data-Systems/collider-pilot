# Collider Pilot - Cross-Application Browser OS

> A browser-native AI assistant that runs locally (WebLLM) with full browser state awareness.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      PILOT RUNTIME                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Service Worker (Orchestrator)                │   │
│  │  ┌────────────────┐  ┌────────────────────────────────┐  │   │
│  │  │   WebLLM       │  │   Context Aggregator           │  │   │
│  │  │   (Local AI)   │  │   - Tab state                  │  │   │
│  │  │                │  │   - History                    │  │   │
│  │  │   Llama 3.1 8B │  │   - DOM summaries              │  │   │
│  │  │   or Gemini    │  │   - User context               │  │   │
│  │  └────────────────┘  └────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│         ┌────────────────────┼────────────────────┐             │
│         ▼                    ▼                    ▼             │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐     │
│  │   Content   │      │    Side     │      │  Offscreen  │     │
│  │   Scripts   │      │    Panel    │      │  Document   │     │
│  │             │      │    (UI)     │      │  (DOM Ops)  │     │
│  │ Per-tab DOM │      │  React Chat │      │  Parsing    │     │
│  │ observation │      │  interface  │      │  Clipboard  │     │
│  └─────────────┘      └─────────────┘      └─────────────┘     │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Document Picture-in-Picture                  │   │
│  │              (Always-on-top floating UI)                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
pilot/
├── README.md                    # This file
├── ARCHITECTURE.md              # Deep dive on runtime design
├── llms.txt                     # Machine-readable project context
│
├── browser/                     # Chrome extension runtime
│   ├── manifest.json            # Extension manifest v3
│   ├── service-worker.ts        # Central orchestrator
│   ├── content-script.ts        # Per-tab DOM observer
│   ├── offscreen.html           # DOM operations document
│   ├── offscreen.ts             # Offscreen script
│   ├── sidepanel.html           # Side panel UI
│   ├── sidepanel.tsx            # Side panel React app
│   └── pip/                     # Picture-in-Picture UI
│       ├── pip-controller.ts    # PiP window management
│       └── pip-ui.tsx           # Floating UI component
│
├── runtime/                     # AI runtime layer
│   ├── webllm-engine.ts         # Local LLM (WebLLM)
│   ├── chrome-ai.ts             # Chrome built-in AI fallback
│   ├── context-aggregator.ts    # Browser state collector
│   └── tool-router.ts           # Tool dispatch system
│
├── sdk/                         # Integration SDK
│   ├── types.ts                 # Shared TypeScript types
│   ├── pilot-bridge.ts          # Page ↔ Extension bridge
│   └── llms-txt-parser.ts       # llms.txt protocol parser
│
└── docs/                        # Documentation
    ├── context-protocol.md      # How apps provide context
    ├── tool-protocol.md         # Tool definition format
    └── chrome-apis.md           # Browser API reference
```

## Quick Start

```bash
cd pilot/browser
npm install
npm run build
# Load dist/ as unpacked extension in chrome://extensions
```

## Browser APIs Used

| API                | Permission  | Purpose                 |
| ------------------ | ----------- | ----------------------- |
| `chrome.tabs`      | `tabs`      | Tab state, navigation   |
| `chrome.history`   | `history`   | Recent browsing context |
| `chrome.storage`   | `storage`   | Persist pilot state     |
| `chrome.scripting` | `scripting` | Inject content scripts  |
| `chrome.sidePanel` | `sidePanel` | Persistent UI           |
| `chrome.offscreen` | `offscreen` | DOM parsing             |
| `chrome.identity`  | `identity`  | User authentication     |

## AI Backends

1. **WebLLM (Primary)** - Local inference, 12GB VRAM
   - Llama 3.1 8B (quality)
   - Phi-4 mini (fast)
   - DeepSeek-R1-Distill (reasoning)

2. **Chrome Built-in AI (Fallback)** - Gemini Nano
   - Summarizer API
   - Prompt API (extensions)

3. **Server (Optional)** - For complex tasks
   - Pydantic AI backend
   - Large context windows
