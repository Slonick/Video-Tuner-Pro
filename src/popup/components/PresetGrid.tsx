// The eight speed-preset buttons. Collapsed, the four "extra" buttons (positions
// 0/3/4/7 in the sorted grid) are hidden by CSS; expanding reveals them and the
// grid FLIP-animates (the gridRef is measured by useExpand). data-key drives the
// Shift+N hotkey hints.
import type { RefObject } from "react";

const EXTRA = new Set([0, 3, 4, 7]);

interface Props {
  presets: number[];
  activePercent: number;
  gridRef: RefObject<HTMLDivElement>;
  onPick: (fraction: number) => void;
}

export function PresetGrid({ presets, activePercent, gridRef, onPick }: Props) {
  return (
    <div ref={gridRef} className="buttons-grid presetgrid">
      {presets.map((pct, i) => (
        <button
          key={i}
          className={
            "btn-speed" + (EXTRA.has(i) ? " extra" : "") + (activePercent === pct ? " active" : "")
          }
          data-percent={pct}
          data-key={i + 1}
          onClick={() => onPick(pct / 100)}
        >
          {pct + "%"}
        </button>
      ))}
    </div>
  );
}
