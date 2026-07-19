/**
 * Collider Pilot - mock MCP adapter (Phase 1)
 * ===========================================
 * Returns a fixed typed frame. No network, no credentials, no MCP session, no
 * engine, no model, no writes. Deep-clones the fixture so consumers can't mutate
 * shared module state.
 *
 * Because it is pure and stateless, it satisfies the MV3 lifecycle rule trivially:
 * a service worker restarted mid-request re-answers identically from this fixture,
 * with zero correctness-critical globals to lose.
 *
 * Phase 2 replaces this class with a StreamableHttpMcpAdapter (same `McpAdapter`
 * interface) that reads the live frame from the engine over MCP Streamable HTTP.
 */

import type { FrameRequest, HgFrame, McpAdapter } from "./types";
import { MOCK_FRAME } from "./fixture";

function clone<T>(value: T): T {
  // structuredClone is available in MV3 service workers and modern browsers.
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}

export class MockMcpAdapter implements McpAdapter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getFrame(_request?: FrameRequest): Promise<HgFrame> {
    // Phase 1 ignores the view_filter in the request: the fixture is fixed.
    // The returned provenance still advertises the filter the fixture represents.
    return clone(MOCK_FRAME);
  }
}
