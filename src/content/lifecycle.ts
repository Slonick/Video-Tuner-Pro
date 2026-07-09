const controller = new AbortController();
export const LAUNCHER_TOP_LAYER_ATTR = "data-vtp-launcher-top-layer";

export const contentSignal = controller.signal;

export function abortContentListeners(): void {
  controller.abort();
}

export function listenerOptions(
  options?: boolean | AddEventListenerOptions,
): boolean | AddEventListenerOptions {
  if (options === true) return { capture: true, signal: contentSignal };
  if (options === false || options == null) return { signal: contentSignal };
  return { ...options, signal: contentSignal };
}

export function listenerObjectOptions(options?: AddEventListenerOptions): AddEventListenerOptions {
  return { ...options, signal: contentSignal };
}
