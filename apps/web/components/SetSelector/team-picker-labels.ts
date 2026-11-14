/**
 * NEO-556 — the "No Team" toggle's words, in a module of their own (no React,
 * no Convex) so every caller can import them past the `vi.mock("./TeamPicker")`
 * stubs nine component tests carry, the way `player-picker-labels.ts` serves
 * PlayerPicker's callers.
 */

/**
 * NEO-556 — the "No Team" toggle's visible words, the same on every picker
 * that offers it: it is the product's name for the answer ("this card carries
 * no team"), and the collapsed set summary, the checklist row and the card
 * drawer all print it the same way.
 */
export const NO_TEAM_TEXT = "No Team";

/**
 * NEO-556 — the toggle's accessible names. Visible words first ("No Team"),
 * then what it answers for, so voice control still lands on what is shown
 * (SC 2.5.3) while two pickers on one screen never share a name. Pairwise, no
 * name contains another (Playwright's `name` is a case-insensitive substring
 * match), and none contains the walker's and wizard's own "No team on this
 * card" — pinned in `TeamPicker.test.tsx`.
 *
 *  - `card`: the card drawer and the unlinked-name fixer (never both open).
 *  - `newCard`: the checklist's quick-add form, which can sit under the drawer.
 *  - `everyCard`: the Attributes panel's Team row, the set-level default
 *    (named for NEW cards: the cards already here move only when marked).
 */
export const NO_TEAM_LABELS = {
  card: "No Team for this card",
  newCard: "No Team for the new card",
  everyCard: "No Team for new cards here",
} as const;
