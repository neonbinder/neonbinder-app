import { useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ApplyToAllButton } from "../TidyTile";
import type { TidyRow } from "../tile-types";
import { cardsWaitingOn } from "./printed-on";

/** What Apply to all copies: this card's answer to a printed name. Never an undo. */
export type NameAnswer =
  | { kind: "linkPlayer"; playerId: Id<"players"> }
  | { kind: "linkTeam"; teamId: Id<"teams"> }
  | { kind: "notEntity" };

/**
 * NEO-656 — "answer, then Apply to all" for a printed name.
 *
 * An answer links the open card and nothing else. This offers the same answer
 * to the checklist's other cards still WAITING on that name (J3: cards already
 * linked to something else are never moved), and the server re-reads every card
 * when it is pressed (`tidyNames.applyNameToAll`, which also reaches the
 * parallels). The count is the cards this checklist holds, so the button is
 * offered only while one of them still waits. The open card must already carry
 * the answer, so this is shown after `answerName`, never before.
 */
export default function NameApplyToAll({
  cardId,
  kind,
  printed,
  answer,
  leafCards,
}: {
  cardId: Id<"cardChecklist">;
  kind: "player" | "team";
  printed: string;
  answer: NameAnswer;
  leafCards: readonly TidyRow[];
}) {
  const applyNameToAll = useAction(api.tidyNames.applyNameToAll);
  const waiting = cardsWaitingOn(leafCards, kind, printed).filter((c) => c._id !== cardId);
  return (
    <ApplyToAllButton
      count={waiting.length}
      label={`Apply to all cards printing “${printed}”`}
      onApply={async () => {
        const result = await applyNameToAll({ cardId, kind, name: printed, answer });
        return {
          applied: result.linked,
          skipped: result.skipped,
          verb: answer.kind === "notEntity" ? "Cleared" : "Linked",
        };
      }}
    />
  );
}
