#!/usr/bin/env node
/**
 * Collider Pilot — UI PROBE: what the built harness shows a person (t342 hand-off C)
 * ==================================================================================
 * A measure, not a gate. Loads the BUILT `dist/preview-live.html` in headless Chrome over the
 * DevTools protocol (Node >= 22: built-in fetch and WebSocket, no dependency), seeded with one
 * identity in the harness's storage shim, and reads from the rendered DOM and the page's own
 * Cytoscape instance the numbers the hand-off C orders are measured by:
 *
 *   PIL-5   the opening view: cy.zoom() against the label cut, the identity's own node inside
 *           the canvas, before and after the log feed under the canvas has arrived;
 *   PIL-6   WCAG 1.4.3 text contrast over every visible text item (the U2b probe's method, see
 *           CONTRAST_PROBE): the `--text-muted` items, the links, the inspector port names, and
 *           the share failing overall;
 *   PIL-7   `find`: the selected hit's own relations — their opacity and whether their other
 *           ends are inside the canvas — from the opening view and again from the `fit` view
 *           (the hit inside both times, at the same zoom; t343 review);
 *   PIL-8   the strip: whether its text names the unit ("nodes") and what is cut at the panel's
 *           width;
 *   PIL-9   the legend's tooltips against the insider terms (κ, a commit hash, an API path,
 *           src_port, "colour gate"), and whether the legend grows or scrolls;
 *   PIL-10  the <button> tags of the six components (counted in the source AND in the DOM) and
 *           how many carry a data-testid; the canvas's aria-label;
 *   PIL-12  a re-layout with a node selected: how far the selected node's component moves.
 *
 * Read-only: every request the page makes is recorded and the run fails if one is not a GET.
 * Chrome runs with --headless=new, a --remote-debugging-port in 9400–9449 and a fresh
 * --user-data-dir under the OS temp folder; only the process this script started is killed.
 * The dist is served by this script on 127.0.0.1 (a free port from --serve upward), so no other
 * server is needed. Nothing is written into the repo: results go to --out (JSON + a screenshot).
 *
 *   node scripts/ui-probe.mjs [--engine <REST base URL>] [--user <urn>] [--find <text>]
 *                             [--dist dist] [--chrome <path>] [--port 9401] [--serve 5191]
 *                             [--out <dir>] [--width 1366] [--height 900]
 *
 * Env: PILOT_ENGINE_URL sets the default of --engine (http://localhost:8000); PILOT_CHROME the
 * default of --chrome. The identity is stored only in the harness's storage shim (the page's
 * localStorage), as "Save identity" would store it — never sent anywhere.
 */

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const ENGINE = arg("engine", process.env.PILOT_ENGINE_URL || "http://localhost:8000").replace(/\/+$/, "");
const USER = arg("user", "urn:moos:user:sam");
const FIND = arg("find", "youtube");
const DIST = resolve(ROOT, arg("dist", "dist"));
const CHROME = [arg("chrome", process.env.PILOT_CHROME), "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => p && existsSync(p));
const PORT = Number(arg("port", "9401"));
const SERVE_FROM = Number(arg("serve", "5191"));
const OUT = resolve(arg("out", join(tmpdir(), "pilot-ui-probe")));
const WIDTH = Number(arg("width", "1366"));
const HEIGHT = Number(arg("height", "900"));
const SEED_KEY = "pilot.preview.chromeStorageLocal";
const SEED = { "pilot.access": { enabled: true, enforcement: "client-presentation", user: USER, workstation: null }, "pilot.accessPosture": "identified" };
/** The six components the harness renders, their files and their DOM roots (PIL-10). */
const COMPONENTS = [
  ["PostureStrip", ".posture-strip"],
  ["SettingsPanel", ".settings-panel"],
  ["GraphControls", ".graph-controls"],
  ["FrameGraph", ".graph-wrap"],
  ["LogFeed", ".log-feed"],
  ["NodeInspector", ".inspector"],
];
/** The insider terms a legend tooltip must not carry (PIL-9). */
const INSIDER = /κ|\b[0-9a-f]{7}\b|\/operad\/|\bsrc_port\b|\btgt_port\b|colou?r gate/;

if (!(PORT >= 9400 && PORT <= 9449)) throw new Error("--port must be in 9400-9449");
if (!CHROME) throw new Error("no Chrome found: pass --chrome <path> or set PILOT_CHROME");
if (!existsSync(join(DIST, "preview-live.html"))) throw new Error(`no built harness at ${DIST} — run npm run build first`);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ------------------------------------------------------------------------------------------ */
/* A static server for dist/ on 127.0.0.1                                                      */
/* ------------------------------------------------------------------------------------------ */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".map": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
async function serve(dir, from) {
  for (let port = from; port < from + 50; port++) {
    const server = createServer((req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
      const file = join(dir, path === "" ? "preview-live.html" : path);
      if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    });
    const ok = await new Promise((r) => {
      server.once("error", () => r(false));
      server.listen(port, "127.0.0.1", () => r(true));
    });
    if (ok) return { server, origin: `http://127.0.0.1:${port}` };
  }
  throw new Error("no free port for the static server");
}

/* ------------------------------------------------------------------------------------------ */
/* A small DevTools-protocol driver (the U2b review's, trimmed)                                */
/* ------------------------------------------------------------------------------------------ */
class Cdp {
  constructor(port) {
    this.port = port;
    this.profile = mkdtempSync(join(tmpdir(), "pilot-ui-probe-"));
    this.msgId = 0;
    this.pending = new Map();
    this.listeners = [];
    this.requests = [];
    this.consoleErrors = [];
  }
  launch() {
    this.proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${this.port}`, `--user-data-dir=${this.profile}`, `--window-size=${WIDTH},${HEIGHT}`, "--force-color-profile=srgb", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank"], { stdio: "ignore" });
    this.pid = this.proc.pid;
  }
  async connect() {
    let target;
    for (let k = 0; k < 120 && !target; k++) {
      await sleep(250);
      try {
        target = (await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json()).find((t) => t.type === "page");
      } catch {}
    }
    if (!target) throw new Error("no page target");
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) {
        const p = this.pending.get(d.id);
        this.pending.delete(d.id);
        d.error ? p.rej(new Error(`${p.method}: ${d.error.message}`)) : p.res(d.result);
        return;
      }
      if (d.method === "Network.requestWillBeSent") this.requests.push({ method: d.params.request.method, url: d.params.request.url.slice(0, 200) });
      if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") this.consoleErrors.push(d.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
      if (d.method === "Runtime.exceptionThrown") this.consoleErrors.push(`exception: ${d.params.exceptionDetails.text}`);
      for (const l of [...this.listeners]) l(d);
    };
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Network.enable");
    await this.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
    await this.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const i = ++this.msgId;
      this.pending.set(i, { res, rej, method });
      this.ws.send(JSON.stringify({ id: i, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async navigate(url, settleMs = 300) {
    const loaded = new Promise((res) => {
      const l = (d) => {
        if (d.method === "Page.loadEventFired") {
          this.listeners.splice(this.listeners.indexOf(l), 1);
          res();
        }
      };
      this.listeners.push(l);
    });
    await this.send("Page.navigate", { url });
    await Promise.race([loaded, sleep(60000)]);
    await sleep(settleMs);
  }
  async shot(file) {
    const r = await this.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    writeFileSync(file, Buffer.from(r.data, "base64"));
  }
  async click(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
  /** Click the centre of the first element matching `sel`, scrolled into view, as a mouse would. */
  async clickSel(sel) {
    const r = await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
      e.scrollIntoView({ block: "center", inline: "nearest" }); const b = e.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; })()`);
    if (!r || r.w < 1) throw new Error(`clickSel: ${sel} not found or not visible`);
    await sleep(120);
    await this.click(r.x, r.y);
    return r;
  }
  async key(key, { code = key, vk = 0, modifiers = 0, commands } = {}) {
    await this.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, ...(commands ? { commands } : {}) });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  }
  type(text) {
    return this.send("Input.insertText", { text });
  }
  async clearFocused() {
    await this.key("a", { code: "KeyA", vk: 65, modifiers: 2, commands: ["selectAll"] });
    await this.key("Backspace", { code: "Backspace", vk: 8, commands: ["deleteBackward"] });
  }
  nonGet() {
    return this.requests.filter((q) => q.method !== "GET" && !/^(data|blob|about|chrome|file):/.test(q.url));
  }
  close() {
    try { this.ws && this.ws.close(); } catch {}
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(this.pid), "/T", "/F"], { stdio: "ignore" });
      else this.proc.kill("SIGKILL");
    } catch {}
    for (let k = 0; k < 40; k++) {
      try { rmSync(this.profile, { recursive: true, force: true }); return; } catch { const t = Date.now(); while (Date.now() - t < 250); }
    }
  }
}

