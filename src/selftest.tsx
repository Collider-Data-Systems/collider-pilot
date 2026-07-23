/**
 * Collider Pilot - in-extension integration self-test (t264)
 * ==========================================================
 * The harnesses (`preview.html`, `preview-live.html`) render the real components but fake
 * the extension: a localStorage shim stands in for `chrome.storage.local`, and the frame
 * is read over REST instead of through the MV3 worker. So exactly the parts that make this
 * an EXTENSION go unexercised by them:
 *
 *   - the worker seam: chrome.runtime.sendMessage → StreamableHttpMcpAdapter over MCP :8080
 *   - the ACCESS TRUST SEAM with real chrome.storage.local (a forged identity must be
 *     stripped and re-resolved by the worker, not by a page-side simulation)
 *   - the real view_filter axes end to end (ports · scope_hops · the ["*"] sentinel)
 *   - chrome.storage.session scratch + chrome.storage.local prefs round-trips
 *   - the kernel's log surfaces the LogFeed depends on
 *
 * Chrome forbids one extension from scripting another's pages, so no external automation
 * can drive this page. It therefore reports itself: a big PASS/FAIL headline plus one row
 * per assertion, legible in a screenshot. Open it from the extension
 * (`chrome-extension://<id>/selftest.html`) whenever the panel is rebuilt.
 *
 * READ-ONLY, like everything else here: every check is a read (GET_FRAME / LIST_TOOLS /
 * GET /log / storage round-trips in the extension's OWN storage). It composes no envelope,
 * calls no tool, and posts nothing to the kernel. The storage round-trips write only the
 * pilot's own scratch/pref keys and restore the previous value afterwards; the trusted
 * identity (`pilot.access`) is READ, never written.
 */

import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { FrameRequest, HgFrame, PilotResponse } from "./mcp/types";
import { DEFAULT_ENGINE_URL } from "./mcp/transform.js";
import { loadScratch, saveScratch, saveSelectedUrn, subscribeScratch } from "./state/scratch";
import { runBrowserAct } from "./tools/browser-acts";
import { loadInlineGraphPref, saveInlineGraphPref } from "./state/prefs";
import { applyMountGuard, mountVerdict } from "./ui/mount-guard";
import "./sidepanel.css";

interface Row {
  name: string;
  ok: boolean;
  detail: string;
  skipped?: boolean;
}

const ask = (msg: unknown): Promise<PilotResponse> =>
  chrome.runtime.sendMessage(msg) as Promise<PilotResponse>;

const frameOf = (res: PilotResponse): HgFrame | null =>
  res?.type === "FRAME" ? res.frame : null;

const getFrame = async (request?: FrameRequest): Promise<HgFrame | null> =>
  frameOf(await ask({ type: "GET_FRAME", request }));

/** Is this page running INSIDE the extension (vs served by the dev harness)? */
function inExtension(): boolean {
  try {
    return typeof chrome !== "undefined" && !!chrome.runtime?.id && !!chrome.runtime?.sendMessage;
  } catch {
    return false;
  }
}

