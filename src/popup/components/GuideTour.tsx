// First-open walkthrough. For each of the four cards it runs three steps:
//   1. overview  — spotlight the card, say what it does
//   2. expand    — spotlight the header, point out it opens the full settings
//   3. settings  — actually open the card (via onExpand → forceOpen) and describe
//                  the controls that were hidden
// Saving is intentionally OFF for now (shows on every open) while we iterate.
import { useLayoutEffect, useState, type CSSProperties } from "react";
import { msg } from "../i18n.js";

interface Card {
  titleKey: string;
  title: string;
  overviewKey: string;
  overview: string;
  hiddenKey: string;
  hidden: string;
}

// Index = card-slot order: Speed, Live-sync, Auto-slow, Audio.
const CARDS: Card[] = [
  {
    titleKey: "guideSpeedTitle",
    title: "Playback speed",
    overviewKey: "guideSpeedDesc",
    overview: "Drag the slider or tap a preset to change the playback speed.",
    hiddenKey: "guideSpeedHidden",
    hidden:
      "Inside: save per Site or Channel, the on-video badge, keyboard shortcuts, theater mode, and speeding up plain audio.",
  },
  {
    titleKey: "syncTitle",
    title: "Keep stream live",
    overviewKey: "guideSyncDesc",
    overview: "On live streams it nudges the speed to keep you near the live moment.",
    hiddenKey: "guideSyncHidden",
    hidden:
      "Inside: the allowed delay saved per Site or Channel, the on-video badge, and theater mode.",
  },
  {
    titleKey: "autoSlowLabel",
    title: "Auto-slow dense speech",
    overviewKey: "guideAutoDesc",
    overview: "Eases off the speed when someone talks too fast to follow.",
    hiddenKey: "guideAutoHidden",
    hidden: "Inside: save the target speech rate per Site or Channel.",
  },
  {
    titleKey: "audioTitle",
    title: "Audio compression",
    overviewKey: "guideAudioDesc",
    overview: "Evens out the loud and quiet parts so you're not chasing the volume.",
    hiddenKey: "guideAudioHidden",
    hidden: "Inside: fine-tune the threshold, the ratio, and the make-up gain.",
  },
];

type Phase = "overview" | "expand" | "settings";
// Only the first card gets the full three-step demo (overview → open → settings)
// to teach that cards expand into more settings; the rest are a single description
// each — clicking through three steps for every card got tedious.
const STEPS: { card: number; phase: Phase }[] = CARDS.flatMap((_, card) => {
  const phases: Phase[] = card === 0 ? ["overview", "expand", "settings"] : ["overview"];
  return phases.map((phase) => ({ card, phase }));
});

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CAP_W = 268;
const PAD = 12;
const SPOT_PAD = 6; // breathing room between the spotlight ring and the element

export function GuideTour({
  onClose,
  onExpand,
}: {
  onClose: () => void;
  onExpand: (card: number | null) => void;
}) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const { card, phase } = STEPS[step];
  const c = CARDS[card];

  useLayoutEffect(() => {
    // Drive the real card expansion for the settings step.
    onExpand(phase === "settings" ? card : null);
    if (phase === "settings") return setRect(null); // card fills the popup — no spotlight
    const slots = document.querySelectorAll<HTMLElement>(".popup-grid .card-slot");
    const slot = slots[card];
    if (!slot) return setRect(null);
    const el = phase === "expand" ? (slot.querySelector<HTMLElement>(".sec-head") ?? slot) : slot;
    const r = el.getBoundingClientRect();
    setRect({
      top: r.top - SPOT_PAD,
      left: r.left - SPOT_PAD,
      width: r.width + SPOT_PAD * 2,
      height: r.height + SPOT_PAD * 2,
    });
  }, [card, phase, onExpand]);

  const last = step === STEPS.length - 1;
  const next = () => (last ? onClose() : setStep((p) => p + 1));
  const back = () => setStep((p) => Math.max(0, p - 1));

  const title = msg(c.titleKey) || c.title;
  const desc =
    phase === "overview"
      ? msg(c.overviewKey) || c.overview
      : phase === "expand"
        ? msg("guideExpand") || "Click the card's header to open its full settings."
        : msg(c.hiddenKey) || c.hidden;

  // Caption: pinned at the bottom while a card is open (it fills the popup); else
  // below the card on the top row, above it on the bottom row.
  let cap: CSSProperties = { visibility: "hidden" };
  if (phase === "settings") {
    cap = { left: Math.max(8, (window.innerWidth - CAP_W) / 2), bottom: 16 };
  } else if (rect) {
    const cx = rect.left + rect.width / 2;
    const left = Math.max(8, Math.min(cx - CAP_W / 2, window.innerWidth - CAP_W - 8));
    cap =
      card < 2
        ? { top: rect.top + rect.height + PAD, left }
        : { bottom: window.innerHeight - rect.top + PAD, left };
  }

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-label="Quick tour">
      {rect && (
        <div
          className="tour-spot"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      )}
      {/* The "expand" step is learn-by-doing: the user clicks the spotlighted header
          to open the card (which advances to the settings step). Skip still bails. */}
      {phase === "expand" && rect && (
        <button
          type="button"
          className="tour-hotspot"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          onClick={next}
          aria-label={msg("guideExpand") || "Open the card"}
        />
      )}
      <div className={"tour-cap" + (phase === "settings" ? " is-bottom" : "")} style={cap}>
        <div className="tour-cap-title">{title}</div>
        <p className="tour-cap-desc">{desc}</p>
        <div className="tour-cap-foot">
          <div className="tour-dots" aria-hidden="true">
            {CARDS.map((_, i) => (
              <span key={i} className={"tour-dot" + (i === card ? " is-on" : "")} />
            ))}
          </div>
          <div className="tour-btns">
            <button type="button" className="tour-skip" onClick={onClose}>
              {msg("guideSkip") || "Skip"}
            </button>
            {step > 0 && (
              <button type="button" className="tour-back" onClick={back}>
                {msg("guideBack") || "Back"}
              </button>
            )}
            <button
              type="button"
              className="tour-next"
              onClick={next}
              disabled={phase === "expand"}
            >
              {last ? msg("guideDone") || "Done" : msg("guideNext") || "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
