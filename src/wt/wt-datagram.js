/**
 * Collider Pilot - P9 WebTransport SPIKE: pure datagram + config logic
 * ===================================================================
 * The NODE-TESTABLE core of the WebTransport presence spike. This module holds ONLY
 * pure functions (no DOM, no `chrome`, no `WebTransport`, no network), so both the
 * browser client (`src/wt/wt-client.ts`) and the headless smoke harness
 * (`scripts/wt-smoke.mjs`) import the SAME law — mirroring the `transform.js` /
 * `access.js` convention (shared `.js`, imported by `.ts` via allowJs and by node
 * `.mjs` directly).
 *
 * It parses the wire contract served by the kernel spike (moos-kernel #59,
 * `--wt-addr :8443`, path `/wt/presence`):
 *
 *   { "seq": <uint64>, "t_ms": <int64 UnixMilli>, "value": <float64 in [0,1]>,
 *     "kind": "synthetic.presence" }
 *
 * READ-ONLY: nothing here can write to the HG — it only decodes fabricated datagrams.
 */

/** chrome.storage.local key holding the spike's feature-flag config. */
export const WT_STORAGE_KEY = "pilot.wt";

/** The kernel spike endpoint (HTTP/3, Extended CONNECT, ALPN h3, datagrams enabled). */
export const DEFAULT_WT_URL = "https://localhost:8443/wt/presence";

/** The only `kind` the spike emits — marks the payload as fabricated. */
export const PRESENCE_KIND = "synthetic.presence";

/**
 * The synthetic cadence the kernel emits at: ~20 Hz, i.e. Δt_ms/Δseq ≈ 50 ms.
 * Used by the bench harness as the expected cadence to compare a live measurement to.
 */
export const EXPECTED_EMIT_INTERVAL_MS = 50;
export const EXPECTED_HZ = 20;

/**
 * @typedef {Object} PresenceDatagram
 * @property {number} seq   Per-session monotonic counter (starts at 1); gaps allowed (lossy).
 * @property {number} t_ms  Server wall-clock ms (UnixMilli) at emit time.
 * @property {number} value Synthetic signal clamped into [0,1] for rendering.
 * @property {"synthetic.presence"} kind Always the fabricated marker.
 */

/**
 * Parse one datagram payload to the contract shape, tolerating malformed / dropped /
 * partial frames by returning `null` (never throwing). Accepts either the decoded
 * string or the raw bytes.
 *
 * A frame is REJECTED (→ null) when: it is not JSON; not an object; missing/!finite
 * `seq`/`t_ms`/`value`; or `kind` !== "synthetic.presence". `value` is defensively
 * clamped into [0,1] so a rogue frame can never blow out the sparkline.
 *
 * @param {string | Uint8Array | ArrayBuffer} input
 * @returns {PresenceDatagram | null}
 */
export function parsePresenceDatagram(input) {
  let text;
  if (typeof input === "string") {
    text = input;
  } else if (input instanceof Uint8Array) {
    text = new TextDecoder().decode(input);
  } else if (input instanceof ArrayBuffer) {
    text = new TextDecoder().decode(new Uint8Array(input));
  } else {
    return null;
  }

  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return null; // malformed / partial datagram — drop it
  }
  if (!obj || typeof obj !== "object") return null;

  const seq = obj.seq;
  const tMs = obj.t_ms;
  const value = obj.value;
  if (typeof seq !== "number" || !Number.isFinite(seq)) return null;
  if (typeof tMs !== "number" || !Number.isFinite(tMs)) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (obj.kind !== PRESENCE_KIND) return null;

  const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
  return { seq, t_ms: tMs, value: clamped, kind: PRESENCE_KIND };
}

/**
 * Decode a cert-hash string (hex or base64) into a 32-byte SHA-256 `ArrayBuffer`
 * suitable for `WebTransport`'s `serverCertificateHashes[].value`. Returns `null`
 * when the input can't be decoded. NEVER throws.
 *
 * Accepts:
 *   - hex, 64 chars, optionally colon/space separated (e.g. `AA:BB:...` or `aabb...`)
 *   - base64 / base64url (standard 44-char SHA-256 encoding, padding optional)
 *
 * Disambiguation: a separator-stripped, all-hex, 64-char string is treated as hex;
 * everything else is tried as base64. The decoded length is NOT hard-required to be
 * 32 (the browser makes the final judgement), but a non-32 result is reported by the
 * caller as a likely-misconfigured hash.
 *
 * @param {string} input
 * @returns {ArrayBuffer | null}
 */
