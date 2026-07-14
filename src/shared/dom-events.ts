// Cross-world DOM event emitted by the MAIN-world bridge when a page attaches
// an open shadow root. The isolated content script listens for it so players
// created after the initial DOM scan are discovered without a periodic delay.
export const SHADOW_ROOT_ATTACHED_EVENT = "video-tuner-pro:shadow-root-attached";
