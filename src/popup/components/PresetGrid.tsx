// The speed-preset buttons. Collapsed, only the pinned quick row (≤4, filled to
// 4 with the lowest unpinned — see quickPresetIndices) shows as one row; the rest
// are "extra", hidden by CSS until the card expands. data-key carries each
// preset's assigned hotkey label (e.g. "⇧1"), driving the corner hint.
import { chordLabel } from "../../shared/keymap.js";
import { quickPresetIndices } from "../../shared/presets.js";
import { Button } from "../../ui/Button.js";

interface Props {
  presets: number[];
  presetKeys: (string | null)[];
  pinned: boolean[];
  activePercent: number;
  onPick: (fraction: number) => void;
}

export function PresetGrid({ presets, presetKeys, pinned, activePercent, onPick }: Props) {
  const quick = new Set(quickPresetIndices(pinned));
  return (
    <div className="buttons-grid presetgrid">
      {presets.map((pct, i) => {
        const key = chordLabel(presetKeys[i]);
        return (
          <Button
            key={i}
            className={
              "btn-speed" +
              (quick.has(i) ? "" : " extra") +
              (activePercent === pct ? " active" : "")
            }
            data-percent={pct}
            data-key={key || undefined}
            onClick={() => onPick(pct / 100)}
          >
            {pct + "%"}
          </Button>
        );
      })}
    </div>
  );
}
