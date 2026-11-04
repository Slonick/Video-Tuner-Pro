// Cross-world DOM event emitted by the MAIN-world bridge when a page attaches
// an open shadow root. The isolated content script listens for it so players
// created after the initial DOM scan are discovered without a periodic delay.
export const SHADOW_ROOT_ATTACHED_EVENT = "video-tuner-pro:shadow-root-attached";

// The MAIN-world quality loader fires LOAD when the viewer first asks for quality
// data. The isolated content script has the background inject the heavy bridge
// into that frame and fires READY once it has run, so no extension URL has to be
// exposed to the page.
export const QUALITY_BRIDGE_LOAD_EVENT = "video-tuner-pro:quality-bridge-load";
export const QUALITY_BRIDGE_READY_EVENT = "video-tuner-pro:quality-bridge-ready";
