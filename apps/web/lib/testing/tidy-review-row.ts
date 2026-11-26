/**
 * NEO-656 test shim — seed a review decision the way the commit now reads it.
 *
 * The commit prelude used to read an `entityReviewQueue` row's `decision`, then
 * a `tidyNames` row's `answer`. It reads the gate's own links now: the gate
 * returns `gateLinks` (`resolveChecklistEntities`), the client hands them back
 * to `commitCardChecklist`, and `convex/lib/tidyAnswerDecisions.ts` adapts each
 * one into the decision the prelude's rules were written against. Nothing is
 * stored. Tests that pin a prelude rule (an auto-link beats the single match,
 * an auto-link carries its origin) keep their seeds in the old row shape and
 * pass them here for the `gateLinks` entry to send.
 *
 * What does NOT convert: an operator's link, a skip and a `create` decision.
 * An operator answers a name on the card in the walk (`tidyNames.answerName`,
 * `createPlayer`, the New Team dialog), never at commit, and nothing remembers a
 * ruled-out name. A staged `source` row is retired too (career teams and
 * leagues have their own forms). Each throws, so a test that still needs one
 * fails loudly instead of passing on nothing.
 */

import type { Id } from "../../convex/_generated/dataModel";
import type { GateLink } from "../../convex/lib/tidyAnswerDecisions";

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
  // Accepted and ignored: a gate link has no batch and no owner.
  batchId?: string;
  createdByUserId?: string;
  [key: string]: unknown;
};

/**
 * The `gateLinks` entry for an old-shape review row, or `undefined` for a row
 * with no decision (the name is pending on the card).
 */
export function gateLinkOfSeed(seed: ReviewRowSeed): GateLink | undefined {
  if (seed.source) {
    throw new Error("a staged `source` row is retired: career teams and leagues have their own forms");
  }
  const decision = seed.decision;
  if (!decision) return undefined;
  if (decision.action === "create") {
    throw new Error(
      "a 'create' review decision is retired: create through tidyNames.createPlayer / the New Team dialog",
    );
  }
  if (decision.action === "skip") {
    throw new Error(
      "a 'skip' review decision is retired: nothing remembers a ruled-out name; drop it from the card's pending names",
    );
  }
  if (!decision.autoLinked) {
    throw new Error(
      "an operator's link is retired at commit: the walk links the name on the card (tidyNames.answerName)",
    );
  }
  return {
    kind: seed.kind,
    name: seed.name,
    origin: decision.autoLinked,
    ...(seed.kind === "player"
      ? { playerId: decision.linkedPlayerId! }
      : { teamId: decision.linkedTeamId! }),
  };
}
