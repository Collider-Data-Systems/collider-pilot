# PROVENANCE

Phase 0 of the Collider Pilot revival, per [Collider-Data-Systems/ffs0#158](https://github.com/Collider-Data-Systems/ffs0/issues/158)
(Steinberger readback T=260; decisions D1-D6 approved by Sam). Executed 2026-07-19.

This repo is the dedicated surface repo (decision D1). Legacy code lives on `legacy/*`
branches and is never the default branch. `main` carries only provenance + the clean MVP
to be built in Phase 1+.

## Pinned sources

| Source | Pinned SHA | Contributes (per #158 review table) | Disposition |
|---|---|---|---|
| [MSD21091969/collider_apps](https://github.com/MSD21091969/collider_apps/tree/1b4bc2f6634527e8392a25b40ba5a899b64ab1f9) | `1b4bc2f6634527e8392a25b40ba5a899b64ab1f9` | Architecture split (browser/runtime/SDK); shared TypeScript message types; app-context/tool-registration concept (`PilotSDK`); local inference as optional target; Document PiP experiment | Provenance source and contract quarry, not the build base |
| [MSD21091969/my-tiny-data-collider](https://github.com/MSD21091969/my-tiny-data-collider/tree/f423bb72a8f55c4934b4255337e0c1b9719e0447) | `f423bb72a8f55c4934b4255337e0c1b9719e0447` | Real React side-panel shell; narrower host scope; simple build boundary; bounded chat-history idea | Best UI/build scaffold after security rewrite (SHA re-pinned `3dd1267`→`f423bb7` — source history rewritten T=260 to purge a tracked GCP SA-key; identical tree, same message, new SHA) |
| [MSD21091969/ffs1-collider-super](https://github.com/MSD21091969/ffs1-collider-super/tree/8354e36894381e5eed6b5e79b6a60b343b17f461) | `8354e36894381e5eed6b5e79b6a60b343b17f461` | Feb-2026 devlogs: PiP phase-3 plan, requirements, NodeBrowser ideas, FFS5 WebRTC note | Archive and selectively mine; NOT imported into this repo |

Both pinned SHAs for `collider_apps` and `my-tiny-data-collider` were the `main` HEAD of
their repos at extraction time. **T=260 update:** `my-tiny-data-collider` history was
rewritten (`git filter-repo`) to purge a tracked GCP service-account key; its pin is
re-pointed `3dd1267`→`f423bb7` (identical tree, same commit message, new SHA), still
reachable from `origin/main`. The imported legacy code in this repo is unaffected.

## Extraction method

Tooling: git 2.52.0.windows.1, git-filter-repo `a40bce548d2c` (pip, scratchpad venv),
node v24.12.0, npm 11.6.2.

Per decision D3, no personal monorepo was transferred; only the Pilot lineage was
extracted, history-preserving:

1. Fresh full clone of each source repo (read-only; source repos untouched).
2. `git filter-repo --path pilot/ --path-rename pilot/:` on `collider_apps`
   -> branch **`legacy/pilot-2026-01`**.
3. `git filter-repo --path frontend/extension/ --path-rename frontend/extension/:` on
   `my-tiny-data-collider` -> branch **`legacy/sidepanel-2026-01`**.
4. Branches fetched into this repo from the filtered local clones; nothing was committed
   on top of the rewritten history.

Each extracted path was introduced in a single commit in its source repo, so each legacy
branch carries exactly one authentic commit (original author, date, message):

| Legacy branch | Head (rewritten) | Original source commit | Original date |
|---|---|---|---|
| `legacy/pilot-2026-01` | `41cd665` | `collider_apps@9d76186` "feat(pilot): initial scaffold - Chrome extension with WebLLM + browser awareness" | 2026-01-27 |
| `legacy/sidepanel-2026-01` | `4de463f` | `my-tiny-data-collider@f423bb7` (was `@3dd1267` pre-purge) "feat(frontend): extension build config + LoginPage component" | 2026-01-27 |

`ffs1-collider-super` was inspected at its pin (shallow fetch) for the secret scan and
historical record only; nothing from it was imported (it carries a tracked root `.env`
and mounts FFS2/FFS3 as submodules).

## Secret-scan summary (no values reproduced anywhere in this repo)

Patterns scanned across all three pinned working trees (text + binary): `AIza` Google API
keys, `sk-`/`sk-ant-` keys, `ghp_`/`github_pat_`/`gho_`/`ghs_` GitHub tokens, `AKIA` AWS
key IDs, PEM `PRIVATE KEY` blocks, `xox*` Slack tokens, `ya29.` Google OAuth tokens,
hardcoded bearer tokens, hardcoded password literals, firebase config refs, tracked
`.env` files, tracked key/db files.

| Repo | Path | Kind | Tracked? | Severity | Recommended action |
|---|---|---|---|---|---|
| my-tiny-data-collider | `mailmind-ai-djbuw-50d63f821f84.json` (root) | **GCP service-account key JSON** — `type: service_account`, PEM `private_key` present, full key-id filename | yes | **CRITICAL → RESOLVED (T=260)** | Key `50d63f821f84` **REVOKED** in GCP (`gcloud` verified: user-managed key list empty, only SYSTEM_MANAGED remain → credential dead). File **PURGED from all history** via `git filter-repo` + force-pushed (`main`→`f423bb7`, `feature/rebuild-v2`→`a62c48c`); verified 404 on both branches. NB the earlier running-state "purge done" was premature — the file was in fact still tracked at HEAD `3dd1267` until this pass. Not imported here. |
| my-tiny-data-collider | `collider.db`, `data/collider.db` | SQLite data files in VCS; binary pattern scan found no key material | yes | MEDIUM | Data hygiene: review contents, remove from history before any transfer. Not imported here. |
| my-tiny-data-collider | `frontend/.env.development` | Dev env file; keys `VITE_API_URL`, `VITE_DEV_SKIP_AUTH`, `VITE_DEV_USER_EMAIL`, `VITE_DEV_USER_PASSWORD`; password value placeholder-like (len 7) | yes | LOW | Dev-only convenience creds; untrack + gitignore in source at leisure. Not imported here. |
| my-tiny-data-collider | `frontend/src/config/devConfig.ts`, `tests/test_auth.py`, `tests/test_integration.py` | Hardcoded mock/test credentials (source comments them as fixed mock values) | yes | INFO | None. |
| my-tiny-data-collider | `tests/e2e/gemini_code_assist_test.html` | Password literal in a test fixture; dummy-likeness heuristic inconclusive | yes | LOW | Manual eyeball in the source repo. Not imported here. |
| ffs1-collider-super | `.env` (root, tracked) | Local dev config only — keys `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `DEV_ASSISTANT_WORKSPACE`, `DEV_ASSISTANT_HISTORY_FILE`; values are a local URL, a model name, and paths. **No live-shaped secret values found.** | yes | LOW | No rotation needed on current content. Still untrack + gitignore in the source repo, and re-check history before any transfer (older revisions of `.env` were not exhaustively audited). |
| collider_apps | — | No findings (tree at pin) | — | none | — |

### Import safety

Neither flagged file set intersects the imported paths. After extraction, **every
historical blob** of both legacy branches was re-scanned with the same patterns:
**zero hits**. No file was stripped from the imports — nothing secret-bearing was ever
inside `collider_apps/pilot/` or `my-tiny-data-collider/frontend/extension/`.

## Legacy build attempts

Recorded pass/fail only — legacy code was not repaired (Phase 0 rule). Toolchain:
node v24.12.0 / npm 11.6.2, Windows 11.

### `legacy/pilot-2026-01` (collider_apps pilot) — FAIL

- `npm ci`: fail — no `package-lock.json` in the pinned tree.

```
npm error code EUSAGE
npm error The `npm ci` command can only install with an existing package-lock.json or
npm error npm-shrinkwrap.json with lockfileVersion >= 1.
```

- `npm install`: fail — the declared dependencies do not exist on the npm registry
  (`@anthropic/webllm`, `@anthropic/webgpu-types`, `@anthropic/wasm-feature-detect` are
  not real packages; the plausibly intended ones are `@mlc-ai/web-llm`,
  `@webgpu/types`, `wasm-feature-detect`):

```
npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/@anthropic%2fwasm-feature-detect - Not found
npm error 404  The requested resource '@anthropic/wasm-feature-detect@^1.3.0' could not be found or you do not have permission to access it.
```

- `npm run build`: not reached (no `node_modules`).

Verdict: matches the #158 finding — this tree is a contract quarry, not a build base.
Its manifest was never installable as checked in.

### `legacy/sidepanel-2026-01` (my-tiny-data-collider frontend/extension) — PASS (via parent)

- The extracted subtree itself has **no `package.json`**; its build was owned by the
  parent `frontend/` directory in the source repo (`vite.config.extension.ts` +
  `build:extension` script). The branch alone is therefore not independently buildable —
  expected, and left as-is.
- Honest attempt at the pinned source (`my-tiny-data-collider@f423bb7`, was `@3dd1267` pre-purge, `frontend/`):
  - `npm ci`: **pass** — `added 296 packages in 29s` (lockfile intact and resolvable).
  - `npm run build:extension`: **pass** — vite v7.3.1:

```
dist-extension/content.js      2.57 kB │ gzip:   0.86 kB
dist-extension/worker.js      69.21 kB │ gzip:  13.89 kB
dist-extension/sidepanel.js  603.92 kB │ gzip: 106.39 kB
✓ built in 2.94s
✅ Copied extension static files to dist-extension/
```

Verdict: matches the #158 finding — this is the viable UI/build scaffold (after the
security rewrite listed in #158: no page-provided secrets, no ad hoc tool parser, no
`:8000` old-backend URLs, MV3-persistent state, act confirmation).

## Phase 0 checklist status

- [x] Sam approved destination repo (D1) — this repo, no org transfer of personal repos (D3).
- [x] Secret-scan all source repos; tracked `.env` addressed (benign content, action noted above; CRITICAL finding is the GCP key, outside the imported lineage).
- [x] Pinned the three reviewed source SHAs (this document).
- [x] Attempted clean builds of the pinned legacy sources; failures recorded verbatim, nothing repaired in place.
- [ ] Screenshot/video of a running legacy surface — open: the sidepanel `dist-extension/` builds; loading it unpacked in Chrome for a capture is left for the Phase 1 session.

**Phase 0 exit met:** we know what is code (side-panel extension: builds), what is
documentation-only (pilot: README/ARCHITECTURE describe entrypoints the tree never had;
manifest not installable), and what is secret-bearing (GCP service-account key at
my-tiny-data-collider root; nothing in the imported lineage).
