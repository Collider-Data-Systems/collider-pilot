/**
 * Collider Pilot - live MCP read adapter (Phase 2)
 * ================================================
 * `StreamableHttpMcpAdapter implements McpAdapter`. It reads a LIVE, purpose-selected,
 * timestamped HG frame from the Z440 primary engine over MCP Streamable HTTP, with the
 * REST read API used to enrich provenance. Same `McpAdapter` seam the Phase 1
 * `MockMcpAdapter` sat behind — the worker, the message envelope, and the component tree
 * are unchanged.
 *
 * READ-ONLY: it calls only the read tools `graph_state` / `node_lookup` and the read
 * endpoints `/healthz`, `/state/nodes`, `/state/relations/src`. There is NO apply path;
 * the underlying client refuses to name `apply_rewrite` / `apply_program`. The four
 * rewrites (ADD/LINK/MUTATE/UNLINK) are unreachable from this build.
 *
 * The real work (network client + pure fold->frame transform) lives in the SHARED JS
 * modules `streamable-http-client.js` + `transform.js`, which `scripts/live-smoke.mjs`
 * imports and exercises verbatim — the smoke test runs the same code, not a copy.
 *
 * Errors are surfaced, not thrown uncaught: internal fetches retry with backoff, and on
 * exhaustion `getFrame` rejects with a single clear Error (which the worker forwards as a
 * typed `{ type: "ERROR" }`). `getLastError()` exposes the last failure for UI status.
 */

import type { FrameRequest, HgFrame, HgNode, HgRelation, McpAdapter } from "./types";
import { createStreamableHttpClient } from "./streamable-http-client.js";
import {
  selectFrame,
  parseGraphStateResult,
  parseNodeLookupResult,
  mapRelation,
  DEFAULT_ENGINE_URN,
  DEFAULT_MCP_BASE_URL,
  DEFAULT_ENGINE_URL,
} from "./transform.js";

export interface StreamableHttpAdapterConfig {
  /** MCP Streamable HTTP base (POST {mcpBaseUrl}/sse). Default http://localhost:8080. */
  mcpBaseUrl?: string;
  /** Engine REST base (/healthz, /state/*). Default http://localhost:8000. */
  engineUrl?: string;
  /** Engine urn stamped into provenance. Default urn:moos:kernel:hp-z440.primary. */
  engineUrn?: string;
  /** Origin header posture (DNS-rebinding guard). Default: the mcpBaseUrl origin. */
  origin?: string;
  /** Retry attempts on transport failure. Default 3. */
  retries?: number;
}

/** The neighbourhood of a node: the node plus its incident relations and adjacent nodes. */
export interface RelationNeighborhood {
  node: HgNode | null;
  relations: HgRelation[];
  neighbors: HgNode[];
}

export class StreamableHttpMcpAdapter implements McpAdapter {
  private readonly client: ReturnType<typeof createStreamableHttpClient>;
  private readonly engineUrn: string;
  private readonly engineEndpoint: string;
  private lastError: string | null = null;

  constructor(config: StreamableHttpAdapterConfig = {}) {
    const mcpBaseUrl = config.mcpBaseUrl ?? DEFAULT_MCP_BASE_URL;
    const engineUrl = config.engineUrl ?? DEFAULT_ENGINE_URL;
    this.engineUrn = config.engineUrn ?? DEFAULT_ENGINE_URN;
    this.engineEndpoint = `${engineUrl} (HTTP) · ${mcpBaseUrl} (MCP)`;
    this.client = createStreamableHttpClient({
      mcpBaseUrl,
      engineUrl,
      origin: config.origin,
      retries: config.retries,
    });
  }

  /** The last surfaced error message, or null if the most recent read succeeded. */
  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * Read a live, selected frame: initialize handshake -> graph_state + /healthz in
   * parallel -> pure transform + view_filter selection. Honors request.view_filter.
   */
  async getFrame(request?: FrameRequest): Promise<HgFrame> {
    try {
      await this.client.initialize();
      const [graphRpc, health] = await Promise.all([
        this.client.graphState(),
        this.client.healthz(),
      ]);
      const fold = parseGraphStateResult(graphRpc);
      const frame = selectFrame(fold, {
        healthz: health,
        request,
        engine: this.engineUrn,
        engineEndpoint: this.engineEndpoint,
        foldedAt: new Date().toISOString(),
      });
      this.lastError = null;
      return frame;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err instanceof Error ? err : new Error(this.lastError);
    }
  }

  /** Read-only helper: engine /healthz (log_len, t_day, ontology_version). */
  async health(): Promise<{
    log_len?: number;
    t_day?: number;
    ontology_version?: string;
    status?: string;
    [k: string]: unknown;
  }> {
    try {
      const h = await this.client.healthz();
      this.lastError = null;
      return h;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err instanceof Error ? err : new Error(this.lastError);
    }
  }

  /** Read-only helper: a single node by urn via the `node_lookup` MCP tool. */
  async nodeLookup(urn: string): Promise<HgNode> {
    try {
      const rpc = await this.client.nodeLookup(urn);
      const node = parseNodeLookupResult(rpc);
      this.lastError = null;
      return node;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err instanceof Error ? err : new Error(this.lastError);
    }
  }

  /**
   * Read-only helper: the incident-relation neighbourhood of a node (both directions),
   * plus the adjacent nodes. Derived from a single `graph_state` read so it reflects the
   * same fold as `getFrame`.
   */
  async relationNeighborhood(urn: string): Promise<RelationNeighborhood> {
    try {
      const fold = parseGraphStateResult(await this.client.graphState());
      const relations = Object.values(fold.relations)
        .filter((r) => r.src_urn === urn || r.tgt_urn === urn)
        .map(mapRelation);
      const neighborUrns = new Set<string>();
      for (const r of relations) {
        neighborUrns.add(r.source_urn);
        neighborUrns.add(r.target_urn);
      }
      neighborUrns.delete(urn);
      const neighbors: HgNode[] = [];
      for (const u of neighborUrns) {
        const raw = fold.nodes[u];
        if (raw) {
          neighbors.push({
            urn: raw.urn,
            type_id: raw.type_id,
            label: raw.urn.split(":").pop() ?? raw.urn,
            properties: {},
          });
        }
      }
      const self = fold.nodes[urn]
        ? {
            urn,
            type_id: fold.nodes[urn].type_id,
            label: urn.split(":").pop() ?? urn,
            properties: {},
          }
        : null;
      this.lastError = null;
      return { node: self, relations, neighbors };
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err instanceof Error ? err : new Error(this.lastError);
    }
  }
}
