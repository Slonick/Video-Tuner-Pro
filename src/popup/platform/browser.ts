export const api = typeof browser !== "undefined" ? browser : chrome;

// The popup runs two ways: as the toolbar action page (a top-level extension page)
// and as the on-video overlay (an iframe embedded in the host page). In the embedded
// case Firefox doesn't resolve the host tab from tabs.query({active,currentWindow})
// — and may not expose tabs.* at all — so the overlay can't see the site or reach its
// content script. Route both through the background instead, which always knows the
// host tab from sender.tab. (Chrome works either way; this keeps one path for both.)
export const EMBEDDED = typeof window !== "undefined" && window.top !== window;

function runtimeSend<T = unknown>(msg: Record<string, unknown>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      api.runtime.sendMessage(msg, (r: unknown) =>
        resolve(api.runtime.lastError ? null : (r as T)),
      );
    } catch {
      resolve(null);
    }
  });
}

export function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  if (EMBEDDED) {
    return runtimeSend<{ tab?: chrome.tabs.Tab }>({ action: "whoami" }).then(
      (r) => r?.tab ?? undefined,
    );
  }
  return new Promise((resolve) => {
    api.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
}

// Send a message to the content script in tab `tabId`, resolving to its reply (or
// null when there's no receiver). Direct in the toolbar popup; relayed through the
// background when embedded as the overlay.
export function sendToTab<T = unknown>(
  tabId: number,
  msg: Record<string, unknown>,
): Promise<T | null> {
  if (EMBEDDED) return runtimeSend<T>({ action: "relayToTab", tabId, msg });
  return new Promise((resolve) => {
    try {
      api.tabs.sendMessage(tabId, msg, (resp: unknown) =>
        resolve(api.runtime.lastError || !resp ? null : (resp as T)),
      );
    } catch {
      resolve(null);
    }
  });
}
