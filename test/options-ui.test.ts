// @vitest-environment jsdom
// Behavioural coverage for every options SECTION component (General, Keys, Speed
// presets, Compressor presets, Auto-slow, Sync, Saved) — driving the real controls
// in jsdom and asserting the chrome.storage the popup + content script read back.
// These were previously only smoke-tested; this exercises the handler branches
// (clamps, dedup rejection, add/remove limits, pin limits, reset, gain override).
import { describe, it, expect, beforeEach } from "vitest";
import {
  mountOptions,
  flush,
  settle,
  byId,
  sliderKey,
  typeInput,
  pressDoc,
} from "./mocks/mount-options.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

const sectionWith = (sel: string) =>
  [...document.querySelectorAll("section.card")].find((s) => s.querySelector(sel)) as HTMLElement;
const thumbsIn = (root: Element, sel: string) =>
  [...root.querySelectorAll(`${sel} [role="slider"]`)] as HTMLElement[];

// Two-step confirmation: a text button arms on the first click, confirms on the
// second; a split (icon) button arms then exposes a ✓ in the same place.
async function confirmText(btn: HTMLElement) {
  btn.click();
  await flush();
  btn.click();
  await flush();
}
async function confirmSplit(scope: Element, sel: string) {
  (scope.querySelector(sel) as HTMLElement).click(); // arm
  await flush();
  (scope.querySelector(`${sel}.is-armed`) as HTMLElement).click(); // ✓
  await flush();
}

