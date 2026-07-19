/**
 * Collider Pilot - MCP Streamable HTTP client (Phase 2, SHARED, READ-ONLY)
 * ========================================================================
 * The thin transport that speaks JSON-RPC 2.0 over MCP Streamable HTTP to the mo:os
 * engine, plus the engine's REST read API for provenance enrichment. Pure w.r.t. an
 * injected `fetch`, so the identical code runs in the MV3 service worker and in
 * `scripts/live-smoke.mjs` under Node (where there is no CORS).
 *
 * Endpoints:
 *   MCP   POST  {mcpBaseUrl}/sse            initialize, tools/call graph_state|node_lookup
 *   REST  GET   {engineUrl}/healthz         log_len, t_day, ontology_version (provenance)
 *   REST  GET   {engineUrl}/state/nodes/{urn}
 *   REST  GET   {engineUrl}/state/relations/src/{urn}
 *
 * READ-ONLY GUARANTEE: this client exposes ONLY read methods. It never constructs a
 * tools/call for `apply_rewrite` / `apply_program`, and never issues `POST /rewrites`
 * or `POST /programs`. The four rewrites are unreachable from here.
 *
 * Transport posture:
 *   - Accept: "application/json, text/event-stream"  (server may answer either framing)
 *   - Content-Type: "application/json"
 *   - Origin: set from config (DNS-rebinding posture). Browsers treat Origin as a
 *     forbidden request header and will override it with the extension origin; in Node
 *     it is sent verbatim. Either way the server's localhost binding is the real guard.
 *   - The server is effectively stateless per request (no mcp-session-id is returned),
 *     so there is no session global to persist or resume; reconnection is just retry.
 */

const PROTOCOL_VERSION = "2024-11-05";
const CLIENT_INFO = { name: "collider-pilot", version: "0.1.0" };

/**
 * The ONLY tools this client is permitted to invoke. Read-only by construction: any
 * tools/call for a name outside this allowlist (i.e. any write/apply tool) is refused
 * before a request is built. This is a positive allowlist, so the write-tool names never
 * appear in this codebase at all.
 * @type {ReadonlySet<string>}
 */
const READ_ONLY_TOOLS = new Set(["graph_state", "node_lookup", "operad_registry"]);

/** @param {number} ms */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract the JSON-RPC object from a response body that may be plain JSON or an SSE
 * (`event:`/`data:`) stream. For SSE, the last `data:` payload is the JSON-RPC message.
 * @param {string} text
 * @param {string} contentType
 * @returns {any}
 */
export function parseMcpBody(text, contentType) {
  const trimmed = text.trim();
  const looksSse =
    contentType.includes("text/event-stream") ||
    trimmed.startsWith("event:") ||
    trimmed.startsWith("data:");
  if (looksSse) {
    const dataLines = trimmed
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter((l) => l && l !== "[DONE]");
    const payload = dataLines[dataLines.length - 1];
    if (!payload) throw new Error("SSE response contained no data payload");
    return JSON.parse(payload);
  }
  return JSON.parse(trimmed);
}

/**
 * @typedef {Object} ClientConfig
 * @property {string} [mcpBaseUrl]   - default http://localhost:8080
 * @property {string} [engineUrl]    - default http://localhost:8000
 * @property {string} [origin]       - Origin header posture; defaults to mcpBaseUrl origin
 * @property {number} [retries]      - retry attempts on failure (default 3)
 * @property {number} [backoffMs]    - base backoff, grows linearly per attempt (default 200)
 * @property {typeof fetch} [fetchImpl] - injected fetch (defaults to global fetch)
 */

/**
 * Build a read-only MCP Streamable HTTP client.
 * @param {ClientConfig} [config]
 */
