import { contentSignal, listenerOptions } from "./lifecycle.js";

type PointerSample = { x: number; y: number };
type PointerSubscriber = (sample: PointerSample) => void;

const subscribers = new Set<PointerSubscriber>();
let hooked = false;
let frame = 0;
let last: PointerSample = { x: 0, y: 0 };

contentSignal.addEventListener("abort", () => {
  if (!frame) return;
  cancelAnimationFrame(frame);
  frame = 0;
});

function hook(): void {
  if (hooked) return;
  hooked = true;
  document.addEventListener(
    "mousemove",
    (e) => {
      last = { x: e.clientX, y: e.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        for (const subscriber of subscribers) subscriber(last);
      });
    },
    listenerOptions({ passive: true }),
  );
}

export function subscribePointerMove(subscriber: PointerSubscriber): void {
  subscribers.add(subscriber);
  hook();
}
