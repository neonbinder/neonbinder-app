import type { FunctionReturnType } from "convex/server";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import type { deriveCardAttention } from "../../../convex/features/cardAttention";
import type { CardChecklistRow } from "../card-checklist-row";

/** A `getCardChecklist` row. */
export type TidyRow = CardChecklistRow;

/** `tidyCards.cardContext`: undefined while loading, null when the card is gone. */
export type TidyCardContext = FunctionReturnType<typeof api.tidyCards.cardContext>;

export type TidyAttention = ReturnType<typeof deriveCardAttention>;

export type TidyTileProps = {
  row: TidyRow;
  /** undefined = loading, null = card gone. */
  context: TidyCardContext | undefined;
  attention: TidyAttention;
  /** The checklist the walk is on. */
  leafId: Id<"selectorOptions">;
  sportId: Id<"selectorOptions"> | undefined;
  /** The whole leaf, for Apply-to-all candidates (the client proposes, the server checks). */
  leafCards: readonly TidyRow[];
  /** For copy, e.g. the title tile. */
  setName: string;
};