/* ------------------------------------------------------------------------------------------ */
/* In-page probes                                                                              */
/* ------------------------------------------------------------------------------------------ */
const CY = `(document.querySelector(".graph-canvas") && document.querySelector(".graph-canvas")._cyreg && document.querySelector(".graph-canvas")._cyreg.cy)`;

/** Wait for the first frame to be drawn and its positions to settle (the fold read can take 20 s over a slow network). */
const WAIT_FRAME = (timeoutMs) => String.raw`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const t0 = Date.now(); let cy = null, strip = "";
  while (Date.now() - t0 < ${timeoutMs}) {
    cy = ${CY}; strip = ((document.querySelector(".prov-summary") || {}).textContent || "").replace(/\s+/g, " ").trim();
    if (strip && !/no frame loaded/.test(strip) && cy && cy.nodes().length > 0) break;
    await wait(250);
  }
  let prev = "";
  for (let k = 0; k < 40 && cy; k++) {
    const pos = JSON.stringify(cy.nodes().slice(0, 60).map((n) => [Math.round(n.position("x")), Math.round(n.position("y"))])) + cy.zoom().toFixed(5) + cy.nodes().length;
    if (pos === prev) break; prev = pos; await wait(700);
  }
  return { ms: Date.now() - t0, strip, nodes: cy ? cy.nodes().length : null, relations: cy ? cy.edges().length : null, zoom: cy ? cy.zoom() : null };
})()`;

