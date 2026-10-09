/**
 * Collider Pilot - mirror view React hook (t337)
 * ==============================================
 * What a mirror window (Document PiP, popup, full tab) needs — beyond the frame and the
 * selection it already takes from the shared scratch — to draw what the panel draws:
 *
 *   - the graph layout CHOSEN in Settings. The mirrors used to mount the graph with no
 *     layout at all, so a layout picked in the panel never reached them;
 *   - the VIEW the panel's search and inspector put on the frame (`PilotScratchView`): the
 *     nodes a search matched (everything else fades) and the node an inspector relation
 *     row asked to centre on.
 *
 * Both are read once and then followed through `chrome.storage.onChanged` — event-driven,
 * no polling. One-way: a mirror never writes the layout or the view. Outside an extension
 * (the pip-preview harness) every read no-ops and the defaults stand.
 */

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_GRAPH_LAYOUT,
  loadLayoutPref,
  subscribeLayoutPref,
  type GraphLayoutName,
} from "./prefs";
import {
  loadScratchView,
  subscribeScratchView,
  type PilotScratchView,
  type ScratchFocus,
} from "./scratch";

export interface MirrorView {
  /** The layout choice (`auto` until one is stored). */
  layout: GraphLayoutName;
  /** urns the panel's search matched; empty = nothing fades. */
  highlightUrns: string[];
  /** The panel's latest centre request made while this mirror was open, or null. */
  focus: ScratchFocus | null;
}

export function useMirrorView(): MirrorView {
  const [layout, setLayout] = useState<GraphLayoutName>(DEFAULT_GRAPH_LAYOUT);
  const [highlightUrns, setHighlightUrns] = useState<string[]>([]);
  const [focus, setFocus] = useState<ScratchFocus | null>(null);
  // A centre request older than this mirror is history, not a request: opening a mirror
  // must not pan it to wherever the panel last searched.
  const openedAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    const adopt = (view: PilotScratchView) => {
      setHighlightUrns(view.highlightUrns);
      if (view.focus && view.focus.at > openedAt.current) setFocus(view.focus);
    };
    void loadLayoutPref().then((saved) => {
      if (!cancelled) setLayout(saved);
    });
    void loadScratchView().then((view) => {
      if (!cancelled) adopt(view);
    });
    const unsubLayout = subscribeLayoutPref(setLayout);
    const unsubView = subscribeScratchView(adopt);
    return () => {
      cancelled = true;
      unsubLayout();
      unsubView();
    };
  }, []);

  return { layout, highlightUrns, focus };
}
