// MAIN-world quality bridge. It is intentionally request-driven: the isolated
// viewer marks the source <video> with a temporary id and asks for capabilities;
// this script searches near that element for known player engines and answers.
// No timers, no background DOM crawling.
(function () {
  "use strict";

  interface CapturedPlayer {
    player: unknown;
    video: HTMLVideoElement | null;
  }
  interface CapturedHls {
    hls: HlsLike;
    video: HTMLVideoElement | null;
  }

  const BRIDGE_VERSION = "2026-07-07-local-roots";
  const win = window as typeof window & {
    __vtpQualityBridgeInstalled?: boolean | string;
    __vtpQualityBridgeCleanup?: () => void;
    __vtpQualityPlayers?: CapturedPlayer[];
    __vtpQualityHls?: CapturedHls[];
    IVSPlayer?: unknown;
    Hls?: unknown;
  };
  if (win.__vtpQualityBridgeInstalled === BRIDGE_VERSION) return;
  try {
    win.__vtpQualityBridgeCleanup?.();
  } catch (e) {
    /* stale bridge cleanup must not block the new bridge */
  }
  win.__vtpQualityBridgeInstalled = BRIDGE_VERSION;
  win.__vtpQualityPlayers ||= [];
  win.__vtpQualityHls ||= [];

  function isActiveBridge(): boolean {
    return win.__vtpQualityBridgeInstalled === BRIDGE_VERSION;
  }

  const REQ = "vtp-quality-request";
  const RESP = "vtp-quality-response";
  const SET = "vtp-quality-set";
  const VIDEO_ATTR = "data-vtp-quality-id";
  const ROOT_REQ_ATTR = "data-vtp-quality-request";
  const ROOT_VIDEO_ATTR = "data-vtp-quality-video";
  const ROOT_PICK_ATTR = "data-vtp-quality-pick";
  const ROOT_RESP_ATTR = "data-vtp-quality-response";
  const ROOT_DEBUG_ATTR = "data-vtp-quality-debug";
  const MAX_CAPTURED_PLAYERS = 8;
  const MAX_CAPTURED_HLS = 8;
  const VIDEOLESS_PLAYER_TTL_MS = 30_000;
  const HLS_SELECTION_TTL_MS = 3000;
  const hlsSelections = new WeakMap<object, { id: string; expires: number }>();

  interface QualityOption {
    id: string;
    label: string;
    current?: boolean;
  }
  interface QualityResponse {
    requestId: string;
    options: QualityOption[];
    current: string;
  }
  interface Detail {
    requestId?: unknown;
    videoId?: unknown;
    qualityId?: unknown;
  }
  interface Adapter {
    options: () => QualityOption[] | Promise<QualityOption[]>;
    current: () => string | Promise<string>;
    set: (id: string) => void | Promise<void>;
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
    const entries = win.__vtpQualityPlayers || [];
    const now = Date.now();
    win.__vtpQualityPlayers = entries
      .filter(
        (entry) =>
          entry.video?.isConnected ||
          (!entry.video && now - capturedPlayerSeenAt(entry) < VIDEOLESS_PLAYER_TTL_MS),
      )
      .slice(-MAX_CAPTURED_PLAYERS);
  }

  function pruneCapturedHls(): void {
    const entries = win.__vtpQualityHls || [];
    win.__vtpQualityHls = entries
      .filter((entry) => {
        const media = entry.hls.media;
        if (media instanceof HTMLMediaElement) return media.isConnected;
        return !!entry.video?.isConnected;
      })
      .slice(-MAX_CAPTURED_HLS);
  }

  function pruneCapturedState(): void {
    pruneCapturedPlayers();
    pruneCapturedHls();
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

  installIvsHook();

  interface HlsCtor {
    prototype?: {
      attachMedia?: (media: HTMLMediaElement) => unknown;
      __vtpWrapped?: boolean;
    };
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

  installHlsHook();

  function detailOf(e: Event): Detail {
    const detail = (e as CustomEvent).detail || {};
    const root = document.documentElement;
    return {
      requestId: detail.requestId ?? root.getAttribute(ROOT_REQ_ATTR),
      videoId: detail.videoId ?? root.getAttribute(ROOT_VIDEO_ATTR),
      qualityId: detail.qualityId ?? root.getAttribute(ROOT_PICK_ATTR),
    };
  }

  function videoById(id: unknown): HTMLVideoElement | null {
    if (typeof id !== "string" || !id) return null;
    const selector = `video[${VIDEO_ATTR}="${CSS.escape(id)}"]`;
    try {
      const direct = document.querySelector<HTMLVideoElement>(selector);
      if (direct) return direct;
    } catch (e) {
      return null;
    }
    const queue: ParentNode[] = [];
    const seen = new WeakSet<object>();
    let budget = 250;
    try {
      for (const el of document.querySelectorAll("*")) {
        const sr = el.shadowRoot;
        if (sr) queue.push(sr);
      }
    } catch (e) {
      return null;
    }
    while (queue.length && budget-- > 0) {
      const root = queue.shift()!;
      if (seen.has(root)) continue;
      seen.add(root);
      try {
        const found = root.querySelector<HTMLVideoElement>(selector);
        if (found) return found;
        for (const el of root.querySelectorAll("*")) {
          const sr = el.shadowRoot;
          if (sr) queue.push(sr);
        }
      } catch (e) {
        /* inaccessible root */
      }
    }
    return null;
  }

  function videoFromEvent(e: Event, id: unknown): HTMLVideoElement | null {
    if (typeof id !== "string" || !id) return null;
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    for (const item of path) {
      if (item instanceof HTMLVideoElement && item.getAttribute(VIDEO_ATTR) === id) {
        return item;
      }
    }
    return videoById(id);
  }

  function labelFromHeight(h: unknown, bitrate?: unknown): string {
    const n = typeof h === "number" && isFinite(h) ? Math.round(h) : 0;
    if (n > 0) return `${n}p`;
    const b = typeof bitrate === "number" && isFinite(bitrate) ? Math.round(bitrate / 1000) : 0;
    return b > 0 ? `${b} kbps` : "Quality";
  }

  function uniqueOptions(items: QualityOption[]): QualityOption[] {
    const seen = new Set<string>();
    const out: QualityOption[] = [];
    for (const item of items) {
      if (!item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }

  function youtubeLabel(id: string): string {
    const map: Record<string, string> = {
      tiny: "144p",
      small: "240p",
      medium: "360p",
      large: "480p",
      hd720: "720p",
      hd1080: "1080p",
      hd1440: "1440p",
      hd2160: "2160p",
      highres: "Best",
      auto: "Auto",
    };
    return map[id] || id;
  }

  const youtubePending = new WeakMap<HTMLVideoElement, { id: string; until: number }>();

  function youtubeAdapter(v: HTMLVideoElement): Adapter | null {
    const root =
      (v.closest && v.closest(".html5-video-player")) ||
      document.querySelector(".html5-video-player");
    const p = root as
      | (HTMLElement & {
          getAvailableQualityLevels?: () => string[];
          getPlaybackQuality?: () => string;
          setPlaybackQuality?: (q: string) => void;
          setPlaybackQualityRange?: (min: string, max?: string) => void;
        })
      | null;
    if (!p || typeof p.getAvailableQualityLevels !== "function") return null;
    return {
      options() {
        const current = this.current();
        const levels = p.getAvailableQualityLevels?.() || [];
        const opts = levels.map((id) => ({ id, label: youtubeLabel(id), current: id === current }));
        return uniqueOptions([{ id: "auto", label: "Auto", current: current === "auto" }, ...opts]);
      },
      current() {
        try {
          const pending = youtubePending.get(v);
          if (pending) {
            if (Date.now() < pending.until) return pending.id;
            youtubePending.delete(v);
          }
          return p.getPlaybackQuality?.() || "auto";
        } catch (e) {
          return "auto";
        }
      },
      set(id: string) {
        youtubePending.set(v, { id, until: Date.now() + 12_000 });
        if (id === "auto") {
          p.setPlaybackQualityRange?.("auto");
          p.setPlaybackQuality?.("auto");
          return;
        }
        const apply = () => {
          p.setPlaybackQualityRange?.(id, id);
          p.setPlaybackQuality?.(id);
        };
        apply();
        window.setTimeout(apply, 250);
        window.setTimeout(apply, 900);
      },
    };
  }

  function isObj(x: unknown): x is Record<string, unknown> {
    return !!x && (typeof x === "object" || typeof x === "function");
  }

  function read(o: Record<string, unknown>, key: string): unknown {
    try {
      return o[key];
    } catch (e) {
      return null;
    }
  }

  function pushElementRoots(out: unknown[], el: Element | null): void {
    if (!el) return;
    out.push(el);
    for (const key of Object.keys(el)) {
      if (/^__react(?:Fiber|Props)\$/i.test(key))
        out.push((el as unknown as Record<string, unknown>)[key]);
    }
  }

  const rootsCache = new WeakMap<HTMLVideoElement, { local?: unknown[]; full?: unknown[] }>();
  let rootSearchMode: "local" | "full" = "full";
  const adapterCache = new WeakMap<
    HTMLVideoElement,
    { key: string; adapter: Adapter | null; until: number }
  >();
  const ADAPTER_MISS_TTL_MS = 2000;

  function adapterCacheKey(v: HTMLVideoElement): string {
    return `${v.getAttribute(VIDEO_ATTR) || ""}|${v.currentSrc || v.src || ""}|${v.duration || 0}`;
  }

  function rootsFor(v: HTMLVideoElement): unknown[] {
    const cached = rootsCache.get(v) || {};
    const mode = rootSearchMode;
    const hit = mode === "local" ? cached.local : cached.full;
    if (hit) return hit;
    const out: unknown[] = [v];
    let el: Element | null = v;
    for (let i = 0; i < 16 && el; i++) {
      pushElementRoots(out, el);
      if (el.parentElement) {
        el = el.parentElement;
        continue;
      }
      const root = el.getRootNode();
      el = root instanceof ShadowRoot ? root.host : null;
    }
    cached.local ||= out;
    if (mode === "full") {
      let budget = 2400;
      for (const node of document.querySelectorAll("*")) {
        if (budget-- <= 0) break;
        if (Object.keys(node).some((key) => /^__react(?:Fiber|Props)\$/i.test(key))) {
          pushElementRoots(out, node);
        }
      }
    }
    cached[mode] = out;
    rootsCache.set(v, cached);
    return out;
  }

  function findValue<T>(
    roots: unknown[],
    accept: (value: Record<string, unknown>) => T | null,
    maxBudget = 10000,
  ): T | null {
    const seen = new WeakSet<object>();
    const queue = roots.filter(isObj).map((value) => ({ value, depth: 0 }));
    let budget = maxBudget;
    while (queue.length && budget-- > 0) {
      const { value, depth } = queue.pop()!;
      if (seen.has(value)) continue;
      seen.add(value);
      const accepted = accept(value);
      if (accepted) return accepted;
      if (depth >= 8) continue;
      if (Array.isArray(value)) {
        for (const child of value.slice(0, 20)) {
          if (isObj(child)) queue.push({ value: child, depth: depth + 1 });
        }
      }
      const preferred = [
        "children",
        "props",
        "pendingProps",
        "memoizedProps",
        "memoizedState",
        "stateNode",
        "child",
        "sibling",
        "return",
        "dependencies",
        "firstContext",
        "memoizedValue",
        "hls",
        "hlsjs",
        "hlsInstance",
        "dash",
        "dashjs",
        "shaka",
        "player",
        "mediaPlayer",
        "mediaPlayerInstance",
        "videoPlayer",
        "tech_",
        "vhs",
        "api",
        "value",
        "state",
        "store",
        "core",
      ];
      const dynamic = Object.keys(value).filter((key) =>
        /props|state|store|node|child|return|memoized|pending|queue|dependencies|player|media|video|quality|hls|instance|context/i.test(
          key,
        ),
      );
      const keys = [...new Set([...preferred, ...dynamic])];
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i];
        const child = read(value, key);
        if (!isObj(child)) continue;
        const acceptedChild = accept(child);
        if (acceptedChild) return acceptedChild;
        queue.push({ value: child, depth: depth + 1 });
      }
    }
    return null;
  }

  function findValueInRoots<T>(
    roots: unknown[],
    accept: (value: Record<string, unknown>) => T | null,
  ): T | null {
    for (const root of roots) {
      if (!isObj(root)) continue;
      const found = findValue([root], accept, 300);
      if (found) return found;
    }
    return null;
  }

  interface HlsLike {
    levels?: Array<{ height?: number; bitrate?: number; name?: string }>;
    autoLevelEnabled?: boolean;
    currentLevel?: number;
    nextLevel?: number;
    loadLevel?: number;
    manualLevel?: number;
    media?: unknown;
  }
  function hlsAdapter(v: HTMLVideoElement): Adapter | null {
    let hls: HlsLike | null = null;
    pruneCapturedHls();
    for (const entry of win.__vtpQualityHls || []) {
      if (entry.hls.media instanceof HTMLVideoElement && entry.video !== entry.hls.media)
        entry.video = entry.hls.media;
      if (entry.video === v) {
        hls = entry.hls;
        break;
      }
    }
    hls ||= findValue(rootsFor(v), (o): HlsLike | null => {
      const levels = read(o, "levels");
      if (!Array.isArray(levels) || !levels.length) return null;
      if (read(o, "media") === v || "currentLevel" in o || "nextLevel" in o || "loadLevel" in o) {
        return o as unknown as HlsLike;
      }
      return null;
    });
    if (!hls || !Array.isArray(hls.levels) || hls.levels.length < 2) return null;
    return {
      options() {
        const current = this.current();
        return [
          { id: "auto", label: "Auto", current: current === "auto" },
          ...hls.levels!.map((level, i) => ({
            id: String(i),
            label: level.name || labelFromHeight(level.height, level.bitrate),
            current: String(i) === current,
          })),
        ];
      },
      current() {
        const picked = hlsSelections.get(hls);
        if (picked && picked.expires > Date.now()) return picked.id;
        if (
          hls.autoLevelEnabled === true ||
          hls.manualLevel === -1 ||
          hls.nextLevel === -1 ||
          hls.loadLevel === -1
        )
          return "auto";
        const n =
          typeof hls.currentLevel === "number"
            ? hls.currentLevel
            : typeof hls.nextLevel === "number"
              ? hls.nextLevel
              : -1;
        return n >= 0 ? String(n) : "auto";
      },
      set(id: string) {
        const n = id === "auto" ? -1 : Number(id);
        if (!Number.isFinite(n)) return;
        hlsSelections.set(hls, {
          id: n < 0 ? "auto" : String(n),
          expires: Date.now() + HLS_SELECTION_TTL_MS,
        });
        hls.currentLevel = n;
        hls.nextLevel = n;
        hls.loadLevel = n;
      },
    };
  }

  interface DashLike {
    getBitrateInfoListFor?: (type: string) => Array<{ height?: number; bitrate?: number }>;
    getQualityFor?: (type: string) => number;
    setQualityFor?: (type: string, quality: number) => void;
    updateSettings?: (settings: unknown) => void;
  }
  function dashAdapter(v: HTMLVideoElement): Adapter | null {
    const dash = findValue(rootsFor(v), (o): DashLike | null => {
      return typeof read(o, "getBitrateInfoListFor") === "function" &&
        typeof read(o, "setQualityFor") === "function"
        ? (o as unknown as DashLike)
        : null;
    });
    const levels = dash?.getBitrateInfoListFor?.("video") || [];
    if (!dash || levels.length < 2) return null;
    return {
      options() {
        const current = this.current();
        return [
          { id: "auto", label: "Auto", current: current === "auto" },
          ...levels.map((level, i) => ({
            id: String(i),
            label: labelFromHeight(level.height, level.bitrate),
            current: String(i) === current,
          })),
        ];
      },
      current() {
        const q = dash.getQualityFor?.("video");
        return typeof q === "number" && q >= 0 ? String(q) : "auto";
      },
      set(id: string) {
        const auto = id === "auto";
        dash.updateSettings?.({ streaming: { abr: { autoSwitchBitrate: { video: auto } } } });
        if (!auto) dash.setQualityFor?.("video", Number(id));
      },
    };
  }

  interface ShakaTrack {
    id: number;
    height?: number;
    bandwidth?: number;
    active?: boolean;
    type?: string;
  }
  interface ShakaLike {
    getVariantTracks?: () => ShakaTrack[];
    selectVariantTrack?: (track: ShakaTrack, clearBuffer?: boolean) => void;
    configure?: (settings: unknown) => void;
  }
  function shakaAdapter(v: HTMLVideoElement): Adapter | null {
    const shaka = findValue(rootsFor(v), (o): ShakaLike | null => {
      return typeof read(o, "getVariantTracks") === "function" &&
        typeof read(o, "selectVariantTrack") === "function"
        ? (o as unknown as ShakaLike)
        : null;
    });
    const tracks = (shaka?.getVariantTracks?.() || []).filter((t) => t.type !== "audio");
    if (!shaka || tracks.length < 2) return null;
    return {
      options() {
        const current = this.current();
        return [
          { id: "auto", label: "Auto", current: current === "auto" },
          ...tracks.map((track) => ({
            id: String(track.id),
            label: labelFromHeight(track.height, track.bandwidth),
            current: String(track.id) === current,
          })),
        ];
      },
      current() {
        const active = tracks.find((t) => t.active);
        return active ? String(active.id) : "auto";
      },
      set(id: string) {
        const auto = id === "auto";
        shaka.configure?.({ abr: { enabled: auto } });
        if (!auto) {
          const track = tracks.find((t) => String(t.id) === id);
          if (track) shaka.selectVariantTrack?.(track, true);
        }
      },
    };
  }

  interface VidstackQuality {
    height?: number;
    bitrate?: number;
    label?: string;
    selected?: boolean;
  }
  interface VidstackQualityList {
    auto?: boolean;
    autoSelect?: () => void;
    length?: number;
    [Symbol.iterator]?: () => IterableIterator<VidstackQuality>;
    [n: number]: VidstackQuality;
  }
  interface VidstackPlayerElement extends HTMLElement {
    qualities?: VidstackQualityList;
  }
  function vidstackAdapter(v: HTMLVideoElement): Adapter | null {
    const host = rootsFor(v).find(
      (root): root is VidstackPlayerElement =>
        root instanceof HTMLElement &&
        root.localName === "media-player" &&
        typeof (root as VidstackPlayerElement).qualities === "object",
    );
    const list = host?.qualities;
    const qualities = (): VidstackQuality[] => {
      if (!list) return [];
      if (typeof list[Symbol.iterator] === "function") {
        return Array.from(list as Iterable<VidstackQuality>);
      }
      return Array.from({ length: list.length || 0 }, (_x, i) => list[i]).filter(Boolean);
    };
    if (!host || qualities().length < 2) return null;
    const qualityId = (quality: VidstackQuality, index: number): string => {
      const height =
        typeof quality.height === "number" && isFinite(quality.height)
          ? Math.round(quality.height)
          : 0;
      return height > 0 ? `h${height}` : `index:${index}`;
    };
    const label = (quality: VidstackQuality, index: number): string =>
      quality.label || labelFromHeight(quality.height, quality.bitrate) || `Quality ${index + 1}`;
    return {
      options() {
        const current = this.current();
        return [
          { id: "auto", label: "Auto", current: current === "auto" },
          ...qualities().map((quality, index) => ({
            id: qualityId(quality, index),
            label: label(quality, index),
            current: qualityId(quality, index) === current,
          })),
        ];
      },
      current() {
        if (list?.auto === true) return "auto";
        const selected = qualities().findIndex((quality) => quality?.selected === true);
        return selected >= 0 ? qualityId(qualities()[selected], selected) : "auto";
      },
      set(id: string) {
        if (!list) return;
        if (id === "auto") {
          try {
            list.autoSelect?.();
          } catch (e) {
            /* optional player API */
          }
          try {
            list.auto = true;
          } catch (e) {
            /* read-only player API */
          }
          return;
        }
        const items = qualities();
        const index = items.findIndex((quality, i) => qualityId(quality, i) === id);
        if (index < 0) return;
        try {
          items[index].selected = true;
        } catch (e) {
          /* read-only player API */
        }
        try {
          list.auto = false;
        } catch (e) {
          /* read-only player API */
        }
      },
    };
  }

  interface VideoJsQuality {
    height?: number;
    bitrate?: number;
    id?: string;
    enabled?: boolean | ((enabled?: boolean) => boolean);
  }
  interface VideoJsQualityList {
    length: number;
    selectedIndex?: number;
    [n: number]: VideoJsQuality;
  }
  function videoJsAdapter(v: HTMLVideoElement): Adapter | null {
    const player = findValue(rootsFor(v), (o): Record<string, unknown> | null => {
      return typeof read(o, "qualityLevels") === "function" ? o : null;
    });
    const list = (player?.qualityLevels as (() => VideoJsQualityList) | undefined)?.();
    if (!list || list.length < 2) return null;
    const levels = Array.from({ length: list.length }, (_x, i) => list[i]);
    return {
      options() {
        const current = this.current();
        return [
          { id: "auto", label: "Auto", current: current === "auto" },
          ...levels.map((level, i) => ({
            id: String(i),
            label: labelFromHeight(level.height, level.bitrate),
            current: String(i) === current,
          })),
        ];
      },
      current() {
        return typeof list.selectedIndex === "number" && list.selectedIndex >= 0
          ? String(list.selectedIndex)
          : "auto";
      },
      set(id: string) {
        const auto = id === "auto";
        levels.forEach((level, i) => {
          const enabled = auto || String(i) === id;
          if (typeof level.enabled === "function") level.enabled(enabled);
          else level.enabled = enabled;
        });
      },
    };
  }

  interface StoreLike<T = unknown> {
    subscribe?: (fn: (value: T) => void) => (() => void) | void;
  }
  interface VkQuality {
    value?: string;
    displayValue?: string;
    selected?: boolean;
  }
  interface VkPlayerLike {
    info?: Record<string, StoreLike>;
    setQuality?: (quality: string) => void;
    setAutoQuality?: (enabled: boolean) => void;
  }
  interface VkVideoPlayerElement extends HTMLElement {
    store?: {
      state?: Record<string, StoreLike>;
      getPlayer?: () => VkPlayerLike;
    };
  }
  function readStoreValue<T>(store: StoreLike<T> | undefined): T | null {
    if (!store || typeof store.subscribe !== "function") return null;
    let value: T | null = null;
    try {
      const unsubscribe = store.subscribe((next) => {
        value = next;
      });
      if (typeof unsubscribe === "function") unsubscribe();
    } catch (e) {
      return null;
    }
    return value;
  }
  function vkVideoPlayerAdapter(v: HTMLVideoElement): Adapter | null {
    const host = rootsFor(v).find(
      (root): root is VkVideoPlayerElement =>
        root instanceof HTMLElement &&
        root.localName === "vk-video-player" &&
        typeof (root as VkVideoPlayerElement).store?.getPlayer === "function",
    );
    const player = host?.store?.getPlayer?.();
    const state = host?.store?.state;
    if (!host || !player || typeof player.setQuality !== "function") return null;
    const qualities = (): VkQuality[] => {
      const rich = readStoreValue<VkQuality[]>(
        state?.availableQualities$ as StoreLike<VkQuality[]> | undefined,
      );
      if (Array.isArray(rich) && rich.length) return rich;
      const simple = readStoreValue<string[]>(
        player.info?.availableQualities$ as StoreLike<string[]> | undefined,
      );
      if (!Array.isArray(simple) || !simple.length) return [];
      const current = readStoreValue<string>(
        player.info?.currentQuality$ as StoreLike<string> | undefined,
      );
      const auto =
        readStoreValue<boolean>(
          player.info?.isAutoQualityEnabled$ as StoreLike<boolean> | undefined,
        ) === true;
      return [
        { value: "auto", displayValue: "Auto", selected: auto },
        ...simple.map((quality) => ({
          value: quality,
          displayValue: quality,
          selected: !auto && quality === current,
        })),
      ];
    };
    if (qualities().length < 2) return null;
    return {
      options() {
        return uniqueOptions(
          qualities()
            .filter((quality) => typeof quality.value === "string" && quality.value)
            .map((quality) => ({
              id: quality.value!,
              label: quality.displayValue || quality.value!,
              current: quality.selected === true,
            })),
        );
      },
      current() {
        if (
          readStoreValue<boolean>(
            player.info?.isAutoQualityEnabled$ as StoreLike<boolean> | undefined,
          ) === true
        ) {
          return "auto";
        }
        return (
          readStoreValue<string>(player.info?.currentQuality$ as StoreLike<string> | undefined) ||
          "auto"
        );
      },
      set(id: string) {
        if (id === "auto") {
          player.setAutoQuality?.(true);
          return;
        }
        player.setAutoQuality?.(false);
        player.setQuality?.(id);
      },
    };
  }

  interface IvsQuality {
    name?: string;
    codecs?: string;
    width?: number;
    height?: number;
    bitrate?: number;
    framerate?: number;
  }
  interface IvsLike {
    getQualities?: () => IvsQuality[];
    getQuality?: () => IvsQuality | null;
    setQuality?: (quality: IvsQuality, adaptive?: boolean) => void;
    isAutoQualityMode?: () => boolean;
    setAutoQualityMode?: (enabled: boolean) => void;
    getHTMLVideoElement?: () => HTMLVideoElement;
  }
  function ivsLabel(q: IvsQuality): string {
    if (q.name) return q.name;
    if (q.height) return `${Math.round(q.height)}p${q.framerate ? Math.round(q.framerate) : ""}`;
    return labelFromHeight(q.height, q.bitrate);
  }
  function ivsId(q: IvsQuality, index: number): string {
    return [
      q.name || "",
      q.width || "",
      q.height || "",
      q.bitrate || "",
      q.framerate || "",
      index,
    ].join(":");
  }
  function ivsAdapter(v: HTMLVideoElement): Adapter | null {
    let player: IvsLike | null = null;
    pruneCapturedPlayers();
    for (const entry of win.__vtpQualityPlayers || []) {
      const p = entry.player as IvsLike;
      if (typeof p?.getQualities !== "function" || typeof p?.setQuality !== "function") continue;
      let pv = entry.video;
      if (!pv && typeof p.getHTMLVideoElement === "function") {
        try {
          pv = p.getHTMLVideoElement();
          if (pv instanceof HTMLVideoElement) entry.video = pv;
        } catch (e) {
          /* not ready */
        }
      }
      if (pv === v) {
        player = p;
        break;
      }
    }
    const acceptIvs = (o: Record<string, unknown>): IvsLike | null =>
      typeof read(o, "getQualities") === "function" && typeof read(o, "setQuality") === "function"
        ? (o as unknown as IvsLike)
        : null;
    const roots = rootsFor(v);
    player ||= findValue(roots, acceptIvs) || findValueInRoots(roots, acceptIvs);
    const qualities = player?.getQualities?.() || [];
    if (!player || qualities.length < 2) return null;
    let manualCurrent: string | null = null;
    const idForQuality = (quality: IvsQuality | null | undefined): string => {
      if (!quality) return "auto";
      const index = qualities.indexOf(quality);
      if (index >= 0) return ivsId(quality, index);
      const match = qualities.findIndex((q) => ivsLabel(q) === ivsLabel(quality));
      return match >= 0 ? ivsId(qualities[match], match) : "auto";
    };
    return {
      options() {
        const current = this.current();
        return [
          { id: "auto", label: "Auto", current: current === "auto" },
          ...qualities.map((quality, i) => {
            const id = ivsId(quality, i);
            return { id, label: ivsLabel(quality), current: id === current };
          }),
        ];
      },
      current() {
        if (manualCurrent) return manualCurrent;
        const auto = player.isAutoQualityMode?.();
        if (auto) return "auto";
        return idForQuality(player.getQuality?.());
      },
      set(id: string) {
        if (id === "auto") {
          manualCurrent = "auto";
          player.setAutoQualityMode?.(true);
          return;
        }
        const quality = qualities.find((q, i) => ivsId(q, i) === id);
        if (quality) {
          manualCurrent = id;
          player.setAutoQualityMode?.(false);
          player.setQuality?.(quality, false);
        }
      },
    };
  }

  function adapterFor(v: HTMLVideoElement): Adapter | null {
    pruneCapturedState();
    const cacheKey = adapterCacheKey(v);
    const cached = adapterCache.get(v);
    if (cached?.key === cacheKey && (cached.adapter || Date.now() < cached.until))
      return cached.adapter;
    rootsCache.delete(v);
    const find = (): Adapter | null =>
      youtubeAdapter(v) ||
      ivsAdapter(v) ||
      vkVideoPlayerAdapter(v) ||
      vidstackAdapter(v) ||
      hlsAdapter(v) ||
      dashAdapter(v) ||
      shakaAdapter(v) ||
      videoJsAdapter(v);
    try {
      rootSearchMode = "local";
      const local = find();
      if (local) {
        adapterCache.set(v, { key: cacheKey, adapter: local, until: Infinity });
        return local;
      }
      rootSearchMode = "full";
      const full = find();
      adapterCache.set(v, {
        key: cacheKey,
        adapter: full,
        until: full ? Infinity : Date.now() + ADAPTER_MISS_TTL_MS,
      });
      return full;
    } finally {
      rootSearchMode = "full";
    }
  }

  function debugFor(v: HTMLVideoElement, adapter: Adapter | null): string {
    const now = (): number => window.performance?.now?.() ?? Date.now();
    const started = now();
    const seen = new WeakSet<object>();
    const queue = rootsFor(v)
      .filter(isObj)
      .map((value) => ({ value, depth: 0, path: "video" }));
    const hits: Array<Record<string, unknown>> = [];
    const preferred = [
      "hls",
      "hlsjs",
      "hlsInstance",
      "dash",
      "dashjs",
      "shaka",
      "player",
      "mediaPlayer",
      "mediaPlayerInstance",
      "videoPlayer",
      "tech_",
      "vhs",
      "api",
      "value",
    ];
    let budget = 80;
    while (queue.length && budget-- > 0) {
      const { value, depth, path } = queue.shift()!;
      if (seen.has(value)) continue;
      seen.add(value);
      const levels = read(value, "levels");
      const hit: Record<string, unknown> = { path };
      let matched = false;
      if (Array.isArray(levels)) {
        hit.levels = levels.length;
        hit.currentLevel = read(value, "currentLevel");
        hit.hasMedia = !!read(value, "media");
        matched = true;
      }
      if (typeof read(value, "qualityLevels") === "function") {
        hit.videoJs = true;
        matched = true;
      }
      if (typeof read(value, "getVariantTracks") === "function") {
        hit.shaka = true;
        matched = true;
      }
      if (typeof read(value, "getBitrateInfoListFor") === "function") {
        hit.dash = true;
        matched = true;
      }
      if (
        typeof read(value, "getQualities") === "function" ||
        typeof read(value, "setQuality") === "function"
      ) {
        hit.qualityMethods = {
          get: typeof read(value, "getQualities") === "function",
          set: typeof read(value, "setQuality") === "function",
        };
        matched = true;
      }
      if (matched) hits.push(hit);
      if (depth >= 2) continue;
      for (const key of preferred) {
        const child = read(value, key);
        if (isObj(child)) queue.push({ value: child, depth: depth + 1, path: `${path}.${key}` });
      }
    }
    return JSON.stringify({
      adapter: !!adapter,
      ms: Math.round((now() - started) * 10) / 10,
      capturedPlayers: (win.__vtpQualityPlayers || []).map((entry) => {
        const player = entry.player as Record<string, unknown>;
        return {
          ctor: isObj(player) ? player.constructor?.name : typeof player,
          video: entry.video
            ? {
                w: entry.video.videoWidth,
                h: entry.video.videoHeight,
                paused: entry.video.paused,
              }
            : null,
          hasQualities: typeof player.getQualities === "function",
          hasQuality: typeof player.getQuality === "function",
          hasSetQuality: typeof player.setQuality === "function",
        };
      }),
      hits: hits.slice(0, 20),
    });
  }

  async function respond(
    requestId: string,
    adapter: Adapter | null,
    presetOptions?: QualityOption[],
    presetCurrent?: string,
    debugVideoId?: unknown,
  ): Promise<void> {
    if (!isActiveBridge()) return;
    const options = presetOptions || (adapter ? await adapter.options() : []);
    let current = presetCurrent || (adapter ? await adapter.current() : "auto");
    if (!isActiveBridge()) return;
    const selected = options.find((opt) => opt.current);
    if (selected && !options.some((opt) => opt.id === current && opt.current))
      current = selected.id;
    const payload: QualityResponse = {
      requestId,
      options,
      current,
    };
    document.documentElement.setAttribute(ROOT_RESP_ATTR, JSON.stringify(payload));
    const debugEnabled = document.documentElement.getAttribute(ROOT_DEBUG_ATTR) === "1";
    if (debugEnabled && (!adapter || options.length < 2)) {
      try {
        const video = videoById(
          debugVideoId ?? document.documentElement.getAttribute(ROOT_VIDEO_ATTR),
        );
        if (video) {
          const debug = debugFor(video, adapter);
          document.documentElement.setAttribute(ROOT_DEBUG_ATTR, debug);
        }
      } catch (e) {
        document.documentElement.setAttribute(
          ROOT_DEBUG_ATTR,
          JSON.stringify({ error: String(e) }),
        );
      }
    } else {
      document.documentElement.removeAttribute(ROOT_DEBUG_ATTR);
    }
    document.dispatchEvent(new CustomEvent(RESP, { detail: payload }));
  }

  const inflightRequests = new Set<string>();

  async function handleRequest(e: Event, d: Detail, type: typeof REQ | typeof SET): Promise<void> {
    if (!isActiveBridge()) return;
    if (typeof d.requestId !== "string") return;
    const requestKey = `${type}:${d.requestId}:${d.videoId ?? ""}:${d.qualityId ?? ""}`;
    if (inflightRequests.has(requestKey)) return;
    inflightRequests.add(requestKey);
    try {
      const v = videoFromEvent(e, d.videoId);
      const adapter = v ? adapterFor(v) : null;
      if (type === SET && adapter && typeof d.qualityId === "string") {
        const before = await adapter.options();
        if (!isActiveBridge()) return;
        try {
          await adapter.set(d.qualityId);
        } catch (error) {
          /* keep the viewer responsive even if a player rejects a level switch */
        }
        if (!isActiveBridge()) return;
        const current = d.qualityId;
        const selected = before.map((opt) => ({ ...opt, current: opt.id === current }));
        await respond(
          d.requestId,
          adapter,
          selected.length ? selected : undefined,
          current,
          d.videoId,
        );
        return;
      }
      await respond(d.requestId, adapter, undefined, undefined, d.videoId);
    } finally {
      inflightRequests.delete(requestKey);
    }
  }

  const onQualityRequest = (e: Event) => {
    void handleRequest(e, detailOf(e), REQ);
  };
  const onQualitySet = (e: Event) => {
    void handleRequest(e, detailOf(e), SET);
  };
  const requestObserver = new MutationObserver(() => {
    const d = detailOf(new Event(REQ));
    void handleRequest(
      new Event(REQ),
      d,
      document.documentElement.hasAttribute(ROOT_PICK_ATTR) ? SET : REQ,
    );
  });

  document.addEventListener(REQ, onQualityRequest);
  document.addEventListener(SET, onQualitySet);
  requestObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [ROOT_REQ_ATTR],
  });
  win.__vtpQualityBridgeCleanup = () => {
    document.removeEventListener(REQ, onQualityRequest);
    document.removeEventListener(SET, onQualitySet);
    requestObserver.disconnect();
    if (win.__vtpQualityBridgeInstalled === BRIDGE_VERSION) {
      win.__vtpQualityBridgeInstalled = undefined;
    }
  };
})();