/** Wait for the log feed's rows (it reads GET /log on its own and the canvas shrinks when it lands). */
const WAIT_LOG = String.raw`(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const t0 = Date.now();
  while (Date.now() - t0 < 90000) { if (document.querySelectorAll(".log-feed .log-entry").length > 0) break;
    const e = document.querySelector(".log-feed .log-empty"); if (e && /unreachable/.test(e.textContent)) break; await wait(200); }
  await wait(1500); return { ms: Date.now() - t0, entries: document.querySelectorAll(".log-feed .log-entry").length }; })()`;

/** PIL-5: the view — zoom against the label cut, the identity's own node against the canvas. */
const VIEW = (user) => String.raw`(() => {
  const cy = ${CY}; const c = document.querySelector(".graph-canvas"); const b = c.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const labelCut = Math.pow(2, Math.floor(Math.log2(0.9 * ratio))) / ratio; // FrameGraph labelCut: LABEL_ZOOM 0.9 at a 2^k / dpr step
  const me = cy.getElementById(${JSON.stringify(user)});
  const p = me.nonempty() ? me.renderedPosition() : null;
  return { zoom: cy.zoom(), labelCut, labelsDrawn: cy.zoom() > labelCut, labelPx: Math.round(9 * cy.zoom() * 100) / 100,
    canvas: { w: Math.round(b.width), h: Math.round(b.height) }, nodes: cy.nodes().length,
    identityInFrame: me.nonempty(), identityVisible: me.nonempty() && me.visible(),
    identityRendered: p ? { x: Math.round(p.x), y: Math.round(p.y) } : null,
    identityInside: !!p && p.x >= 0 && p.y >= 0 && p.x <= b.width && p.y <= b.height,
    fitZoom: (() => { const bb = cy.elements(":visible").boundingBox(); return Math.min((b.width - 32) / bb.w, (b.height - 32) / bb.h); })() };
})()`;

/** PIL-8: the strip's words and what is cut inside it. */
const STRIP = String.raw`(() => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const strip = document.querySelector(".posture-strip"); const sum = document.querySelector(".prov-summary");
  const cut = [...strip.querySelectorAll("*")].filter((el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect();
    return r.width > 0 && el.scrollWidth > el.clientWidth + 1 && (s.overflowX === "hidden" || s.textOverflow === "ellipsis") && clean(el.textContent); })
    .map((el) => ({ cls: String(el.className || el.tagName).slice(0, 50), text: clean(el.textContent).slice(0, 100), shown_px: el.clientWidth, needs_px: el.scrollWidth }));
  return { panel_w: document.querySelector("#panel").clientWidth, text: clean(sum && sum.textContent), hasNodesWord: /\bnodes\b/.test(clean(sum && sum.textContent)),
    lines: sum ? Math.round(sum.getBoundingClientRect().height / parseFloat(getComputedStyle(sum).lineHeight || "15")) : null, cut };
})()`;

/** PIL-9: every tooltip in the legend, and whether the legend grows or scrolls. */
const LEGEND = String.raw`(() => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const lg = document.querySelector(".graph-legend"); if (!lg) return null;
  const tips = [...lg.querySelectorAll("[title]")].map((el) => ({ cls: String(el.className || el.tagName).slice(0, 40), text: clean(el.textContent).slice(0, 60), title: el.title }));
  return { tooltips: tips, scroll_h: lg.scrollHeight, client_h: lg.clientHeight, overflow_y: getComputedStyle(lg).overflowY, grows: lg.scrollHeight <= lg.clientHeight + 1,
    titles: [...lg.querySelectorAll(".legend-title")].map((t) => clean(t.textContent)), text: clean(lg.innerText).slice(0, 1200) };
})()`;

