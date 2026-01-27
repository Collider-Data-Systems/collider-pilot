# Collider Pilot - Chrome Extension

Universal "Pilot Seat" for DeepAgent - a first-class citizen AI companion.

## Development Setup

### 1. Build the extension

```bash
cd frontend
npm run build:extension
```

This outputs to `dist-extension/`.

### 2. Load in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `dist-extension/` folder

### 3. Watch mode (development)

```bash
npm run dev:extension
```

This rebuilds on file changes. You'll need to manually reload the extension in Chrome after changes.

## Architecture

```
extension/
├── manifest.json      # Chrome Extension manifest (MV3)
├── sidepanel.html     # Side Panel entry point
├── sidepanel.tsx      # React UI for chat interface
├── sidepanel.css      # Dark theme styling
├── worker.ts          # Service Worker (Gemini SDK, PilotConfig)
├── content.ts         # Bridge script (page ↔ extension)
└── icons/             # Extension icons (PNG required)
```

## Communication Flow

```
┌─────────────────┐     postMessage      ┌─────────────────┐
│   Web Page      │◄────────────────────►│  Content Script │
│ (colliderBridge)│                      │   (content.ts)  │
└─────────────────┘                      └────────┬────────┘
                                                  │
                                    chrome.runtime│
                                                  │
┌─────────────────┐     chrome.runtime   ┌────────▼────────┐
│   Side Panel    │◄────────────────────►│  Service Worker │
│ (sidepanel.tsx) │                      │   (worker.ts)   │
└─────────────────┘                      └─────────────────┘
                                                  │
                                                  ▼
                                         ┌─────────────────┐
                                         │   Gemini API    │
                                         │   Backend API   │
                                         └─────────────────┘
```

## Tool Execution

1. User sends message in Side Panel
2. Service Worker calls Gemini API
3. If response contains `\`\`\`tool` block, parse it
4. Send `DISPATCH_TOOL` to content script
5. Content script forwards to `window.colliderBridge`
6. Bridge calls Zustand action
7. Result flows back up the chain

## Icons

Chrome requires PNG icons. For development, you can:

1. **Use placeholder SVGs converted to PNG** - Use any image editor or online converter
2. **Generate with ImageMagick**:
   ```bash
   for size in 16 32 48 128; do
     magick -size ${size}x${size} xc:#6366f1 -fill white -gravity center \
       -font Arial-Bold -pointsize $((size/2)) -annotate 0 "P" \
       icons/pilot-${size}.png
   done
   ```

## API Key Setup

1. Click extension icon to open Side Panel
2. Click ⚙️ settings
3. Enter your Gemini API key
4. Key is stored in `chrome.storage.local` (device-only, secure)

## Future Improvements

- [ ] Sync API key via `chrome.storage.sync`
- [ ] OAuth integration for auth token
- [ ] Tool confirmation dialogs
- [ ] History persistence
- [ ] Multiple conversation threads
