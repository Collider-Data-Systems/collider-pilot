/**
 * Collider Pilot - Document PiP CONTENT preview harness (dev/test only)
 * =====================================================================
 * Renders the REAL PiP content view (`PipContent` — the same lean PostureStrip +
 * FrameGraph the Document PiP window shows) as a normal served page,
 * so it can be browser-tested WITHOUT a real PiP window (which requires a user gesture
 * and a loaded extension). Same pattern as `preview.html`: it feeds `PipContent` a
 * frame from the MOCK adapter and manages selection with local React state — precisely
 * the part the shared-scratch sync supplies inside a real extension.
 *
 * Not shipped in the extension: a fifth vite entry (pip-preview.html) for local/CI use.
 */

import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { HgFrame } from "./mcp/types";
import { MockMcpAdapter } from "./mcp/mock-adapter";
import { PipContent } from "./pip/pip-content";
import "./sidepanel.css";

const adapter = new MockMcpAdapter();

function PipPreview() {
  const [frame, setFrame] = useState<HgFrame | null>(null);
  const [selectedUrn, setSelectedUrn] = useState<string | null>(null);

  useEffect(() => {
    void adapter.getFrame().then((f) => {
      setFrame(f);
      setSelectedUrn((prev) =>
        prev && f.nodes.some((n) => n.urn === prev) ? prev : null,
      );
    });
  }, []);

  const onSelect = useCallback((urn: string | null) => setSelectedUrn(urn), []);

  return (
    <PipContent
      frame={frame}
      selectedUrn={selectedUrn}
      onSelect={onSelect}
      connected={frame != null}
      variant="preview"
    />
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <ErrorBoundary>
      <PipPreview />
    </ErrorBoundary>,
  );
}
