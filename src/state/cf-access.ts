/**
 * Collider Pilot - Cloudflare Access service-token store
 * =====================================================
 * The engines are reachable from off-LAN through a Cloudflare tunnel whose hostnames sit
 * behind Cloudflare Access. Access admits a machine only when the request carries a
 * service-token pair as headers:
 *
 *     CF-Access-Client-Id: <id>.access
 *     CF-Access-Client-Secret: <secret>
 *
 * WHY THIS IS A SEPARATE MODULE FROM `access-config.ts`. That one writes `pilot.access`, and
 * its contract says in as many words that it never stores a secret. This DOES store a secret,
 * so it gets its own key, its own module, and its own honest warning rather than quietly
 * widening that contract.
 *
 * WHAT THIS IS NOT. It is not authority over the graph. A service token is EDGE PASSAGE only —
 * it decides whether a request reaches the origin at all. Whether that request may WRITE is a
 * separate gate: the kernel's own bearer (`--auth-token-file`). Never reuse one as the other.
 *
 * STORAGE TIER. `chrome.storage.local` is extension-local and not synced. It is readable by
 * anything with access to this profile — same trust tier as the browser's own password store,
 * and strictly better than the alternative of embedding the pair in a committed config. The
 * pair is only ever sent to the two configured Cloudflare hostnames (see `isCloudHost`).
 *
 * Best-effort + fail-safe, mirroring prefs.ts: outside an extension (a served harness) or on
 * any storage error, every call silently no-ops and the pilot behaves exactly as it did before
 * — local engines over Tailscale need no token at all.
 */

export const PILOT_CF_ACCESS_KEY = "pilot.cfaccess";

export interface CfAccessConfig {
  /** Service-token Client ID. Cloudflare renders these ending in `.access`. */
  clientId: string;
  /** Service-token Client Secret. Shown once at creation. */
  clientSecret: string;
  /** Off switch that survives a round-trip: keep the pair, stop sending it. */
  enabled: boolean;
}

/** True when the config can actually authenticate (both halves present and switched on). */
export function isCfAccessSet(cfg: CfAccessConfig | null | undefined): boolean {
  return (
    !!cfg &&
    cfg.enabled === true &&
    typeof cfg.clientId === "string" &&
    cfg.clientId.length > 0 &&
    typeof cfg.clientSecret === "string" &&
    cfg.clientSecret.length > 0
  );
}

/**
 * Does this URL point at a Cloudflare-Access-protected host?
 *
 * The credential is attached ONLY to these. A localhost or Tailscale engine gets no Access
 * headers — sending them there would leak the pair onto the LAN for no benefit, since those
 * paths are not behind Access.
 */
export function isCloudHost(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && hostname.endsWith(".my-tiny-data-collider.nl");
  } catch {
    return false;
  }
}

/** Read the stored pair, or null when unset / unavailable. Never throws. */
export async function loadCfAccess(): Promise<CfAccessConfig | null> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const got = await chrome.storage.local.get(PILOT_CF_ACCESS_KEY);
      const cfg = got?.[PILOT_CF_ACCESS_KEY] as CfAccessConfig | undefined;
      return cfg ?? null;
    }
  } catch {
    // storage unavailable — treated as "no token set"
  }
  return null;
}

/** Persist the pair. Trims whitespace, which is the paste error that actually happens. */
export async function savePilotCfAccess(cfg: CfAccessConfig): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({
        [PILOT_CF_ACCESS_KEY]: {
          clientId: (cfg.clientId || "").trim(),
          clientSecret: (cfg.clientSecret || "").trim(),
          enabled: cfg.enabled === true,
        } satisfies CfAccessConfig,
      });
    }
  } catch {
    // best-effort
  }
}

/** Forget the pair entirely. */
export async function clearPilotCfAccess(): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.remove(PILOT_CF_ACCESS_KEY);
    }
  } catch {
    // best-effort
  }
}

/**
 * The headers to merge into a request for `url`, or `{}` when none apply.
 *
 * Returns an empty object — never throws, never partially applies — so every call site can
 * spread it unconditionally.
 */
export function cfAccessHeadersFor(
  url: string,
  cfg: CfAccessConfig | null | undefined,
): Record<string, string> {
  if (!isCfAccessSet(cfg) || !isCloudHost(url)) return {};
  return {
    "CF-Access-Client-Id": cfg!.clientId,
    "CF-Access-Client-Secret": cfg!.clientSecret,
  };
}
