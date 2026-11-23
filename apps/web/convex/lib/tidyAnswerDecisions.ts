/**
 * NEO-645 — a `tidyNames` row, read the way the commit prelude reads a review
 * decision.
 *
 * The prelude's whole decision machinery (link beats the exactly-one fast
 * path, a skip suppresses the name, an auto-link carries its origin, a team
 * link may remember the printed spelling as an alias) was written against
 * `entityReviewQueue` rows with a `decision`. The answers now live in
 * `tidyNames`, and rather than fork two thousand lines of auto-link rules the
 * prelude reads each `tidyNames` row through this adapter and keeps every rule
 * it had (NEO-424 set history, NEO-463, NEO-307, NEO-284, NEO-313, NEO-602).
 *
 *   linkPlayer  -> { action: "link", linkedPlayerId, autoLinked?, addSetSport? }
 *   linkTeam    -> { action: "link", linkedTeamId, autoLinked?, saveAsAlias? }
 *   notEntity   -> { action: "skip" }
 *   no answer   -> no decision (the name is pending)
 *
 * A `create` decision no longer exists: "Add as new player" creates the player
 * when the operator presses it (`tidyNames.createPlayer`) and stores a link.
 *
 * Pure, ids and strings only.
 */

import type { Doc, Id } from "../_generated/dataModel";

type TidyRow = Pick<
  Doc<"tidyNames">,
  "kind" | "name" | "nameNormalized" | "sportId" | "answer" | "enrichment" | "status"
>;

export type PreludeDecision =
  | {
      action: "link";
      linkedPlayerId?: Id<"players">;
      linkedTeamId?: Id<"teams">;
      autoLinked?: "setHistory" | "hallOfFame" | "careerTeam";
      addSetSport?: true;
      saveAsAlias?: true;
    }
  | { action: "skip" };

/** The prelude's view of one name row. */
export type PreludeNameRow = {
  kind: "player" | "team";
  /** First-seen spelling; the prelude keys it again with its own normaliser. */
  name: string;
  nameNormalized: string;
  sportId: Id<"selectorOptions">;
  decision?: PreludeDecision;
};

export function decisionOfAnswer(
  answer: Doc<"tidyNames">["answer"],
): PreludeDecision | undefined {
  if (!answer) return undefined;
  if (answer.kind === "notEntity") return { action: "skip" };
  if (answer.kind === "linkPlayer") {
    return {
      action: "link",
      linkedPlayerId: answer.playerId,
      ...(answer.by === "auto" && answer.autoReason ? { autoLinked: answer.autoReason } : {}),
      ...(answer.addSetSport ? { addSetSport: true as const } : {}),
    };
  }
  return {
    action: "link",
    linkedTeamId: answer.teamId,
    ...(answer.by === "auto" && answer.autoReason ? { autoLinked: answer.autoReason } : {}),
    ...(answer.saveAsAlias ? { saveAsAlias: true as const } : {}),
  };
}

export function preludeRowOf(row: TidyRow): PreludeNameRow {
  const decision = decisionOfAnswer(row.answer);
  return {
    kind: row.kind,
    name: row.name,
    nameNormalized: row.nameNormalized,
    sportId: row.sportId,
    ...(decision ? { decision } : {}),
  };
}

/**
 * The row the commit prelude reads, in the `entityReviewQueue` shape its
 * decision machinery was written against. Only the fields the prelude reads
 * are real (`kind`, `name`, `sportId`, `decision`, `enrichment`); the rest are
 * the row's own identity, so `reviewByKey` and the alias / sport walks run
 * unchanged. A `create` decision never occurs: "Add as new player" mints the
 * player when it is pressed.
 */
export function tidyRowAsReviewRow(
  row: Doc<"tidyNames">,
): Doc<"entityReviewQueue"> {
  const decision = decisionOfAnswer(row.answer);
  return {
    _id: row._id as unknown as Id<"entityReviewQueue">,
    _creationTime: row._creationTime,
    selectorOptionId: row.scopeId,
    batchId: "tidyNames",
    createdByUserId: row.answeredByUserId ?? "",
    kind: row.kind,
    name: row.name,
    nameNormalized: row.nameNormalized,
    sportId: row.sportId,
    status: row.status,
    ...(row.enrichment ? { enrichment: row.enrichment } : {}),
    ...(decision ? { decision } : {}),
  } as unknown as Doc<"entityReviewQueue">;
}
