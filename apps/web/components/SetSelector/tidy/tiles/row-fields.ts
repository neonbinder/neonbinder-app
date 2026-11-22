import type { TidyDisagreement } from "../../../../convex/features/cardAttention";
import type { TidyRow } from "../tile-types";

/**
 * NEO-645 — the `getCardChecklist` fields the card tiles read that the shared
 * `CardChecklistRow` type does not carry yet. Declared structurally (twin of
 * the schema validators) so a tile reads them without a cast at each call
 * site; the intersection stays valid when the shared row type learns the same
 * fields. Optional everywhere: an older row has none of them.
 */
export type RowDisagreement = TidyDisagreement;

export type TidyRowFields = TidyRow & {
  sourceDisagreements?: readonly RowDisagreement[];
  sourceNumbers?: { bsc?: string; sportlots?: string; checklist?: string };
  features?: Record<string, string>;
  imageUrls?: { front?: string; back?: string };
};

export function rowFields(row: TidyRow): TidyRowFields {
  return row as TidyRowFields;
}