export function createStreamableHttpClient(config = {}) {
  const mcpBaseUrl = (config.mcpBaseUrl || "http://localhost:8080").replace(/\/$/, "");
  const engineUrl = (config.engineUrl || "http://localhost:8000").replace(/\/$/, "");
  const sseEndpoint = `${mcpBaseUrl}/sse`;
  let origin = config.origin;
  if (origin === undefined) {
    try {
      origin = new URL(mcpBaseUrl).origin;
    } catch {
      origin = mcpBaseUrl;
    }
  }
  const retries = config.retries ?? 3;
  const backoffMs = config.backoffMs ?? 200;
  const fetchImpl = config.fetchImpl || fetch;

  let rpcId = 0;

  /**
   * Do a fetch with small linear backoff. Surfaces a clear Error after exhaustion.
   * @param {string} url
   * @param {RequestInit} init
   * @returns {Promise<{ text: string, contentType: string }>}
   */
  async function fetchWithRetry(url, init) {
    /** @type {unknown} */
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchImpl(url, init);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
        }
        const text = await res.text();
        return { text, contentType: res.headers.get("content-type") || "" };
      } catch (err) {
        lastErr = err;
        if (attempt < retries) await delay(backoffMs * (attempt + 1));
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(
      `request to ${url} failed after ${retries + 1} attempt(s): ${msg}`,
    );
  }

  /** @returns {Record<string, string>} */
  function mcpHeaders() {
    /** @type {Record<string, string>} */
    const h = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (origin) h.Origin = origin;
    return h;
  }

  /**
   * One JSON-RPC request/response over the MCP endpoint.
   * @param {string} method
   * @param {object} params
   * @returns {Promise<any>}
   */
  async function rpc(method, params) {
    const id = ++rpcId;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const { text, contentType } = await fetchWithRetry(sseEndpoint, {
      method: "POST",
      headers: mcpHeaders(),
      body,
    });
    const parsed = parseMcpBody(text, contentType);
    if (parsed && parsed.error) {
      throw new Error(
        `MCP ${method} error: ${parsed.error.message ?? JSON.stringify(parsed.error)}`,
      );
    }
    return parsed;
  }

  /**
   * MCP initialize handshake. Returns serverInfo. Read-only capabilities only.
   * @returns {Promise<any>}
   */
  async function initialize() {
    const res = await rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    return res?.result ?? res;
  }

  /**
   * Read-only tools/call. Refuses any tool outside the READ_ONLY_TOOLS allowlist, so no
   * write/apply tool can ever be invoked from here.
   * @param {string} name
   * @param {object} [args]
   * @returns {Promise<any>} the full JSON-RPC response object
   */
  async function callTool(name, args = {}) {
    if (!READ_ONLY_TOOLS.has(name)) {
      throw new Error(
        `refused: '${name}' is not in the read-only tool allowlist; the Pilot is read-only`,
      );
    }
    return rpc("tools/call", { name, arguments: args });
  }

  /** @returns {Promise<any>} raw graph_state RPC response */
  function graphState() {
    return callTool("graph_state", {});
  }

  /**
   * @param {string} urn
   * @returns {Promise<any>} raw node_lookup RPC response
   */
  function nodeLookup(urn) {
    return callTool("node_lookup", { urn });
  }

  /**
   * GET {engineUrl}/healthz  -> { log_len, t_day, ontology_version, ... }
   * @returns {Promise<any>}
   */
  async function healthz() {
    const { text } = await fetchWithRetry(`${engineUrl}/healthz`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    return JSON.parse(text);
  }

  /**
   * GET {engineUrl}/state/nodes/{urlencoded-urn} (raw wrapped node)
   * @param {string} urn
   * @returns {Promise<any>}
   */
  async function restNode(urn) {
    const { text } = await fetchWithRetry(
      `${engineUrl}/state/nodes/${encodeURIComponent(urn)}`,
      { method: "GET", headers: { Accept: "application/json" } },
    );
    return JSON.parse(text);
  }

  /**
   * GET {engineUrl}/state/relations/src/{urlencoded-urn} (raw relations, outgoing)
   * @param {string} urn
   * @returns {Promise<any[]>}
   */
  async function restRelationsBySrc(urn) {
    const { text } = await fetchWithRetry(
      `${engineUrl}/state/relations/src/${encodeURIComponent(urn)}`,
      { method: "GET", headers: { Accept: "application/json" } },
    );
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  }

  return {
    mcpBaseUrl,
    engineUrl,
    sseEndpoint,
    initialize,
    callTool,
    graphState,
    nodeLookup,
    healthz,
    restNode,
    restRelationsBySrc,
  };
}
