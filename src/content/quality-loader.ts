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
    __vtpQualityPlayers?: CapturedPlayer[];
    __vtpQualityHls?: CapturedHls[];
    IVSPlayer?: unknown;
    Hls?: unknown;
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
  const BRIDGE_URL_ATTR = "data-vtp-quality-bridge-url";
  const ROOT_REQ_ATTR = "data-vtp-quality-request";
  const ROOT_PICK_ATTR = "data-vtp-quality-pick";
  const MAX_CAPTURED_PLAYERS = 8;
  const MAX_CAPTURED_HLS = 8;
  const VIDEOLESS_PLAYER_TTL_MS = 30_000;

  interface TrustedTypesLike {
    createPolicy?: (
      name: string,
      rules: { createScriptURL: (url: string) => string },
    ) => { createScriptURL: (url: string) => unknown };
  }
  interface CapturedPlayer {
    player: unknown;
    video: HTMLVideoElement | null;
  }
  interface CapturedHls {
    hls: HlsLike;
    video: HTMLVideoElement | null;
  }
  interface HlsLike {
    media?: unknown;
  }
  interface HlsCtor {
    prototype?: {
      attachMedia?: (media: HTMLMediaElement) => unknown;
      __vtpWrapped?: boolean;
    };
  }

  win.__vtpQualityPlayers ||= [];
  win.__vtpQualityHls ||= [];

  let loading: Promise<void> | null = null;

  function bridgeLoaded(): boolean {
    return win.__vtpQualityBridgeInstalled === QUALITY_BRIDGE_VERSION;
  }

  function rememberCapturedPlayer(entry: CapturedPlayer): CapturedPlayer {
    try {
      Object.defineProperty(entry, "__vtpSeenAt", {
        value: Date.now(),
        writable: true,
        configurable: true,
      });
    } catch (e) {
      /* non-extensible page object wrapper */
    }
    return entry;
  }

  function capturedPlayerSeenAt(entry: CapturedPlayer): number {
    return (entry as CapturedPlayer & { __vtpSeenAt?: number }).__vtpSeenAt ?? Date.now();
  }

  function pruneCapturedPlayers(): void {
    const now = Date.now();
    win.__vtpQualityPlayers = (win.__vtpQualityPlayers || [])
      .filter(
        (entry) =>
          entry.video?.isConnected ||
          (!entry.video && now - capturedPlayerSeenAt(entry) < VIDEOLESS_PLAYER_TTL_MS),
      )
      .slice(-MAX_CAPTURED_PLAYERS);
  }

  function pruneCapturedHls(): void {
    win.__vtpQualityHls = (win.__vtpQualityHls || [])
      .filter((entry) => {
        const media = entry.hls.media;
        if (media instanceof HTMLMediaElement) return media.isConnected;
        return !!entry.video?.isConnected;
      })
      .slice(-MAX_CAPTURED_HLS);
  }

  function capturePlayer(player: unknown): unknown {
    if (!player || typeof player !== "object") return player;
    pruneCapturedPlayers();
    const existing = win.__vtpQualityPlayers!.find((entry) => entry.player === player);
    if (!existing) win.__vtpQualityPlayers!.push(rememberCapturedPlayer({ player, video: null }));
    if (win.__vtpQualityPlayers!.length > MAX_CAPTURED_PLAYERS) {
      win.__vtpQualityPlayers = win.__vtpQualityPlayers!.slice(-MAX_CAPTURED_PLAYERS);
    }
    const entry = existing || win.__vtpQualityPlayers![win.__vtpQualityPlayers!.length - 1];
    const rec = player as Record<string, unknown>;
    const attach = rec.attachHTMLVideoElement;
    if (typeof attach === "function" && !(attach as { __vtpWrapped?: boolean }).__vtpWrapped) {
      const wrapped = function (this: unknown, videoEl: HTMLVideoElement, ...args: unknown[]) {
        if (videoEl instanceof HTMLVideoElement) entry.video = videoEl;
        return attach.apply(this, [videoEl, ...args] as unknown as [HTMLVideoElement]);
      };
      (wrapped as { __vtpWrapped?: boolean }).__vtpWrapped = true;
      try {
        rec.attachHTMLVideoElement = wrapped;
      } catch (e) {
        /* read-only player */
      }
    }
    const getVideo = rec.getHTMLVideoElement;
    if (!entry.video && typeof getVideo === "function") {
      try {
        const videoEl = getVideo.call(player);
        if (videoEl instanceof HTMLVideoElement) entry.video = videoEl;
      } catch (e) {
        /* not ready */
      }
    }
    return player;
  }

  function hookIvsLibrary(lib: unknown): unknown {
    if (!lib || typeof lib !== "object") return lib;
    const rec = lib as Record<string, unknown>;
    const create = rec.create;
    if (typeof create !== "function" || (create as { __vtpWrapped?: boolean }).__vtpWrapped)
      return lib;
    const wrapped = function (this: unknown, ...args: unknown[]) {
      const player = create.apply(this, args as []);
      capturePlayer(player);
      return player;
    };
    (wrapped as { __vtpWrapped?: boolean }).__vtpWrapped = true;
    try {
      rec.create = wrapped;
    } catch (e) {
      /* read-only library */
    }
    return lib;
  }

  function installIvsHook(): void {
    let current: unknown;
    const descriptor = Object.getOwnPropertyDescriptor(window, "IVSPlayer");
    if (descriptor && !descriptor.configurable) {
      hookIvsLibrary(win.IVSPlayer);
      return;
    }
    if (descriptor && "value" in descriptor) current = descriptor.value;
    if (current !== undefined) hookIvsLibrary(current);
    try {
      Object.defineProperty(window, "IVSPlayer", {
        configurable: true,
        get() {
          return current;
        },
        set(value) {
          current = hookIvsLibrary(value);
        },
      });
    } catch (e) {
      hookIvsLibrary(win.IVSPlayer);
    }
  }

  function captureHls(hls: HlsLike, video: HTMLVideoElement | null): void {
    pruneCapturedHls();
    const existing = win.__vtpQualityHls!.find((entry) => entry.hls === hls);
    if (existing) {
      if (video) existing.video = video;
      return;
    }
    win.__vtpQualityHls!.push({ hls, video });
    if (win.__vtpQualityHls!.length > MAX_CAPTURED_HLS) {
      win.__vtpQualityHls = win.__vtpQualityHls!.slice(-MAX_CAPTURED_HLS);
    }
  }

  function hookHlsConstructor(value: unknown): boolean {
    if (typeof value !== "function") return false;
    const proto = (value as HlsCtor).prototype;
    const attach = proto?.attachMedia;
    if (!proto || typeof attach !== "function" || proto.__vtpWrapped) return !!proto?.__vtpWrapped;
    proto.attachMedia = function (this: HlsLike, media: HTMLMediaElement, ...args: unknown[]) {
      const result = attach.apply(this, [media, ...args] as unknown as [HTMLMediaElement]);
      if (media instanceof HTMLVideoElement) captureHls(this, media);
      return result;
    };
    proto.__vtpWrapped = true;
    return true;
  }

  function installHlsHook(): void {
    let current: unknown;
    const descriptor = Object.getOwnPropertyDescriptor(window, "Hls");
    if (descriptor && !descriptor.configurable) {
      hookHlsConstructor(win.Hls);
      return;
    }
    if (descriptor && "value" in descriptor) current = descriptor.value;
    else if (descriptor) {
      try {
        current = win.Hls;
      } catch (e) {
        current = undefined;
      }
    }
    if (current !== undefined) hookHlsConstructor(current);
    try {
      Object.defineProperty(window, "Hls", {
        configurable: true,
        get() {
          return current;
        },
        set(value) {
          current = value;
          hookHlsConstructor(value);
        },
      });
    } catch (e) {
      hookHlsConstructor(win.Hls);
    }
  }

  installIvsHook();
  installHlsHook();

  function validBridgeUrl(url: string | null): string | null {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "chrome-extension:" && parsed.protocol !== "moz-extension:")
        return null;
      return parsed.pathname.endsWith("/quality-inject.js") ? url : null;
    } catch (e) {
      return null;
    }
  }

  let runtimeBridgeUrl: string | null | undefined;

  function bridgeUrl(): string | null {
    const attrUrl = validBridgeUrl(document.documentElement.getAttribute(BRIDGE_URL_ATTR));
    if (attrUrl) return attrUrl;
    if (runtimeBridgeUrl !== undefined) return runtimeBridgeUrl;
    const runtime = (
      globalThis as typeof globalThis & {
        chrome?: { runtime?: { getURL?: (path: string) => string } };
        browser?: { runtime?: { getURL?: (path: string) => string } };
      }
    ).chrome?.runtime;
    const resolved =
      (
        runtime?.getURL ||
        (
          globalThis as typeof globalThis & {
            browser?: { runtime?: { getURL?: (path: string) => string } };
          }
        ).browser?.runtime?.getURL
      )?.("quality-inject.js") || null;
    runtimeBridgeUrl = validBridgeUrl(resolved);
    return runtimeBridgeUrl;
  }

  let trustedPolicy:
    | {
        createScriptURL: (url: string) => unknown;
      }
    | null
    | undefined;

  function bridgeScriptUrl(url: string): string | unknown {
    const tt = (globalThis as typeof globalThis & { trustedTypes?: TrustedTypesLike }).trustedTypes;
    if (!tt?.createPolicy) return url;
    if (trustedPolicy === undefined) {
      try {
        trustedPolicy = tt.createPolicy("video-tuner-quality-loader", {
          createScriptURL: (value) => value,
        });
      } catch (e) {
        trustedPolicy = null;
      }
    }
    return trustedPolicy?.createScriptURL(url) ?? url;
  }

  function loadBridge(): Promise<void> {
    if (bridgeLoaded()) return Promise.resolve();
    if (loading) return loading;
    const url = bridgeUrl();
    if (!url) return Promise.reject(new Error("quality bridge URL is unavailable"));
    const promise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      (script as unknown as { src: string | unknown }).src = bridgeScriptUrl(url);
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
