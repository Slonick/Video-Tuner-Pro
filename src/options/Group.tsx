// macOS System Settings-style group: a header (title + optional description /
// control) sits ABOVE a rounded content box, rather than inside it. `head` is the
// section's own header markup (so each keeps its pills/switches); `children` is the
// box body. A headerless group (e.g. a one-row card) just omits `head`.
export function Group({ head, children }: { head?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="opt-group">
      {head ? <div className="opt-group-head">{head}</div> : null}
      <div className="card">{children}</div>
    </section>
  );
}
