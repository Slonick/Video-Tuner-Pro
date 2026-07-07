type PrefixedFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
};

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
