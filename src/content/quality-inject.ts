// MAIN-world quality bridge. It is intentionally request-driven: the isolated
// viewer marks the source <video> with a temporary id and asks for capabilities;
// this script searches near that element for known player engines and answers.
// No timers, no background DOM crawling.
(function () {
  "use strict";

  const REQ = "vtp-quality-request";
  const RESP = "vtp-quality-response";
  const SET = "vtp-quality-set";
  const VIDEO_ATTR = "data-vtp-quality-id";
  const ROOT_REQ_ATTR = "data-vtp-quality-request";
  const ROOT_VIDEO_ATTR = "data-vtp-quality-video";
  const ROOT_PICK_ATTR = "data-vtp-quality-pick";
  const ROOT_RESP_ATTR = "data-vtp-quality-response";

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
    options: () => QualityOption[];
    current: () => string;
    set: (id: string) => void;
  }

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
      const roots: ParentNode[] = [document];
      let budget = 2500;
      for (let i = 0; i < roots.length && budget-- > 0; i++) {
        const root = roots[i];
        const found = root.querySelector<HTMLVideoElement>(selector);
        if (found) return found;
        for (const el of Array.from(root.querySelectorAll<Element>("*")).slice(0, 500)) {
          if (el.shadowRoot) roots.push(el.shadowRoot);
        }
      }
    } catch (e) {
      return null;
    }
    return null;
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

  function youtubeAdapter(v: HTMLVideoElement): Adapter | null {
    const root =
      (v.closest && v.closest(".html5-video-player")) ||
      document.querySelector(".html5-video-player");
    const p = root as
      | (HTMLElement & {
          getAvailableQualityLevels?: () => string[];
          getPlaybackQuality?: () => string;
          setPlaybackQuality?: (q: string) => void;
          setPlaybackQualityRange?: (q: string) => void;
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
          return p.getPlaybackQuality?.() || "auto";
        } catch (e) {
          return "auto";
        }
      },
      set(id: string) {
        if (id === "auto") {
          p.setPlaybackQualityRange?.("auto");
          p.setPlaybackQuality?.("auto");
          return;
        }
        p.setPlaybackQualityRange?.(id);
        p.setPlaybackQuality?.(id);
      },
    };
  }

  function isObj(x: unknown): x is Record<string, unknown> {
    return !!x && typeof x === "object";
  }

  function read(o: Record<string, unknown>, key: string): unknown {
    try {
      return o[key];
    } catch (e) {
      return null;
    }
  }

  function rootsFor(v: HTMLVideoElement): unknown[] {
    const out: unknown[] = [v];
    let el: Element | null = v;
    for (let i = 0; i < 10 && el; i++) {
      out.push(el);
      const rec = el as unknown as Record<string, unknown>;
      for (const k in rec) {
        if (
          k.startsWith("__reactFiber$") ||
          k.startsWith("__reactInternalInstance$") ||
          k.startsWith("__vue") ||
          k.startsWith("__svelte")
        ) {
          out.push(rec[k]);
        }
      }
      el = el.parentElement;
    }
    return out;
  }

  function findValue<T>(
    roots: unknown[],
    accept: (value: Record<string, unknown>) => T | null,
  ): T | null {
    const seen = new WeakSet<object>();
    const queue = roots.filter(isObj).map((value) => ({ value, depth: 0 }));
    let budget = 1800;
    while (queue.length && budget-- > 0) {
      const { value, depth } = queue.shift()!;
      if (seen.has(value)) continue;
      seen.add(value);
      const accepted = accept(value);
      if (accepted) return accepted;
      if (depth >= 4) continue;
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
        "stateNode",
        "memoizedProps",
        "memoizedState",
        "props",
        "state",
      ];
      for (const key of preferred) {
        const child = read(value, key);
        if (isObj(child)) queue.push({ value: child, depth: depth + 1 });
      }
      let keys: string[];
      try {
        keys = Object.keys(value).slice(0, 40);
      } catch (e) {
        continue;
      }
      for (const key of keys) {
        const child = read(value, key);
        if (isObj(child)) queue.push({ value: child, depth: depth + 1 });
      }
    }
    return null;
  }

  interface HlsLike {
    levels?: Array<{ height?: number; bitrate?: number; name?: string }>;
    currentLevel?: number;
    nextLevel?: number;
    loadLevel?: number;
    media?: unknown;
  }
  function hlsAdapter(v: HTMLVideoElement): Adapter | null {
    const hls = findValue(rootsFor(v), (o): HlsLike | null => {
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

  function adapterFor(v: HTMLVideoElement): Adapter | null {
    return (
      youtubeAdapter(v) ||
      hlsAdapter(v) ||
      dashAdapter(v) ||
      shakaAdapter(v) ||
      videoJsAdapter(v)
    );
  }

  function respond(requestId: string, adapter: Adapter | null): void {
    const payload: QualityResponse = {
      requestId,
      options: adapter ? adapter.options() : [],
      current: adapter ? adapter.current() : "auto",
    };
    document.documentElement.setAttribute(ROOT_RESP_ATTR, JSON.stringify(payload));
    document.dispatchEvent(new CustomEvent(RESP, { detail: payload }));
  }

  document.addEventListener(REQ, (e) => {
    const d = detailOf(e);
    if (typeof d.requestId !== "string") return;
    const v = videoById(d.videoId);
    respond(d.requestId, v ? adapterFor(v) : null);
  });

  document.addEventListener(SET, (e) => {
    const d = detailOf(e);
    if (typeof d.requestId !== "string") return;
    const v = videoById(d.videoId);
    const adapter = v ? adapterFor(v) : null;
    if (adapter && typeof d.qualityId === "string") adapter.set(d.qualityId);
    respond(d.requestId, adapter);
  });
})();
