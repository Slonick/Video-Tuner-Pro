// The floating chat panel remembers its spot relative to the VIDEO box, not the
// viewport: whichever video edge is nearer (horizontally and vertically) becomes
// the anchor, and the panel keeps its distance to it. When the box moves —
// format switch, window resize, side-chat gutter — the panel stays glued to the
// same corner of the picture.
export interface PanelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PanelAnchor {
  h: "left" | "right";
  v: "top" | "bottom";
  dx: number;
  dy: number;
}

// Which edges the panel gravitates to, judged by its center against the video's
// center, with the distances to those edges (may be negative when the panel
// hangs outside the box).
export function anchorFromRect(rect: PanelBox, box: PanelBox): PanelAnchor {
  const h = rect.left + rect.width / 2 <= box.left + box.width / 2 ? "left" : "right";
  const v = rect.top + rect.height / 2 <= box.top + box.height / 2 ? "top" : "bottom";
  return {
    h,
    v,
    dx: Math.round(
      h === "left" ? rect.left - box.left : box.left + box.width - rect.left - rect.width,
    ),
    dy: Math.round(
      v === "top" ? rect.top - box.top : box.top + box.height - rect.top - rect.height,
    ),
  };
}

export function positionFromAnchor(
  a: PanelAnchor,
  size: { width: number; height: number },
  box: PanelBox,
): { left: number; top: number } {
  return {
    left: Math.round(a.h === "left" ? box.left + a.dx : box.left + box.width - a.dx - size.width),
    top: Math.round(a.v === "top" ? box.top + a.dy : box.top + box.height - a.dy - size.height),
  };
}