describe("Options · General", () => {
  it("theme radios persist the chosen theme", async () => {
    const { get } = await mountOptions({});
    const radios = byId("themeSeg").querySelectorAll<HTMLElement>('[role="radio"]');
    radios[2].click(); // dark
    await flush();
    expect(get(["theme"]).theme).toBe("dark");
    radios[1].click(); // light
    await flush();
    expect(get(["theme"]).theme).toBe("light");
  });

  it("on-video button mode persists", async () => {
    const { get } = await mountOptions({});
    const radios = byId("overlayBtnSeg").querySelectorAll<HTMLElement>('[role="radio"]');
    radios[2].click(); // always
    await flush();
    expect(get(["overlayButton"]).overlayButton).toBe("always");
    radios[0].click(); // off
    await flush();
    expect(get(["overlayButton"]).overlayButton).toBe("off");
  });

  it("glass-opacity slider persists min/max", async () => {
    const { get } = await mountOptions({});
    const thumb = byId("glassOpacity").querySelector('[role="slider"]')!;
    sliderKey(thumb, "End");
    await flush();
    expect(get(["glassOpacity"]).glassOpacity).toBeCloseTo(1.4, 2);
    sliderKey(thumb, "Home");
    await flush();
    expect(get(["glassOpacity"]).glassOpacity).toBeCloseTo(0.3, 2);
  });

  it("language radios persist uiLang", async () => {
    const { get } = await mountOptions({});
    // options: [system, en, ru, …] → index 2 is ru.
    byId("langGrid").querySelectorAll<HTMLElement>('[role="radio"]')[2].click();
    await flush();
    expect(get(["uiLang"]).uiLang).toBe("ru");
  });

  it("force-speed toggle persists", async () => {
    const { get } = await mountOptions({});
    byId("forceRateToggle").click();
    await flush();
    expect(get(["forceRate"]).forceRate).toBe(true);
  });

  it("theme 'system' and overlay 'fullscreen' persist", async () => {
    const { get } = await mountOptions({ theme: "dark", overlayButton: "always" });
    byId("themeSeg").querySelectorAll<HTMLElement>('[role="radio"]')[0].click(); // system
    byId("overlayBtnSeg").querySelectorAll<HTMLElement>('[role="radio"]')[1].click(); // fullscreen
    await flush();
    expect(get(["theme"]).theme).toBe("system");
    expect(get(["overlayButton"]).overlayButton).toBe("fullscreen");
  });

  it("import of a valid JSON writes the settings; invalid is ignored", async () => {
    const { get } = await mountOptions({});
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const drop = (text: string) => {
      const file = new File([text], "s.json", { type: "application/json" });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    drop("not json {");
    await settle();
    expect(get(["globalSpeed"]).globalSpeed).toBeUndefined();
    drop(JSON.stringify({ globalSpeed: 1.9 }));
    await settle();
    expect(get(["globalSpeed"]).globalSpeed).toBeCloseTo(1.9, 2);
  });
});

describe("Options · Keys", () => {
  it("captures a new key and reflects it on the button", async () => {
    const { get } = await mountOptions({});
    byId("keySlower").click();
    await flush();
    pressDoc({ code: "KeyJ" });
    await flush();
    expect((get(["keymap"]).keymap as Record<string, string>).slower).toBe("KeyJ");
    expect(byId("keySlower").textContent).toBe("J");
  });

  it("rejects a duplicate and a non-bindable key", async () => {
    const { get } = await mountOptions({});
    byId("keyReset").click();
    pressDoc({ code: "KeyA" }); // KeyA already = slower
    await flush();
    pressDoc({ code: "Enter" }); // not a bindable code
    await flush();
    expect((get(["keymap"]).keymap as Record<string, string> | undefined)?.reset).not.toBe("KeyA");
  });

  it("Escape cancels capture without changing the binding", async () => {
    await mountOptions({});
    byId("keySlower").click();
    await flush();
    pressDoc({ code: "Escape" });
    await flush();
    expect(byId("keySlower").textContent).toBe("A"); // back to the default label
  });

  it("Backspace unbinds an action", async () => {
    const { get } = await mountOptions({});
    byId("keyToggle").click();
    await flush();
    pressDoc({ code: "Backspace" });
    await flush();
    expect((get(["keymap"]).keymap as Record<string, string>).toggle).toBe("");
  });

  it("the per-action switch turns it off then restores it", async () => {
    const { get } = await mountOptions({});
    const sw = document.querySelector<HTMLElement>("#keyRows .key-row [role=switch]")!;
    sw.click();
    await flush();
    expect((get(["keymap"]).keymap as Record<string, string>).slower).toBe("");
    sw.click();
    await flush();
    expect((get(["keymap"]).keymap as Record<string, string>).slower).toBe("KeyA");
  });

  it("reset-to-defaults restores the keymap", async () => {
    const { get } = await mountOptions({ keymap: { faster: "KeyK", slower: "KeyA" } });
    await confirmText(
      document.querySelector("#keyRows ~ .card-actions .confirm-btn") as HTMLElement,
    );
    const km = get(["keymap"]).keymap as Record<string, string>;
    expect(km.faster).toBe("KeyD");
    expect(km.reset).toBe("KeyR");
  });
});

describe("Options · Speed presets", () => {
  const sp = () => sectionWith(".preset-rows");

  it("max / step / hold sliders persist and clamp hold to max", async () => {
    const { get } = await mountOptions({});
    const params = thumbsIn(sp(), ".opt-params-grid .opt-param");
    sliderKey(params[0], "End"); // max → 1600
    sliderKey(params[1], "End"); // step → 50
    sliderKey(params[2], "Home"); // hold → 25 (PRESET_MIN)
    await flush();
    expect(get(["speedMax"]).speedMax).toBe(1600);
    expect(get(["speedStep"]).speedStep).toBe(50);
    expect(get(["holdSpeed"]).holdSpeed).toBe(25);
  });

  it("editing a preset value re-sorts and persists", async () => {
    const { get } = await mountOptions({});
    const first = sp().querySelector<HTMLInputElement>('.preset-rows input[type="number"]')!;
    typeInput(first, "30");
    await flush();
    expect((get(["speedPresets"]).speedPresets as number[])[0]).toBe(30);
  });

  it("adding then removing a preset grows then shrinks the list", async () => {
    const { get } = await mountOptions({});
    expect(sp().querySelectorAll(".preset-row")).toHaveLength(12);
    [...sp().querySelectorAll("button")].find((b) => b.textContent === "Add preset")!.click();
    await flush();
    expect((get(["speedPresets"]).speedPresets as number[]).length).toBe(13);
    await confirmSplit(sp().querySelector(".preset-row")!, ".preset-remove");
    expect((get(["speedPresets"]).speedPresets as number[]).length).toBe(12);
  });

  it("pinning a preset records it in presetPins", async () => {
    const { get } = await mountOptions({});
    sp().querySelector<HTMLElement>(".preset-row .preset-pin")!.click(); // 25% — not a default pin
    await flush();
    expect((get(["presetPins"]).presetPins as boolean[])[0]).toBe(true);
  });

  it("assigning a hotkey persists it, but rejects one that shadows an action key", async () => {
    const { get } = await mountOptions({});
    const keyBtn = () => sp().querySelector<HTMLElement>(".preset-row .preset-key")!;
    keyBtn().click(); // enter capture (stays capturing through a rejection)
    await flush();
    pressDoc({ code: "KeyA" }); // shadows the "slower" action → rejected, still capturing
    await flush();
    expect(keyBtn().textContent).not.toBe("A");
    pressDoc({ code: "KeyG" }); // free → accepted, capture ends
    await flush();
    expect((get(["presetKeys"]).presetKeys as (string | null)[])[0]).toBe("KeyG");
    expect(keyBtn().textContent).toBe("G");
  });

  it("reset restores the default preset set", async () => {
    const { get } = await mountOptions({
      speedPresets: [42],
      presetKeys: [null],
      presetPins: [true],
    });
    await confirmText(sp().querySelector(".card-actions .btn-danger") as HTMLElement);
    expect(get(["speedPresets"]).speedPresets).toEqual([
      25, 50, 75, 90, 100, 110, 125, 150, 175, 200, 250, 1600,
    ]);
  });
});

describe("Options · Compressor presets", () => {
  const cp = () => sectionWith("#presetEditors");

  it("global gain persists to base + live value", async () => {
    const { get } = await mountOptions({});
    sliderKey(cp().querySelector('.opt-param [role="slider"]')!, "End");
    await flush();
    expect(get(["audioCompBaseGain"]).audioCompBaseGain).toBe(24);
    expect(get(["audioCompGain"]).audioCompGain).toBe(24);
  });

  it("editing a parameter persists into compPresets", async () => {
    const { get } = await mountOptions({});
    sliderKey(thumbsIn(cp(), ".comp-detail .opt-param")[0], "Home"); // threshold → -100
    await flush();
    expect((get(["compPresets"]).compPresets as Array<{ threshold: number }>)[0].threshold).toBe(
      -100,
    );
  });

  it("renaming persists the custom name", async () => {
    const { get } = await mountOptions({});
    typeInput(cp().querySelector<HTMLInputElement>(".preset-name-input")!, "My Voice", false);
    await flush();
    expect((get(["compPresets"]).compPresets as Array<{ name?: string }>)[0].name).toBe("My Voice");
  });

  it("the make-up-gain override switch adds then removes a per-preset gain", async () => {
    const { get } = await mountOptions({});
    const sw = cp().querySelector<HTMLElement>(".comp-detail [role=switch]")!;
    sw.click();
    await flush();
    expect((get(["compPresets"]).compPresets as Array<{ gain?: number }>)[0].gain).not.toBe(
      undefined,
    );
    sw.click();
    await flush();
    expect((get(["compPresets"]).compPresets as Array<{ gain?: number }>)[0].gain).toBe(undefined);
  });

  it("adding then removing a compressor preset grows then shrinks the list", async () => {
    const { get } = await mountOptions({});
    const start = cp().querySelectorAll(".comp-list-row").length;
    cp().querySelector<HTMLElement>(".comp-list-add")!.click();
    await flush();
    expect((get(["compPresets"]).compPresets as unknown[]).length).toBe(start + 1);
    await confirmSplit(cp().querySelector(".comp-list-row")!, ".preset-remove");
    expect((get(["compPresets"]).compPresets as unknown[]).length).toBe(start);
  });

  it("selecting another preset edits that one", async () => {
    const { get } = await mountOptions({});
    cp().querySelectorAll<HTMLElement>(".comp-list-name")[1].click(); // select the 2nd preset
    await flush();
    sliderKey(thumbsIn(cp(), ".comp-detail .opt-param")[0], "Home"); // its threshold → -100
    await flush();
    expect((get(["compPresets"]).compPresets as Array<{ threshold: number }>)[1].threshold).toBe(
      -100,
    );
  });

  it("the per-preset gain slider sets a custom gain", async () => {
    const { get } = await mountOptions({});
    cp().querySelector<HTMLElement>(".comp-detail [role=switch]")!.click(); // enable override
    await flush();
    const thumbs = thumbsIn(cp(), ".comp-detail .opt-param");
    sliderKey(thumbs[thumbs.length - 1], "End"); // the gain slider (last) → 24
    await flush();
    expect((get(["compPresets"]).compPresets as Array<{ gain?: number }>)[0].gain).toBe(24);
  });

  it("toggling a preset's pin persists the change", async () => {
    const { get } = await mountOptions({});
    const pin = cp().querySelector<HTMLElement>(".comp-list-row .preset-pin")!;
    const was = pin.getAttribute("aria-pressed") === "true";
    pin.click();
    await flush();
    expect((get(["compPresets"]).compPresets as Array<{ pin: boolean }>)[0].pin).toBe(!was);
  });

  it("reset removes the override so the defaults apply", async () => {
    const { get } = await mountOptions({
      compPresets: [{ threshold: -10, knee: 0, ratio: 2, attack: 0, release: 0.5, pin: true }],
    });
    await confirmText(cp().querySelector(".comp-actions .btn-danger") as HTMLElement);
    expect(get(["compPresets"]).compPresets).toBeUndefined();
    expect(cp().querySelectorAll(".comp-list-row")).toHaveLength(3);
  });
});

describe("Options · Auto-slow", () => {
  it("the five knobs persist their extremes", async () => {
    const { get } = await mountOptions({});
    sliderKey(byId("autoSlowFloor").querySelector('[role="slider"]')!, "Home"); // 50% → 0.5
    sliderKey(byId("autoSlowKnee").querySelector('[role="slider"]')!, "End"); // ±2 /s
    sliderKey(byId("autoSlowHold").querySelector('[role="slider"]')!, "End"); // 4 s
    sliderKey(byId("autoSlowReaction").querySelector('[role="slider"]')!, "End"); // 100%
    sliderKey(byId("autoSlowEaseBack").querySelector('[role="slider"]')!, "End"); // 100%
    await flush();
    expect(get(["autoSlowFloor"]).autoSlowFloor).toBeCloseTo(0.5, 2);
    expect(get(["autoSlowKnee"]).autoSlowKnee).toBeCloseTo(2, 2);
    expect(get(["autoSlowHold"]).autoSlowHold).toBe(4);
    expect(get(["autoSlowReaction"]).autoSlowReaction).toBe(100);
    expect(get(["autoSlowEaseBack"]).autoSlowEaseBack).toBe(100);
  });
});

describe("Options · Sync", () => {
  it("the master switch disables the per-category rows", async () => {
    await mountOptions({});
    const firstCat = document.querySelector<HTMLElement>("#syncRows .sync-cat-row [role=switch]")!;
    expect(firstCat.hasAttribute("disabled")).toBe(false);
    byId("syncMaster").querySelector<HTMLElement>("[role=switch]")!.click();
    await flush();
    expect(byId("syncRows").className).toMatch(/is-off/);
    expect(firstCat.hasAttribute("disabled")).toBe(true);
  });
});

describe("Options · Saved", () => {
  it("renders, deletes one, and resets a whole category", async () => {
    const { get } = await mountOptions({
      globalSpeed: 1.5,
      domains: { "a.com": 2, "b.com": 1.25 },
      channels: { "twitch:foo": 1.75 },
    });
    await settle();
    const rows = document.querySelectorAll("#savedLists .saved-row");
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const aRow = [...rows].find((r) => r.textContent?.includes("a.com"))!;
    aRow.querySelector<HTMLElement>(".saved-del")!.click();
    await flush();
    expect((get(["domains"]).domains as Record<string, number>)["a.com"]).toBeUndefined();
    expect((get(["domains"]).domains as Record<string, number>)["b.com"]).toBe(1.25);

    // Reset the whole speeds category (first category's reset button).
    const speedsCat = document.querySelector(".saved-cat")!;
    await confirmText(speedsCat.querySelector(".card-actions .confirm-btn") as HTMLElement);
    expect(get(["globalSpeed"]).globalSpeed).toBeUndefined();
    expect(get(["domains"]).domains).toBeUndefined();
    expect(get(["channels"]).channels).toBeUndefined();
  });

  it("renders live-sync delays, deletes one, and resets the category", async () => {
    const { get } = await mountOptions({
      syncTargetGlobal: 5,
      syncTargets: { "a.com": 8 },
      syncTargetChannels: { "twitch:foo": 6 },
    });
    await settle();
    const delaysCat = document.querySelectorAll(".saved-cat")[1]; // [speeds, delays]
    expect(delaysCat.textContent).toContain("a.com");
    expect(delaysCat.textContent).toContain("foo (Twitch)"); // prettyChannel
    const aRow = [...delaysCat.querySelectorAll(".saved-row")].find((r) =>
      r.textContent?.includes("a.com"),
    )!;
    aRow.querySelector<HTMLElement>(".saved-del")!.click();
    await flush();
    expect((get(["syncTargets"]).syncTargets as Record<string, number>)["a.com"]).toBeUndefined();
    await confirmText(delaysCat.querySelector(".card-actions .confirm-btn") as HTMLElement);
    expect(get(["syncTargetGlobal"]).syncTargetGlobal).toBeUndefined();
    expect(get(["syncTargetChannels"]).syncTargetChannels).toBeUndefined();
  });
});
