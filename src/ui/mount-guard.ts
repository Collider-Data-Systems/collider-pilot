/**
 * Collider Pilot - extension-page mount guard (t264 review hardening)
 * ====================================================================
 * `web_accessible_resources` (the localhost dev bridge) lets pages on localhost NAVIGATE
 * to `sidepanel.html` / `pip.html`. Chrome match patterns carry no port, so that audience
 * is EVERY localhost port — the kernel, the twins, the router, Ollama, any dev server —
 * i.e. anything that can be induced to serve HTML on this machine, not just our harness.
 *
 * Two distinct exposures follow, and the guard closes both:
 *
 *   1. EMBEDDED (`window.top !== window`) — an iframe. Refused outright: an extension page
 *      has no business rendering inside someone else's document.
 *   2. OPENED (`window.opener !== null`) — `window.open(...)` makes a TOP-LEVEL window, so
 *      the iframe check alone passes it. Left unguarded, the panel would mount and
 *      immediately read a frame under the PERSISTED posture (possibly "identified"),
 *      starting identity-scoped kernel traffic with zero user interaction, in a window the
 *      opener chose the size and position of. The page therefore mounts NOTHING until a
 *      human clicks "Connect" in this window — the dev bridge still works (one click), the
 *      silent auto-connect vector does not exist.
 *
 * A page the USER opened themselves (the side panel, the pop-out, the full tab via
 * chrome.tabs.create) has no opener and is not framed, so it mounts as before — the guard
 * is invisible on every real path.
 */

export type MountVerdict = "ok" | "embedded" | "opened-externally";

/** Classify how this extension page was reached. */
export function mountVerdict(): MountVerdict {
  try {
    if (window.top !== window) return "embedded";
    // `window.opener` is non-null for window.open()'d pages (including noopener=false
    // bridges). chrome.tabs.create and the side panel leave it null.
    if (window.opener !== null && window.opener !== undefined) return "opened-externally";
  } catch {
    // A cross-origin `window.top` access throws — that itself means we are framed.
    return "embedded";
  }
  return "ok";
}

/**
 * Render the guard's UI into `container` and resolve the caller's mount decision.
 * Returns true when the app should mount NOW; false when the guard took the page over
 * (either refusing it, or waiting for the Connect click — which calls `onConnect`).
 */
export function applyMountGuard(container: HTMLElement, onConnect: () => void): boolean {
  const verdict = mountVerdict();
  if (verdict === "ok") return true;

  container.textContent = "";
  const box = document.createElement("div");
  box.className = "mount-guard";

  if (verdict === "embedded") {
    box.innerHTML =
      "<strong>Collider Pilot does not render embedded.</strong>" +
      "<p>This page refuses to run inside another document's frame.</p>";
    container.appendChild(box);
    return false;
  }

  // opened-externally: offer an explicit, human-driven connect.
  const title = document.createElement("strong");
  title.textContent = "Opened from another page";
  const note = document.createElement("p");
  note.textContent =
    "This window was opened by a script, so the seat has not connected to the engine. " +
    "Nothing has been read. Click Connect to load the frame under your saved posture.";
  const btn = document.createElement("button");
  btn.className = "mount-guard-btn";
  btn.textContent = "Connect";
  btn.addEventListener("click", () => {
    container.textContent = "";
    onConnect();
  });
  box.append(title, note, btn);
  container.appendChild(box);
  return false;
}