/** PIL-10: the buttons in the DOM of the six components, and the canvas's accessible name. */
const BUTTONS = (components) => String.raw`(() => {
  const roots = ${JSON.stringify(components)};
  const out = roots.map(([name, sel]) => { const root = document.querySelector(sel); const bs = root ? [...root.querySelectorAll("button")] : [];
    return { component: name, found: !!root, buttons: bs.length, withTestid: bs.filter((b) => b.hasAttribute("data-testid")).length, missing: bs.filter((b) => !b.hasAttribute("data-testid")).map((b) => (b.textContent || b.getAttribute("aria-label") || b.title || "").replace(/\s+/g, " ").trim().slice(0, 40)) }; });
  const c = document.querySelector(".graph-canvas");
  return { components: out, canvasAriaLabel: c ? c.getAttribute("aria-label") : null, findTestid: (document.querySelector(".gc-search input") || {}).getAttribute ? document.querySelector(".gc-search input").getAttribute("data-testid") : null,
    legendRowsWithTestid: document.querySelectorAll(".graph-legend .legend-item[data-testid]").length, legendRows: document.querySelectorAll(".graph-legend .legend-item").length };
})()`;

/** PIL-7: the selected find hit, its relations' opacity and whether their other ends are in view. */
const FIND_PROBE = String.raw`(() => {
  const cy = ${CY}; const b = document.querySelector(".graph-canvas").getBoundingClientRect();
  const inView = (n) => { const p = n.renderedPosition(); return p.x >= 0 && p.y >= 0 && p.x <= b.width && p.y <= b.height; };
  const hits = cy.nodes(".found"); const sel = cy.nodes(":selected"); const hit = sel.nonempty() ? sel[0] : hits.nonempty() ? hits[0] : null;
  const rels = hit ? hit.connectedEdges().map((e) => { const other = e.source().id() === hit.id() ? e.target() : e.source();
    return { label: e.data("label"), opacity: Number(e.style("opacity")), faded: e.hasClass("faded"), other: other.data("label"), otherFaded: other.hasClass("faded"), otherOpacity: Number(other.style("opacity")), otherInView: inView(other) }; }) : [];
  return { input: (document.querySelector(".gc-search input") || {}).value, hint: ((document.querySelector(".gc-hint") || {}).textContent || null), hits: hits.length, hit: hit ? { id: hit.id(), label: hit.data("label"), inView: inView(hit) } : null,
    relations: rels, allRelationsLit: rels.length > 0 && rels.every((r) => r.opacity === 1), allOtherEndsInView: rels.length > 0 && rels.every((r) => r.otherInView),
    faded: cy.nodes(".faded").length, zoom: cy.zoom(), apply: (() => { const a = [...document.querySelectorAll("button")].find((x) => /^Apply/.test(x.textContent.trim())); if (!a) return null; const d = a.closest("details"); return { text: a.textContent.trim(), inDrawer: !!(d && d.classList.contains("gc-filter")), visible: a.getBoundingClientRect().height > 0 }; })() };
})()`;

/**
 * PIL-6: WCAG 2.2 SC 1.4.3 text contrast, for every visible element with its own text, every visible
 * <select> (its shown option) and every visible empty input / textarea with a placeholder — the U2b
 * review's method: the text colour and the background behind it composited in 8-bit sRGB through
 * the ancestor chain (each background-color with its alpha, each opacity as a group opacity),
 * from a white canvas; contrast (L1 + 0.05) / (L2 + 0.05); large text (>= 24 px, or >= 18.66 px
 * bold) needs 3:1, other text 4.5:1; text inside a disabled control is listed but exempt.
 * Each item also says whether its colour is the --text-muted token, a link, or an inspector port, and
 * whether it is a label (a <label>, or one of the panel's label classes) — PIL-6 asks for labels of
 * at least 11 px, so the run counts the labels under that.
 */
/** t343 (Copilot on #48): the buttons' hover state is never rendered by this probe, so the two button
 *  tokens are read from :root and their white text checked with the same formula as CONTRAST_PROBE. */
const BUTTON_TOKENS_PROBE = String.raw`(() => {
  const root = getComputedStyle(document.documentElement);
  const rgb = (css) => { const d = document.createElement("span"); d.style.color = css; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); const n = c.replace(/[^0-9.,]/g, "").split(",").map(Number); return n.length >= 3 ? n.slice(0, 3) : null; };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const one = (name) => { const hex = root.getPropertyValue(name).trim(); const c = rgb(hex); return { hex, ratio: c ? Math.round(100 * (1.05 / (lum(c) + 0.05))) / 100 : null }; };
  const base = one("--accent-button"), hover = one("--accent-button-hover");
  return { base, hover, pass: !!(base.ratio && hover.ratio && base.ratio >= 4.5 && hover.ratio >= 4.5) };
})()`;

