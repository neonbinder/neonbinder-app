/**
 * NEO-645 test shim — seed a review decision the way the commit now reads it.
 *
 * The commit prelude used to read an `entityReviewQueue` row's `decision`. It
 * reads a `tidyNames` row's `answer` now (`convex/lib/tidyAnswerDecisions.ts`).
 * Tests that pin a prelude rule (an operator's link beats the single match, a
 * skip beats the narrowing, an auto-link carries its origin, `saveAsAlias`,
 * `addSetSport`) keep their seeds in the old row shape and pass them here.
 *
 * What does NOT convert: a `create` decision (the player or team is created
 * when the operator presses it, `tidyNames.createPlayer` / the New Team dialog,
 * never at commit) and a staged `source` row (career teams and leagues are
 * written by their own forms). Both throw, so a test that still needs one fails
 * loudly instead of passing on nothing.
 */

import type { Doc, Id } from "../../convex/_generated/dataModel";
import { normalizeEntityName } from "../entities/normalize-name";

type Decision =
  | {
      action: "link";
      linkedPlayerId?: Id<"players">;
      linkedTeamId?: Id<"teams">;
      autoLinked?: "setHistory" | "hallOfFame" | "careerTeam";
      addSetSport?: true;
      saveAsAlias?: true;
    }
  | { action: "skip" }
  | { action: "create"; [key: string]: unknown };

export type ReviewRowSeed = {
  selectorOptionId: Id<"selectorOptions">;
  kind: "player" | "team";
  name: string;
  sportId: Id<"selectorOptions">;
  status?: "pending" | "ready" | "error";
  decision?: Decision;
  enrichment?: unknown;
  source?: unknown;
  // Accepted and ignored: a name row has no batch and no owner.
  batchId?: string;
  createdByUserId?: string;
  [key: string]: unknown;
};

type Ctx = {
  db: { insert: (table: "tidyNames", doc: never) => Promise<Id<"tidyNames">> };
};

export function answerOfDecision(
  kind: "player" | "team",
  decision: Decision | undefined,
): Doc<"tidyNames">["answer"] | undefined {
  if (!decision) return undefined;
  if (decision.action === "create") {
    throw new Error(
      "a 'create' review decision is retired: create through tidyNames.createPlayer / the New Team dialog",
    );
  }
  if (decision.action === "skip") return { kind: "notEntity", by: "operator" };
  const auto = decision.autoLinked
    ? ({ by: "auto", autoReason: decision.autoLinked } as const)
    : ({ by: "operator" } as const);
  if (kind === "player") {
    return {
      kind: "linkPlayer",
      playerId: decision.linkedPlayerId!,
      ...auto,
      ...(decision.addSetSport ? { addSetSport: true as const } : {}),
    } as never;
  }
  return {
    kind: "linkTeam",
    teamId: decision.linkedTeamId!,
    ...auto,
    ...(decision.saveAsAlias ? { saveAsAlias: true as const } : {}),
  } as never;
}

/** Insert the `tidyNames` row for an old-shape review row. */
export async function insertAsTidyName(ctx: Ctx, seed: ReviewRowSeed): Promise<Id<"tidyNames">> {
  if (seed.source) {
    throw new Error("a staged `source` row is retired: career teams and leagues have their own forms");
  }
  const answer = answerOfDecision(seed.kind, seed.decision);
  return ctx.db.insert("tidyNames", {
    scopeId: seed.selectorOptionId,
    kind: seed.kind,
    nameNormalized: normalizeEntityName(seed.name),
    name: seed.name,
    sportId: seed.sportId,
    status: seed.status ?? "ready",
    ...(answer ? { answer, answerGen: 1, answeredByUserId: "user_review_001", answeredAt: Date.now() } : {}),
    ...(seed.enrichment ? { enrichment: seed.enrichment } : {}),
  } as never);
}
