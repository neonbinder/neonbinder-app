/**
 * NEO-645 — a button label with its key in brackets: "Save & next (Enter)".
 *
 * On a touch screen the bracket is noise (there is no Esc to press), so it
 * stops being drawn on a coarse pointer but stays in the accessible name: a
 * switch or keyboard user on a phone still hears it, and a spec finds the
 * button by the same name on every project. `sr-only`, not `hidden`, for that
 * reason. The label is one string everywhere else (tests and specs read it
 * whole), so this splits it where it ends in a bracketed key.
 */
const HINT = /^(.*?)(\s\((?:Esc|Enter)\))$/;

export default function HintedLabel({ label }: { label: string }) {
  const match = HINT.exec(label);
  if (!match) return <>{label}</>;
  return (
    <>
      {match[1]}
      <span className="[@media(pointer:coarse)]:sr-only">{match[2]}</span>
    </>
  );
}
