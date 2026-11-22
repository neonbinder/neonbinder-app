import { createContext, useContext } from "react";

/**
 * NEO-645 (S1) — what a tile tells the walk when the operator has ANSWERED it.
 *
 * An answer (a link, a new player, "Not a player", a team picked or saved, a
 * pick between sources, a set name applied, an autograph format) leaves focus
 * on a control that is about to mean something else: the answered row's Change,
 * the button that reopens a search. One more Enter there would undo the answer.
 * So every answer ends the same way, and the walk owns where focus goes: Save &
 * next when nothing pink is left on the card (Enter then saves and advances),
 * otherwise the first control of the first pink tile.
 *
 * Focus goes back to the control that opened an inline part only on Cancel or
 * Esc, never after an answer.
 *
 * Outside a walk (a tile rendered alone) this is a no-op.
 */
const AnsweredContext = createContext<() => void>(() => {});

export const AnsweredProvider = AnsweredContext.Provider;

/** Call once an answer has been saved. */
export function useAnswered(): () => void {
  return useContext(AnsweredContext);
}
