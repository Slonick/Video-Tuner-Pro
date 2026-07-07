type PrefixedFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
};

const FULLSCREEN_CHANGE_EVENTS = [
  "fullscreenchange",
  "webkitfullscreenchange",
  "mozfullscreenchange",
  "MSFullscreenChange",
] as const;

export function currentFullscreenElement(): Element | null {
  const doc = document as PrefixedFullscreenDocument;
  return (
    document.fullscreenElement ||
    doc.webkitFullscreenElement ||
    doc.mozFullScreenElement ||
    doc.msFullscreenElement ||
    null
  );
}

export function fullscreenOverlayHost(): Element {
  const fsEl = currentFullscreenElement();
  return fsEl && fsEl.tagName !== "VIDEO" ? fsEl : document.body;
}

export function addFullscreenChangeListener(
  listener: EventListener,
  options?: AddEventListenerOptions,
): () => void {
  for (const event of FULLSCREEN_CHANGE_EVENTS) {
    document.addEventListener(event, listener, options);
  }
  return () => {
    for (const event of FULLSCREEN_CHANGE_EVENTS) {
      document.removeEventListener(event, listener, options);
    }
  };
}
