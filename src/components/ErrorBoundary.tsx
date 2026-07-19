/**
 * Collider Pilot - error boundary
 * ===============================
 * Catches render-time exceptions anywhere in the panel and shows the actual
 * error + component stack instead of a blank surface. Without this, a single
 * bad field silently blanks the side panel and only surfaces as a cryptic
 * minified stack on the extension card. (Effect-time throws — e.g. Cytoscape
 * init — are NOT caught here; FrameGraph guards those with its own try/catch.)
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  info: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info: info.componentStack ?? null });
    console.error("[pilot] render error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="pilot-state error" role="alert">
          <strong>Panel render error</strong>
          <div style={{ marginTop: 6, fontFamily: "monospace", fontSize: 11 }}>
            {String(this.state.error)}
          </div>
          {this.state.info && (
            <details style={{ marginTop: 6 }}>
              <summary>component stack</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 10 }}>
                {this.state.info}
              </pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