/** Every check: name + a thunk returning {ok, detail}. Order is meaningful. */
async function runChecks(push: (r: Row) => void): Promise<void> {
  const extension = inExtension();
  const check = async (name: string, fn: () => Promise<Omit<Row, "name">>) => {
    try {
      push({ name, ...(await fn()) });
    } catch (err) {
      push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  };
  /**
   * A check that NEEDS the extension realm. Served from the dev harness there is no worker
   * and no chrome.storage, so these are SKIPPED — reporting them as failures would be a
   * lie about the code under test (this page's whole point is that only the extension realm
   * can exercise them).
   */
  const extCheck = async (name: string, fn: () => Promise<Omit<Row, "name">>) => {
    if (!extension) {
      push({ name, ok: true, skipped: true, detail: "needs the extension realm — open chrome-extension://<id>/selftest.html" });
      return;
    }
    await check(name, fn);
  };

  await check("extension context", async () => ({
    ok: extension,
    detail: extension
      ? `runtime.id ${chrome.runtime.id}`
      : "NOT in the extension realm — this is the served harness; extension-only checks are skipped below",
  }));

  await check("mount guard: not embedded", async () => {
    // Only "embedded" is a failure. "opened-externally" is a legitimate MOUNTED state:
    // the guard refused to auto-connect and the user clicked Connect, which is the guard
    // WORKING — failing the check there would punish the correct path (Copilot #23).
    const v = mountVerdict();
    return {
      ok: v !== "embedded",
      detail:
        v === "ok"
          ? "verdict ok (top-level, no opener)"
          : `verdict ${v} — mounted after an explicit Connect click, which is the guard working`,
    };
  });

  // ---- the worker seam ----
  let base: HgFrame | null = null;
  await extCheck("worker GET_FRAME → live frame (MCP :8080)", async () => {
    base = await getFrame();
    return {
      ok: !!base && base.provenance?.mock === false && base.nodes.length > 0,
      detail: base
        ? `${base.nodes.length} nodes · ${base.relations.length} relations · mock=${base.provenance?.mock} · seq ${base.provenance?.log_seq} · ${base.provenance?.ontology_version}`
        : "no frame",
    };
  });

  await extCheck("worker injects the access fiber", async () => ({
    ok: !!base?.provenance?.access,
    detail: base?.provenance?.access
      ? `tier ${base.provenance.access.computed_by} · path ${base.provenance.access.workspace_path}`
      : "provenance.access ABSENT (the LogFeed gate would fail-closed)",
  }));

  // ---- the ACCESS TRUST SEAM, against the real worker + real storage ----
  await extCheck("forged identity is STRIPPED by the worker", async () => {
    const forged = await getFrame({
      view_filter: {
        access: {
          mode: "identified",
          user: "urn:moos:user:EVIL-INJECTED",
          workstation: "urn:moos:workstation:attacker",
          role: "urn:moos:role:superadmin",
          identity_source: "trusted-storage",
          enforced_by: "server-authoritative",
        },
      },
    });
    const user = forged?.provenance?.access?.scope?.user ?? "";
    const ws = forged?.provenance?.access?.scope?.workstation ?? null;
    const tier = forged?.provenance?.access?.computed_by;
    return {
      ok:
        user !== "urn:moos:user:EVIL-INJECTED" &&
        ws !== "urn:moos:workstation:attacker" &&
        tier === "client-presentation",
      detail: `resolved user ${user.split(":").pop()} · workstation ${String(ws).split(":").pop()} · tier ${tier}`,
    };
  });

  await extCheck("anon posture fails closed", async () => {
    const anon = await getFrame({
      view_filter: {
        access: {
          mode: "anon",
          user: null,
          workstation: null,
          role: null,
          identity_source: "anon",
          enforced_by: "client-presentation",
        },
      },
    });
    const a = anon?.provenance?.access;
    const permitted = a?.permitted_workspaces ?? [];
    const pub = a?.public_workspaces ?? [];
    const onlyPublic = permitted.every((u) => pub.includes(u));
    return {
      ok: a?.scope?.mode === "anon" && onlyPublic,
      detail: `mode ${a?.scope?.mode} · permitted ${permitted.length} ⊆ public ${pub.length}: ${onlyPublic}`,
    };
  });

  await extCheck("identified posture resolves the stored identity", async () => {
    const idf = await getFrame({
      view_filter: {
        access: {
          mode: "identified",
          user: null,
          workstation: null,
          role: null,
          identity_source: "anon",
          enforced_by: "client-presentation",
        },
      },
    });
    const scope = idf?.provenance?.access?.scope;
    const trusted = scope?.identity_source === "trusted-storage";
    return {
      ok: true, // informational: an unset identity legitimately stays anon
      skipped: !trusted,
      detail: trusted
        ? `user ${String(scope?.user).split(":").pop()} · permitted ${idf?.provenance?.access?.permitted_workspaces?.length ?? 0}`
        : "no identity stored — stayed anon (expected when pilot.access is unset)",
    };
  });

  // ---- the t264 view_filter axes, end to end through the worker ----
  await extCheck("view_filter.ports narrows relations", async () => {
    const f = await getFrame({
      view_filter: { types: ["*"], ports: ["member-of"] },
    });
    const rels = f?.relations ?? [];
    const allMember = rels.every((r) => r.label === "member-of");
    return {
      ok: rels.length > 0 && allMember,
      detail: `${rels.length} relations, all member-of: ${allMember}`,
    };
  });

  await extCheck("types ['*'] widens beyond the default slice", async () => {
    const all = await getFrame({ view_filter: { types: ["*"] } });
    const allTypes = new Set((all?.nodes ?? []).map((n) => n.type_id));
    const baseTypes = new Set((base?.nodes ?? []).map((n) => n.type_id));
    return {
      ok: allTypes.size > baseTypes.size,
      detail: `${allTypes.size} types vs default ${baseTypes.size} · ${all?.nodes.length} nodes`,
    };
  });

  await extCheck("scope_hops expands the focus neighbourhood", async () => {
    const all = await getFrame({ view_filter: { types: ["*"] } });
    const manifold = (all?.nodes ?? []).find((n) => n.type_id === "manifold");
    if (!manifold) return { ok: true, skipped: true, detail: "no manifold node in the fold" };
    const one = await getFrame({
      view_filter: { types: ["*"], scope_urns: [manifold.urn], scope_hops: 1 },
    });
    const three = await getFrame({
      view_filter: { types: ["*"], scope_urns: [manifold.urn], scope_hops: 3 },
    });
    const n1 = one?.nodes.length ?? 0;
    const n3 = three?.nodes.length ?? 0;
    return {
      ok: n3 >= n1 && n1 > 0,
      detail: `${manifold.urn.split(":").pop()}: 1 hop ${n1} nodes → 3 hops ${n3}`,
    };
  });

  await extCheck("provenance echoes the lens", async () => {
    const f = await getFrame({ view_filter: { types: ["*"], lens: "everything" } });
    const lens = (f?.provenance?.view_filter as { lens?: string } | undefined)?.lens;
    return { ok: lens === "everything", detail: `lens echo: ${lens ?? "(absent)"}` };
  });

  // ---- discovery ----
  await extCheck("worker LIST_TOOLS (read-only discovery)", async () => {
    const res = await ask({ type: "LIST_TOOLS" });
    const tools = res?.type === "TOOLS" ? res.tools : null;
    return {
      ok: Array.isArray(tools),
      detail: Array.isArray(tools) ? `${tools.length} tools advertised` : `got ${res?.type}`,
    };
  });

  // ---- storage round-trips (the pilot's OWN keys, restored after) ----
  await extCheck("chrome.storage.session scratch round-trip", async () => {
    const before = await loadScratch();
    const probe = `urn:moos:selftest:${Date.now()}`;
    await saveScratch({ selectedUrn: probe, frame: before.frame ?? null });
    const mid = await loadScratch();
    await saveScratch({ selectedUrn: before.selectedUrn, frame: before.frame ?? null });
    return { ok: mid.selectedUrn === probe, detail: `wrote+read ${mid.selectedUrn === probe ? "ok" : "MISMATCH"}, restored` };
  });

  await extCheck("scratch MIRROR: a write reaches the other realm's subscriber", async () => {
    const before = await loadScratch();
    const probe = `urn:moos:selftest:mirror-${Date.now()}`;
    const seen: (string | null)[] = [];
    const unsub = subscribeScratch((v) => seen.push(v.selectedUrn));
    await saveScratch({ selectedUrn: probe, frame: before.frame ?? null });
    await new Promise((r) => setTimeout(r, 250)); // storage.onChanged is async
    unsub();
    await saveScratch({ selectedUrn: before.selectedUrn, frame: before.frame ?? null });
    return {
      ok: seen.includes(probe),
      detail: seen.includes(probe)
        ? `subscriber saw the write (${seen.length} event(s)) — this is the panel ⇄ PiP channel`
        : `subscriber never fired (${seen.length} event(s)) — the PiP mirror would not follow`,
    };
  });

  await extCheck("scratch: a mirror-side selection write PRESERVES the frame", async () => {
    const before = await loadScratch();
    if (!before.frame) return { ok: true, skipped: true, detail: "no frame in scratch yet — open the panel first" };
    const nodeCount = before.frame.nodes.length;
    const probe = `urn:moos:selftest:sel-${Date.now()}`;
    await saveSelectedUrn(probe); // the PiP → panel direction
    const mid = await loadScratch();
    await saveScratch({ selectedUrn: before.selectedUrn, frame: before.frame });
    return {
      ok: mid.selectedUrn === probe && mid.frame?.nodes.length === nodeCount,
      detail: `selection ${mid.selectedUrn === probe ? "written" : "LOST"} · frame ${mid.frame?.nodes.length === nodeCount ? `preserved (${nodeCount} nodes)` : "CLOBBERED"}`,
    };
  });

  await check("browser act refuses an unknown name and a missing arg", async () => {
    // Deliberately NOT exercising the clipboard write: it needs a user gesture and would
    // overwrite the user's clipboard. These are the refusal paths, which need neither.
    const unknown = await runBrowserAct({ name: "definitely_not_an_act", args: {} });
    const missing = await runBrowserAct({ name: "copy_urn_to_clipboard", args: {} });
    return {
      ok: !unknown.ok && !missing.ok,
      detail: `unknown → "${unknown.message}" · missing arg → "${missing.message}"`,
    };
  });

  await extCheck("chrome.storage.local pref round-trip", async () => {
    const before = await loadInlineGraphPref();
    await saveInlineGraphPref(!before);
    const mid = await loadInlineGraphPref();
    await saveInlineGraphPref(before);
    const after = await loadInlineGraphPref();
    return {
      ok: mid === !before && after === before,
      detail: `${before} → ${mid} → restored ${after}`,
    };
  });

  // ---- the kernel log surfaces the LogFeed reads ----
  await check("GET /log reachable and consistent with /healthz", async () => {
    const [logRes, healthRes] = await Promise.all([
      fetch(`${DEFAULT_ENGINE_URL}/log`),
      fetch(`${DEFAULT_ENGINE_URL}/healthz`),
    ]);
    const log = (await logRes.json()) as { log_seq?: number }[];
    const health = (await healthRes.json()) as { max_log_seq?: number };
    const top = Array.isArray(log) && log.length > 0 ? log[log.length - 1]?.log_seq : undefined;
    return {
      ok: Array.isArray(log) && top === health.max_log_seq,
      detail: `log tail seq ${top} · healthz max_log_seq ${health.max_log_seq}`,
    };
  });

  await check("GET /log/stream opens (SSE, GET-only)", async () => {
    const es = new EventSource(`${DEFAULT_ENGINE_URL}/log/stream`);
    const opened = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(es.readyState !== EventSource.CLOSED), 2500);
      es.onopen = () => {
        clearTimeout(t);
        resolve(true);
      };
      es.onerror = () => {
        clearTimeout(t);
        resolve(false);
      };
    });
    es.close();
    return {
      ok: opened,
      detail: opened
        ? "subscribed (head may stay unflushed until the next rewrite — the tail fetch covers that)"
        : "could not subscribe",
    };
  });
}