const CONTRAST_PROBE = String.raw`(() => {
  const parse = (s) => { const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s\/]+([\d.]+)(%?))?\s*\)/.exec(s || "");
    if (!m) return null; let a = m[4] === undefined ? 1 : parseFloat(m[4]) / (m[5] ? 100 : 1); return { r: +m[1], g: +m[2], b: +m[3], a }; };
  const over = (fg, bg) => ({ r: fg.a * fg.r + (1 - fg.a) * bg.r, g: fg.a * fg.g + (1 - fg.a) * bg.g, b: fg.a * fg.b + (1 - fg.a) * bg.b, a: 1 });
  const mix = (c, bd, o) => ({ r: o * c.r + (1 - o) * bd.r, g: o * c.g + (1 - o) * bd.g, b: o * c.b + (1 - o) * bd.b, a: 1 });
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  const muted = getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim().toLowerCase();
  const mutedRgb = (() => { const d = document.createElement("span"); d.style.color = muted; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; })();
  const levelsOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(e); chain.reverse();
    return chain.map((e) => { const s = getComputedStyle(e); return { bg: parse(s.backgroundColor) || { r: 0, g: 0, b: 0, a: 0 }, o: parseFloat(s.opacity) }; }); };
  const evalFrom = (L, j, bd, text) => { if (j >= L.length) return text ? over(text, bd) : bd; let c = over(L[j].bg, bd); c = evalFrom(L, j + 1, c, text); return L[j].o < 1 ? mix(c, bd, L[j].o) : c; };
  const shown = (el) => { const s = getComputedStyle(el); if (s.visibility !== "visible" || s.display === "none") return false;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
    for (let e = el; e; e = e.parentElement) { if (getComputedStyle(e).display === "none") return false; } return true; };
  const pathOf = (el) => { const parts = []; for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      parts.unshift(e.tagName.toLowerCase() + (e.classList && e.classList.length ? "." + [...e.classList].slice(0, 2).join(".") : "")); } return parts.join(" > "); };
  const out = [];
  const add = (el, text, colourCss, kind) => {
    const s = getComputedStyle(el); const L = levelsOf(el); const fg = parse(colourCss); if (!fg) return;
    const f = evalFrom(L, 0, WHITE, fg), b = evalFrom(L, 0, WHITE, null);
    const size = parseFloat(s.fontSize), weight = parseInt(s.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const r = ratio(f, b);
    out.push({ text: text.slice(0, 60), kind, path: pathOf(el), fg: hex(f), bg: hex(b), ratio: Math.round(r * 100) / 100, need: large ? 3 : 4.5, pass: r >= (large ? 3 : 4.5), size, weight,
      disabled: !!el.closest(":disabled, [aria-disabled=true]"),
      muted: colourCss === mutedRgb, link: !!el.closest(".is-link, .insp-rel-target, a[href]"), inspectorPort: !!el.closest(".insp-rel-label"),
      label: !!el.closest("label, .gc-label, .legend-title, .prov-label, .insp-section-title, .settings-section-title, .gc-adv-note, .gc-group-label, .gc-filter-summary") });
  };
  for (const el of document.body.querySelectorAll("*")) {
    if (/^(SCRIPT|STYLE|NOSCRIPT|OPTION|OPTGROUP|TEMPLATE|CANVAS|DATALIST)$/.test(el.tagName)) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
    if (own && shown(el)) add(el, own, getComputedStyle(el).color, "text");
    if (el.tagName === "SELECT" && shown(el)) { const o = el.options[el.selectedIndex]; if (o) add(el, o.textContent.trim(), getComputedStyle(el).color, "select"); }
    if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && shown(el) && !/^(checkbox|radio|hidden|range|color)$/.test(el.type || "")) {
      if (el.value) add(el, el.value.slice(0, 60), getComputedStyle(el).color, "value");
      else if (el.placeholder) add(el, el.placeholder, getComputedStyle(el, "::placeholder").color, "placeholder");
    }
  }
  return { muted, items: out };
})()`;

/** PIL-12: positions of the selected node's component before and after a re-layout. */
const COMPONENT_POSITIONS = String.raw`(() => {
  const cy = ${CY}; const rep = cy.scratch("pilotLayout"); const sel = cy.nodes(":selected");
  const comps = (rep && rep.components) || [];
  const comp = sel.nonempty() ? comps.find((c) => c.includes(sel[0].id())) : comps[0];
  if (!comp) return { drawn: rep && rep.drawn, components: comps.length, comp: null };
  return { drawn: rep.drawn, components: comps.length, comp, selected: sel.nonempty() ? sel[0].id() : null, at: comp.map((u) => { const p = cy.getElementById(u).position(); return [p.x, p.y]; }), all: cy.nodes().map((n) => [n.id(), n.position("x"), n.position("y")]) };
})()`;

