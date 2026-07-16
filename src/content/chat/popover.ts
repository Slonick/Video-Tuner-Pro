// Top-layer elevation shared by the chat surfaces (floating panel, FAB). On the
// native-player-surface path the site's player sits in the top layer; a chat
// host must be promoted there too, AFTER the player, so it paints above it.
export interface PopoverElevation {
  elevate(): void;
  // Guard-tick hook: re-show the popover if the page force-closed it.
  reelevate(): void;
  // Re-append to the top layer (hide+show) — needed after the player itself is
  // re-shown, which would otherwise paint above the chat.
  raise(): void;
  dispose(): void;
}

export function popoverElevation(host: HTMLElement): PopoverElevation {
  let elevated = false;
  let disposed = false;
  return {
    elevate(): void {
      if (elevated || disposed || typeof host.showPopover !== "function") return;
      host.setAttribute("popover", "manual");
      try {
        host.showPopover();
        elevated = true;
      } catch {
        host.removeAttribute("popover");
      }
    },
    reelevate(): void {
      if (!elevated || disposed) return;
      try {
        if (!host.matches(":popover-open")) host.showPopover?.();
      } catch {
        /* mid-teardown or already open */
      }
    },
    raise(): void {
      if (!elevated || disposed) return;
      try {
        host.hidePopover?.();
        host.showPopover?.();
      } catch {
        /* mid-teardown */
      }
    },
    dispose(): void {
      disposed = true;
      if (!elevated) return;
      try {
        host.hidePopover?.();
      } catch {
        /* already closed */
      }
    },
  };
}
