// The flat single-tone page background behind the frosted glass cards. Shared by
// the popup and the options page; purely decorative (aria-hidden, fixed,
// pointer-events:none in CSS). The tone + layering live in glass.css.
export function GlassBackdrop() {
  return <div className="glass-backdrop" aria-hidden="true" />;
}
