interface PopupCtx { activeTabId: number | null; currentDomain: string; liveMisses: number; }

export const ctx: PopupCtx = { activeTabId: null, currentDomain: "", liveMisses: 0 };