/* ------------------------------------------------------------------------------------------ */
async function main() {
  const t0 = Date.now();
  const { server, origin } = await serve(DIST, SERVE_FROM);
  const harness = `${origin}/preview-live.html?engine=${ENGINE}`;
  log(`serving ${DIST} at ${origin}; engine ${ENGINE}; identity ${USER}; Chrome ${CHROME}`);
  const cdp = new Cdp(PORT);
  cdp.launch();
  const R = { engine: ENGINE, user: USER, harness, viewport: { w: WIDTH, h: HEIGHT }, dist: DIST };
  try {
    await cdp.connect();
    // Seed the identity in the harness's storage shim on the harness origin, then load.
    await cdp.navigate(`${origin}/`, 200);
    await cdp.eval(`localStorage.setItem(${JSON.stringify(SEED_KEY)}, ${JSON.stringify(JSON.stringify(SEED))}); true`);
    const t1 = Date.now();
    await cdp.send("Page.navigate", { url: harness });
    R.wait = await cdp.eval(WAIT_FRAME(90000));
    R.wait.ms_from_navigate = Date.now() - t1;
    if (!R.wait.nodes) throw new Error(`no frame drawn within 90 s (strip: ${R.wait.strip})`);
    log(`frame: ${R.wait.nodes} nodes / ${R.wait.relations} relations in ${R.wait.ms_from_navigate} ms — ${R.wait.strip}`);
    // PIL-5 — the first screen, then once the log feed under the canvas has settled it.
    R.pil5 = { first: await cdp.eval(VIEW(USER)) };
    await cdp.shot(join(OUT, "first-screen.png"));
    R.log = await cdp.eval(WAIT_LOG);
    R.pil5.settled = await cdp.eval(VIEW(USER));
    R.pil5.ok = R.pil5.settled.labelsDrawn && R.pil5.settled.identityInside && R.pil5.first.labelsDrawn && R.pil5.first.identityInside;
    log(`PIL-5 zoom ${R.pil5.first.zoom.toFixed(3)} first / ${R.pil5.settled.zoom.toFixed(3)} settled (cut ${R.pil5.settled.labelCut}), identity inside ${R.pil5.first.identityInside} / ${R.pil5.settled.identityInside}, canvas ${R.pil5.settled.canvas.w}x${R.pil5.settled.canvas.h}`);
    await cdp.shot(join(OUT, "settled-screen.png"));
    // PIL-8 — the strip.
    R.pil8 = await cdp.eval(STRIP);
    R.pil8.ok = R.pil8.hasNodesWord && R.pil8.cut.length === 0;
    log(`PIL-8 strip "${R.pil8.text}" — nodes word ${R.pil8.hasNodesWord}, cut ${R.pil8.cut.length}`);
    // PIL-9 — the legend.
    await cdp.clickSel(".graph-legend-toggle");
    await sleep(1200);
    R.pil9 = await cdp.eval(LEGEND);
    if (R.pil9) {
      R.pil9.insider = R.pil9.tooltips.filter((t) => INSIDER.test(t.title));
      R.pil9.ok = R.pil9.insider.length === 0 && R.pil9.grows;
      log(`PIL-9 ${R.pil9.tooltips.length} legend tooltips, ${R.pil9.insider.length} with insider terms; legend ${R.pil9.client_h} of ${R.pil9.scroll_h} px shown (grows: ${R.pil9.grows})`);
    }
    // PIL-10 — buttons: in the source, and in the DOM with the drawers open.
    R.pil10 = { source: COMPONENTS.map(([name]) => {
      const src = readFileSync(join(ROOT, "src/components", `${name}.tsx`), "utf8");
      const tags = src.match(/<button\b[^>]*>/gs) ?? [];
      return { component: name, buttons: tags.length, withTestid: tags.filter((t) => /data-testid=/.test(t)).length };
    }) };
    await cdp.clickSel(".settings-summary");
    await sleep(300);
    await cdp.clickSel(".gc-filter-summary");
    await sleep(300);
    R.pil10.dom = await cdp.eval(BUTTONS(COMPONENTS));
    const srcTotal = R.pil10.source.reduce((t, c) => t + c.buttons, 0);
    const srcWith = R.pil10.source.reduce((t, c) => t + c.withTestid, 0);
    R.pil10.ok = srcWith === srcTotal && !!R.pil10.dom.canvasAriaLabel;
    log(`PIL-10 source: ${srcWith} of ${srcTotal} <button> tags carry data-testid; DOM: ${R.pil10.dom.components.map((c) => `${c.component} ${c.withTestid}/${c.buttons}`).join(", ")}; canvas aria-label ${JSON.stringify(R.pil10.dom.canvasAriaLabel)}`);
    // PIL-7 — find, from the opening view.
    await cdp.clickSel(".gc-search input");
    await cdp.type(FIND);
    await sleep(2000);
    R.pil7 = await cdp.eval(FIND_PROBE);
    log(`PIL-7 find "${FIND}": ${R.pil7.hits} hits, hit ${R.pil7.hit && R.pil7.hit.label} in view ${R.pil7.hit && R.pil7.hit.inView}; relations ${JSON.stringify(R.pil7.relations.map((r) => `${r.label} opacity ${r.opacity} other ${r.other} in view ${r.otherInView}`))}; ${R.pil7.faded} faded; zoom ${R.pil7.zoom.toFixed(4)}; Apply ${JSON.stringify(R.pil7.apply)}`);
    await cdp.shot(join(OUT, "find.png"));
    // t343 (review): the same find from the `fit` view — the view PIL-5 keeps one click away.
    // The hit and its other ends must land inside the canvas again, at the same zoom.
    await cdp.clickSel(".gc-search input");
    await cdp.clearFocused();
    await sleep(800);
    await cdp.clickSel('[data-testid="fit"]');
    await sleep(800);
    await cdp.clickSel(".gc-search input");
    await cdp.type(FIND);
    await sleep(2000);
    R.pil7.fromFit = await cdp.eval(FIND_PROBE);
    R.pil7.fromFit.zoomEqual = Math.abs(R.pil7.fromFit.zoom - R.pil7.zoom) < 1e-3;
    R.pil7.ok = R.pil7.allRelationsLit && R.pil7.allOtherEndsInView && !!(R.pil7.hit && R.pil7.hit.inView)
      && !!(R.pil7.fromFit.hit && R.pil7.fromFit.hit.inView) && R.pil7.fromFit.allOtherEndsInView && R.pil7.fromFit.zoomEqual;
    log(`PIL-7 from fit: hit in view ${R.pil7.fromFit.hit && R.pil7.fromFit.hit.inView}, other ends in view ${R.pil7.fromFit.allOtherEndsInView}, zoom ${R.pil7.fromFit.zoom.toFixed(4)} (from the opening view ${R.pil7.zoom.toFixed(4)}; equal ${R.pil7.fromFit.zoomEqual})`);
    await cdp.shot(join(OUT, "find-from-fit.png"));
    // PIL-6 — contrast with the legend, the drawer, the audit and the inspector (a node selected) open.
    await cdp.clickSel(".prov-toggle");
    await sleep(400);
    const contrast = await cdp.eval(CONTRAST_PROBE);
    const buttons = await cdp.eval(BUTTON_TOKENS_PROBE);
    const items = contrast.items.filter((x) => !x.disabled);
    const failing = items.filter((x) => !x.pass);
    const group = (pred) => ({ items: items.filter(pred).length, failing: failing.filter(pred).length, examples: failing.filter(pred).slice(0, 6).map((x) => `${x.path} ${x.fg} on ${x.bg} ${x.ratio}`) });
    R.pil6 = { muted_token: contrast.muted, items: items.length, failing: failing.length, failing_pct: Math.round((1000 * failing.length) / (items.length || 1)) / 10,
      muted: group((x) => x.muted), links: group((x) => x.link), inspectorPorts: group((x) => x.inspectorPort),
      labels: { items: items.filter((x) => x.label).length, under11: items.filter((x) => x.label && x.size < 11).length, under11_examples: items.filter((x) => x.label && x.size < 11).slice(0, 8).map((x) => `${x.path} ${x.size}px "${x.text}"`) },
      sizes: Object.entries(items.reduce((m, x) => { const k = String(x.size); m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => Number(a[0]) - Number(b[0])),
      failing_by_colour: Object.entries(failing.reduce((m, x) => { const k = `${x.fg} on ${x.bg} ${x.ratio}`; m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 12),
      failing_by_path: Object.entries(failing.reduce((m, x) => { const k = x.path.split(" > ").pop(); m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 20) };
    R.pil6.buttons = buttons;
    R.pil6.ok = R.pil6.muted.failing === 0 && R.pil6.links.failing === 0 && R.pil6.inspectorPorts.failing === 0 && R.pil6.failing_pct < 5 && buttons.pass;
    log(`PIL-6 buttons: white text on --accent-button ${buttons.base.ratio} (${buttons.base.hex}), on --accent-button-hover ${buttons.hover.ratio} (${buttons.hover.hex}); both at least 4.5:1 ${buttons.pass}`);
    log(`PIL-6 contrast: ${failing.length} of ${items.length} failing (${R.pil6.failing_pct}%); --text-muted ${R.pil6.muted.failing}/${R.pil6.muted.items}, links ${R.pil6.links.failing}/${R.pil6.links.items}, inspector ports ${R.pil6.inspectorPorts.failing}/${R.pil6.inspectorPorts.items}; labels under 11 px ${R.pil6.labels.under11}/${R.pil6.labels.items}`);
    await cdp.clickSel(".prov-toggle");
    await cdp.clickSel(".gc-search input");
    await cdp.clearFocused();
    await sleep(800);
    // PIL-12 — re-layout with a selection: the selected node's component before and after. One
    // re-layout first, so the picture is packed for the settled canvas (the first paint's canvas
    // was taller); then a re-layout with a node selected, then one with the selection cleared.
    const relayout = async () => {
      await cdp.clickSel('.graph-bar button[title^="Run the"]');
      await sleep(2500);
      return cdp.eval(COMPONENT_POSITIONS);
    };
    const comp0 = await relayout();
    if (comp0.comp) {
      const pick = comp0.comp[Math.floor(comp0.comp.length / 2)];
      await cdp.eval(`(() => { const cy = ${CY}; const n = cy.getElementById(${JSON.stringify(pick)}); n.emit("tap"); return n.id(); })()`);
      await sleep(600);
      const before = await cdp.eval(COMPONENT_POSITIONS);
      const after = await relayout();
      const centroid = (at) => at.reduce((c, p) => [c[0] + p[0] / at.length, c[1] + p[1] / at.length], [0, 0]);
      const [cb, ca] = [centroid(before.at), centroid(after.at)];
      const moved = before.at.filter((p, i) => Math.hypot(p[0] - after.at[i][0], p[1] - after.at[i][1]) > 1).length;
      const allMoved = before.all.filter((p, i) => Math.hypot(p[1] - after.all[i][1], p[2] - after.all[i][2]) > 1).length;
      R.pil12 = { drawn: before.drawn, selected: before.selected, componentSize: before.comp.length, centroidMovePx: Math.round(Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) * 100) / 100, nodesMovedInComponent: moved, nodesMovedInFrame: allMoved, frameNodes: before.all.length };
      // the same with the selection cleared, for the baseline
      await cdp.eval(`(() => { const cy = ${CY}; cy.emit("tap"); return true; })()`);
      await sleep(400);
      const b2 = await cdp.eval(COMPONENT_POSITIONS);
      const a2 = await relayout();
      R.pil12.noSelection = { nodesMovedInFrame: b2.all.filter((p, i) => Math.hypot(p[1] - a2.all[i][1], p[2] - a2.all[i][2]) > 1).length };
      R.pil12.ok = R.pil12.centroidMovePx < 20;
      log(`PIL-12 ${before.drawn}: re-layout with ${before.selected} selected moves its ${before.comp.length}-node component's centroid ${R.pil12.centroidMovePx} px (${moved} nodes in it, ${allMoved} of ${before.all.length} in the frame moved > 1 px); with the selection cleared ${R.pil12.noSelection.nodesMovedInFrame} moved`);
    } else {
      R.pil12 = { drawn: comp0.drawn, skip: `SKIP: the ${comp0.drawn} layout has no components outside a box on this frame` };
      log(`PIL-12 ${R.pil12.skip}`);
    }
    R.nonGet = cdp.nonGet();
    R.consoleErrors = cdp.consoleErrors.slice(0, 10);
    R.run_ms = Date.now() - t0;
    const file = join(OUT, "ui-probe.json");
    writeFileSync(file, JSON.stringify(R, null, 1));
    const verdict = ["pil5", "pil6", "pil7", "pil8", "pil9", "pil10", "pil12"].map((k) => `${k.toUpperCase().replace("PIL", "PIL-")} ${R[k] ? (R[k].ok === undefined ? "SKIP" : R[k].ok ? "ok" : "not met") : "n/a"}`);
    log(`done in ${Math.round(R.run_ms / 1000)} s — ${verdict.join(" · ")}; non-GET requests ${R.nonGet.length}; console errors ${R.consoleErrors.length}; written ${file}`);
    if (R.nonGet.length) {
      console.error("UI PROBE: a request was not a GET", R.nonGet);
      process.exitCode = 1;
    }
  } catch (e) {
    console.error("UI PROBE failed:", e.message);
    process.exitCode = 1;
  } finally {
    cdp.close();
    server.close();
  }
}

main();
