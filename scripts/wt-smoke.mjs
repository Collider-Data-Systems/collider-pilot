#!/usr/bin/env node
/**
 * Collider Pilot - P9 WebTransport SPIKE structural smoke test
 * ===========================================================
 * Headless gate for the WebTransport datagram spike that needs NO live endpoint. Like
 * the other smoke scripts it imports the SAME shared module the extension client uses
 * (`src/wt/wt-datagram.js`), so it exercises the real law, not a copy.
 *
 * It proves the structural invariants the build must hold WITHOUT :8443 being up:
 *   1. FEATURE-DETECT — the gate is inert (not available) when WebTransport is absent
 *      OR the flag is off; available only when both hold.
 *   2. DATAGRAM PARSER — decodes the exact contract shape, and TOLERATES malformed /
 *      dropped / partial / wrong-kind frames by returning null (never throws).
 *   3. CERT-HASH DECODE — hex (64-char + colon-separated) and base64 both decode to a
 *      32-byte SHA-256 ArrayBuffer; garbage returns null.
 *   4. CONFIG NORMALIZE — an untrusted stored value collapses to fail-closed
 *      { enabled:false }; a well-formed one is preserved.
 *
 * The LIVE datagram receipt (actually receiving frames from :8443) is a SEPARATE,
 * Sam-gated check — see docs/phase5-data-plane.md. This script does not attempt it.
 *
 * READ-ONLY: pure functions only; no network, no chrome, no HG. Exit 0 iff all hold.
 *   node scripts/wt-smoke.mjs
 */

import {
  parsePresenceDatagram,
  parseCertHash,
  normalizeWtConfig,
  evaluateWtGate,
  PRESENCE_KIND,
} from "../src/wt/wt-datagram.js";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed++;
    return;
  }
  console.log(`  ok    ${msg}`);
}

// ---- 1. FEATURE-DETECT gate -------------------------------------------------
console.log("\n=== 1. feature-detect gate (inert unless WebTransport present AND flag on) ===");
{
  // hasWebTransport override lets us assert both worlds deterministically in node.
  const off = evaluateWtGate({ enabled: false }, true);
  assert(!off.available && off.status === "disabled", "flag off ⇒ inert (disabled) even with WebTransport present");

  const noWt = evaluateWtGate({ enabled: true }, false);
  assert(!noWt.available && noWt.status === "unsupported", "WebTransport absent ⇒ inert (unsupported) even with flag on");

  const on = evaluateWtGate({ enabled: true }, true);
  assert(on.available && on.status === "ok", "flag on AND WebTransport present ⇒ available");

  // In THIS node runtime there is no global WebTransport, so the real (unoverridden)
  // gate must be inert — the exact property that keeps the strip hidden by default.
  const real = evaluateWtGate({ enabled: true });
  assert(!real.available, "real node runtime (no WebTransport) ⇒ gate inert (strip stays hidden)");
}

