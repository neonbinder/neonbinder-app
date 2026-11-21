/**
 * NEO-591 — one table of "do these two sources name the card the same?",
 * read by BOTH callers of `playersAgree`: the server's players disagreement
 * (`compareChecklistRow`) and Match Cards' name picker. A case added here is
 * held to both, so the dialog can never warn about a name the wizard would not
 * ask about, or the other way round. Not a test file: the lib and component
 * test projects each import it.
 */
export type NameAgreementCase = {
  label: string;
  /** The marketplace card's players. */
  card: string[];
  /** The checklist row's players. */
  row: string[];
  /** Do the two name the card the same way? */
  agree: boolean;
};

export const NAME_AGREEMENT_CASES: readonly NameAgreementCase[] = [
  { label: "the same name", card: ["Pete Rose"], row: ["Pete Rose"], agree: true },
  { label: "a case difference", card: ["Pete Rose"], row: ["pete rose"], agree: true },
  { label: "accents and punctuation", card: ["José Ramírez"], row: ["Jose Ramirez"], agree: true },
  {
    label: "a trailing SP the checklist drops",
    card: ["Old Teammates SP"],
    row: ["Old Teammates"],
    agree: true,
  },
  { label: "a trailing RC marker", card: ["Pete Rose RC"], row: ["Pete Rose"], agree: true },
  { label: "a surname only", card: ["Pete Rose"], row: ["Rose"], agree: true },
  { label: "a surname past a Jr", card: ["Ken Griffey Jr"], row: ["Griffey"], agree: true },
  {
    label: "two players in a different order",
    card: ["Pete Rose", "Johnny Bench"],
    row: ["Johnny Bench", "Pete Rose"],
    agree: true,
  },
  { label: "a different first name", card: ["Dax Kilby"], row: ["Max Kilby"], agree: false },
  { label: "a different person", card: ["Dax Kilby"], row: ["Pete Rose"], agree: false },
  { label: "a near spelling", card: ["Rhett Lowder"], row: ["Rhett Lowdr"], agree: false },
  {
    label: "one player against two",
    card: ["Pete Rose"],
    row: ["Pete Rose", "Johnny Bench"],
    agree: false,
  },
  { label: "a surname that is not the card's", card: ["Pete Rose"], row: ["Bench"], agree: false },
];
