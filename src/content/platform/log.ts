export function alog(...args: unknown[]): void {
  try {
    console.info("[Video Tuner]", ...args);
  } catch (e) {}
}