export function parseCertHash(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hexCandidate = trimmed.replace(/[\s:]/g, "");
  const isHex = /^[0-9a-fA-F]+$/.test(hexCandidate) && hexCandidate.length % 2 === 0;
  // Prefer hex when it is a clean 64-hex SHA-256 or was colon/space separated; otherwise
  // fall through to base64 (a 44-char base64 SHA-256 is not all-hex / not even-length-64).
  const looksSeparated = /[\s:]/.test(trimmed);
  if (isHex && (hexCandidate.length === 64 || looksSeparated)) {
    const bytes = new Uint8Array(hexCandidate.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hexCandidate.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes.buffer;
  }

  // base64 / base64url
  try {
    const b64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const bin = base64ToBinary(b64);
    if (bin == null) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  } catch {
    return null;
  }
}

/**
 * Decode base64 in either a browser (`atob`) or node (`Buffer`) realm so the same
 * module works in the extension and the smoke harness.
 * @param {string} b64
 * @returns {string | null} binary string, or null on failure
 */
function base64ToBinary(b64) {
  if (typeof atob === "function") {
    return atob(b64);
  }
  // node
  if (typeof globalThis.Buffer !== "undefined") {
    return globalThis.Buffer.from(b64, "base64").toString("binary");
  }
  return null;
}

/**
 * @typedef {Object} WtFeatureConfig
 * @property {boolean} enabled  Master flag. DEFAULT false — the spike is OFF by default.
 * @property {string} [url]     Optional endpoint override; defaults to DEFAULT_WT_URL.
 * @property {string} [certHash] Optional SHA-256 cert hash (hex or base64) for a
 *                               self-signed dev cert (serverCertificateHashes).
 */

/**
 * Normalize an unknown value (as read from chrome.storage) into a safe WtFeatureConfig.
 * Anything that is not a well-formed, explicitly-`enabled:true` object collapses to the
 * fail-closed default `{ enabled: false }`.
 *
 * @param {unknown} value
 * @returns {WtFeatureConfig}
 */
export function normalizeWtConfig(value) {
  if (!value || typeof value !== "object") return { enabled: false };
  const v = /** @type {Record<string, unknown>} */ (value);
  const enabled = v.enabled === true;
  /** @type {WtFeatureConfig} */
  const cfg = { enabled };
  if (typeof v.url === "string" && v.url.length > 0) cfg.url = v.url;
  if (typeof v.certHash === "string" && v.certHash.length > 0) cfg.certHash = v.certHash;
  return cfg;
}

/**
 * @typedef {("ok"|"disabled"|"unsupported")} WtGateStatus
 * @typedef {Object} WtGate
 * @property {boolean} available True only when the client may attempt a connection.
 * @property {WtGateStatus} status Why the gate is (un)available.
 * @property {string} reason Human-readable explanation for the state line / logs.
 */

/**
 * The single feature-DETECT gate. The client attempts a connection ONLY when the
 * runtime exposes `WebTransport` AND the flag is explicitly on. Everything else is
 * inert (strip hidden), exactly like the PiP feature-detect precedent.
 *
 * Pure + synchronous so both the browser client and the node smoke harness can assert
 * it without a live endpoint. In node (no global `WebTransport`) this returns
 * `unsupported`; with `{ enabled:false }` it returns `disabled`.
 *
 * @param {WtFeatureConfig} config
 * @param {boolean} [hasWebTransport] override the WebTransport presence check (tests)
 * @returns {WtGate}
 */
export function evaluateWtGate(config, hasWebTransport) {
  const supported =
    typeof hasWebTransport === "boolean"
      ? hasWebTransport
      : typeof WebTransport !== "undefined";
  if (!supported) {
    return {
      available: false,
      status: "unsupported",
      reason: "WebTransport is unavailable in this runtime",
    };
  }
  if (!config || config.enabled !== true) {
    return {
      available: false,
      status: "disabled",
      reason: "pilot.wt flag is off (default)",
    };
  }
  return { available: true, status: "ok", reason: "flag on; WebTransport available" };
}
