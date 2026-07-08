// MAIN-world bootstrap for the quality bridge. Keep this at document_start so
// player constructors can still be hooked, but defer the heavy adapter bundle
// until the viewer actually asks for quality data.
(function () {
  "use strict";

  const LOADER_VERSION = "2026-07-08-lazy-quality";
  const QUALITY_BRIDGE_VERSION = "2026-07-07-local-roots";
  const win = window as typeof window & {
    __vtpQualityLoaderInstalled?: boolean | string;
    __vtpQualityLoaderCleanup?: () => void;
    __vtpQualityBridgeInstalled?: boolean | string;
  };
  if (win.__vtpQualityLoaderInstalled === LOADER_VERSION) return;
  try {
    win.__vtpQualityLoaderCleanup?.();
  } catch (e) {
    /* stale loader cleanup must not block the new loader */
  }
  win.__vtpQualityLoaderInstalled = LOADER_VERSION;

  const REQ = "vtp-quality-request";
  const SET = "vtp-quality-set";
  const ROOT_REQ_ATTR = "data-vtp-quality-request";
  const ROOT_PICK_ATTR = "data-vtp-quality-pick";

  let loading: Promise<void> | null = null;

  function bridgeLoaded(): boolean {
    return win.__vtpQualityBridgeInstalled === QUALITY_BRIDGE_VERSION;
  }

  function bridgeUrl(): string {
    const runtime = (
      globalThis as typeof globalThis & {
        chrome?: { runtime?: { getURL?: (path: string) => string } };
        browser?: { runtime?: { getURL?: (path: string) => string } };
      }
    ).chrome?.runtime;
    return (
      (
        runtime?.getURL ||
        (
          globalThis as typeof globalThis & {
            browser?: { runtime?: { getURL?: (path: string) => string } };
          }
        ).browser?.runtime?.getURL
      )?.("quality-inject.js") || "quality-inject.js"
    );
  }

  function loadBridge(): Promise<void> {
    if (bridgeLoaded()) return Promise.resolve();
    if (loading) return loading;
    const promise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = bridgeUrl();
      script.async = false;
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = () => {
        script.remove();
        reject(new Error("quality bridge failed to load"));
      };
      (document.head || document.documentElement || document.body).appendChild(script);
    }).finally(() => {
      loading = null;
    });
    loading = promise;
    return loading;
  }

  function replay(type: typeof REQ | typeof SET, detail?: unknown): void {
    document.dispatchEvent(new CustomEvent(type, { detail }));
  }

  function ensureForEvent(e: Event, type: typeof REQ | typeof SET): void {
    if (bridgeLoaded()) return;
    const detail = (e as CustomEvent).detail;
    e.stopImmediatePropagation();
    void loadBridge().then(
      () => replay(type, detail),
      () => {},
    );
  }

  const onQualityRequest = (e: Event) => ensureForEvent(e, REQ);
  const onQualitySet = (e: Event) => ensureForEvent(e, SET);
  document.addEventListener(REQ, onQualityRequest, true);
  document.addEventListener(SET, onQualitySet, true);

  const requestObserver = new MutationObserver(() => {
    if (bridgeLoaded() || !document.documentElement.hasAttribute(ROOT_REQ_ATTR)) return;
    const type = document.documentElement.hasAttribute(ROOT_PICK_ATTR) ? SET : REQ;
    void loadBridge().then(
      () => replay(type),
      () => {},
    );
  });
  requestObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [ROOT_REQ_ATTR],
  });

  win.__vtpQualityLoaderCleanup = () => {
    document.removeEventListener(REQ, onQualityRequest, true);
    document.removeEventListener(SET, onQualitySet, true);
    requestObserver.disconnect();
    if (win.__vtpQualityLoaderInstalled === LOADER_VERSION) {
      win.__vtpQualityLoaderInstalled = undefined;
    }
  };
})();