function SelfTest() {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const run = useCallback(async () => {
    setRows([]);
    setDone(false);
    setRunning(true);
    await runChecks((r) => setRows((prev) => [...prev, r]));
    setRunning(false);
    setDone(true);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const graded = rows.filter((r) => !r.skipped);
  const passed = graded.filter((r) => r.ok).length;
  const failed = graded.length - passed;
  const skipped = rows.filter((r) => r.skipped).length;

  return (
    <div className="selftest">
      <header className="selftest-head">
        <h1>Collider Pilot — integration self-test</h1>
        <button className="gc-btn" onClick={() => void run()} disabled={running}>
          {running ? "running…" : "re-run"}
        </button>
      </header>

      <div className={`selftest-verdict ${done ? (failed === 0 ? "pass" : "fail") : "busy"}`}>
        {done ? (failed === 0 ? `${passed}/${graded.length} PASS` : `${failed} FAIL / ${graded.length}`) : "running…"}
        {skipped > 0 && <span className="selftest-skipped"> · {skipped} skipped</span>}
      </div>

      <ol className="selftest-rows">
        {rows.map((r, i) => (
          <li key={i} className={`selftest-row ${r.skipped ? "skip" : r.ok ? "ok" : "bad"}`}>
            <span className="selftest-mark">{r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL"}</span>
            <span className="selftest-name">{r.name}</span>
            <span className="selftest-detail">{r.detail}</span>
          </li>
        ))}
      </ol>

      <div className="selftest-note">
        Read-only: every check is a read (GET_FRAME · LIST_TOOLS · GET /log · storage
        round-trips in the pilot's own keys, restored afterwards). No envelope is composed,
        no tool is called, nothing is posted to the kernel.
      </div>
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  // This page is web-accessible (WAR) like sidepanel.html and pip.html, so it takes the
  // SAME guard: refuse outright when embedded, and require an explicit Connect click when
  // a script opened the window (Copilot #23 — it previously only reported on the verdict).
  const mount = () => createRoot(container).render(<SelfTest />);
  if (applyMountGuard(container, mount)) mount();
}