// ---- 2. DATAGRAM PARSER -----------------------------------------------------
console.log("\n=== 2. datagram parser (contract shape + malformed tolerance) ===");
{
  const good = JSON.stringify({ seq: 7, t_ms: 1737300000000, value: 0.5498, kind: PRESENCE_KIND });
  const d = parsePresenceDatagram(good);
  assert(d !== null, "valid contract frame parses");
  assert(d && d.seq === 7 && d.t_ms === 1737300000000 && d.kind === PRESENCE_KIND, "fields decode faithfully");
  assert(d && Math.abs(d.value - 0.5498) < 1e-9, "value decodes faithfully");

  // Accepts raw bytes (a datagram arrives as a Uint8Array off datagrams.readable).
  const bytes = new TextEncoder().encode(good);
  assert(parsePresenceDatagram(bytes) !== null, "Uint8Array payload parses (datagram bytes path)");

  // Value clamp: a rogue out-of-range value is clamped into [0,1], never blows the sparkline.
  const hi = parsePresenceDatagram(JSON.stringify({ seq: 1, t_ms: 1, value: 9.9, kind: PRESENCE_KIND }));
  assert(hi && hi.value === 1, "out-of-range value clamped to [0,1]");
  const lo = parsePresenceDatagram(JSON.stringify({ seq: 1, t_ms: 1, value: -3, kind: PRESENCE_KIND }));
  assert(lo && lo.value === 0, "negative value clamped to 0");

  // Malformed / dropped / wrong-shape frames ⇒ null (never throw).
  assert(parsePresenceDatagram("{not json") === null, "malformed JSON ⇒ null");
  assert(parsePresenceDatagram("") === null, "empty payload ⇒ null");
  assert(parsePresenceDatagram("{}") === null, "empty object (missing fields) ⇒ null");
  assert(
    parsePresenceDatagram(JSON.stringify({ seq: 1, t_ms: 1, value: 0.5, kind: "something.else" })) === null,
    "wrong kind ⇒ null (not the synthetic marker)",
  );
  assert(
    parsePresenceDatagram(JSON.stringify({ seq: "x", t_ms: 1, value: 0.5, kind: PRESENCE_KIND })) === null,
    "non-numeric seq ⇒ null",
  );
  assert(
    parsePresenceDatagram(JSON.stringify({ seq: 1, value: 0.5, kind: PRESENCE_KIND })) === null,
    "missing t_ms ⇒ null",
  );
  // A gap (seq jump) is a VALID frame — loss is expected; parsing must not reject it.
  assert(parsePresenceDatagram(JSON.stringify({ seq: 999, t_ms: 5, value: 0.1, kind: PRESENCE_KIND })) !== null, "gapped seq still parses (loss is expected)");
}

// ---- 3. CERT-HASH DECODE ----------------------------------------------------
console.log("\n=== 3. cert-hash decode (hex + base64 ⇒ 32-byte SHA-256 ArrayBuffer) ===");
{
  // A known 32-byte value expressed three ways.
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = i;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const hexColon = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(":");
  const b64 = Buffer.from(bytes).toString("base64");

  const fromHex = parseCertHash(hex);
  assert(fromHex instanceof ArrayBuffer && fromHex.byteLength === 32, "64-char hex ⇒ 32-byte ArrayBuffer");
  assert(fromHex && new Uint8Array(fromHex).every((b, i) => b === i), "hex bytes decode exactly");

  const fromColon = parseCertHash(hexColon);
  assert(fromColon instanceof ArrayBuffer && fromColon.byteLength === 32, "colon-separated hex ⇒ 32-byte ArrayBuffer");

  const fromB64 = parseCertHash(b64);
  assert(fromB64 instanceof ArrayBuffer && fromB64.byteLength === 32, "base64 ⇒ 32-byte ArrayBuffer");
  assert(fromB64 && new Uint8Array(fromB64).every((b, i) => b === i), "base64 bytes decode exactly");

  assert(parseCertHash("") === null, "empty string ⇒ null");
  assert(parseCertHash("not-a-hash!!") === null, "garbage ⇒ null");
}

// ---- 4. CONFIG NORMALIZE (fail-closed) --------------------------------------
console.log("\n=== 4. config normalize (fail-closed default) ===");
{
  assert(normalizeWtConfig(undefined).enabled === false, "undefined ⇒ { enabled:false }");
  assert(normalizeWtConfig(null).enabled === false, "null ⇒ { enabled:false }");
  assert(normalizeWtConfig("enabled").enabled === false, "non-object ⇒ { enabled:false }");
  assert(normalizeWtConfig({ enabled: "true" }).enabled === false, "enabled must be strictly boolean true (fail-closed)");
  const good = normalizeWtConfig({ enabled: true, url: "https://localhost:8443/wt/presence", certHash: "abc" });
  assert(good.enabled === true && good.url === "https://localhost:8443/wt/presence" && good.certHash === "abc", "well-formed config preserved");
}

console.log("");
if (failed > 0) {
  console.error(`WT SMOKE FAILED — ${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log("WT SMOKE PASSED — all structural invariants hold (live :8443 receipt is a separate, Sam-gated check).");
