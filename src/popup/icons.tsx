// The popup's inline SVGs as small components — extracted so the markup reads
// cleanly and each glyph is defined once. Geometry is copied verbatim from the
// original popup.html.

export const GearIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="currentColor"
      d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
    />
  </svg>
);

export const KofiIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      className="cup"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
      d="M4 6.5h10.5V11a5.25 5.25 0 0 1-5.25 5.25A5.25 5.25 0 0 1 4 11z"
    />
    <path
      className="cup"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      d="M14.5 8h1.5a2.5 2.5 0 0 1 0 5h-1.5"
    />
    <path
      className="heart"
      fill="currentColor"
      d="M9.25 13.5S6.3 11.8 6.3 9.9c0-.9.7-1.4 1.4-1.4.7 0 1.25.5 1.55 1 .3-.5.85-1 1.55-1 .7 0 1.4.5 1.4 1.4 0 1.9-2.95 3.6-2.95 3.6z"
    />
  </svg>
);

export const WarnIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
  </svg>
);

export const InfoIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="currentColor"
      d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm-1-3h2v-6h-2v6Zm0-8h2V7h-2v2Z"
    />
  </svg>
);

export const MinusIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M5 11h14v2H5z" />
  </svg>
);

export const PlusIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
  </svg>
);

export const ResetIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" />
  </svg>
);

export const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path
      d="M6 9l6 6 6-6"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
