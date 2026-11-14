/**
 * NEO-277 — the rules for a set-level team (`selectorOptions.teamIds`) and
 * how it reaches the rows beneath it.
 *
 * Three writers apply these rules and must agree about them: the node and
 * card CREATION sites (copy-down), the edit CASCADE
 * (`cascadeSelectorOptionTeams`), and the cascade PREVIEW the confirm dialog
 * shows before the edit. Three copies of "does this row follow?" is three
 * chances for the dialog to promise a count the cascade does not deliver, so
 * the decision lives here once, as pure functions, and is tested as such.
 *
 * Typed against ids only — no generated code, no ctx — so a lib test can
 * exercise every branch without seeding a database.
 */

import type { Id } from "../_generated/dataModel";

/**
 * NEO-556 — the operator's set-level "No Team" answer, as stored on
 * `selectorOptions.noTeamDefault` (see schema.ts). Server-stamped.
 */
export type NoTeamDefault = { setAt: number; setByUserId: string };

/**
 * NEO-556 — a row's team default, in all three states: `unset` (neither
 * field), `teams` (`teamIds`), `noTeam` (`noTeamDefault`). The one writer
 * never stores both; a row that somehow carries both reads as `teams` — a
 * value that names a team holds back the "no team" answer, never the other
 * way round (product invariant 8).
 */
export type TeamDefault =
  | { kind: "unset" }
  | { kind: "teams"; teamIds: Array<Id<"teams">> }
  | { kind: "noTeam"; noTeamDefault: NoTeamDefault };

type TeamDefaultRow = {
  teamIds?: ReadonlyArray<Id<"teams">>;
  noTeamDefault?: NoTeamDefault;
};

/** The row's team default (a COPY of its ids — never the row's array). */
export function teamDefaultOf(
  row: TeamDefaultRow | null | undefined,
): TeamDefault {
  const ids = row?.teamIds;
  if (ids && ids.length > 0) return { kind: "teams", teamIds: [...ids] };
  if (row?.noTeamDefault) {
    return {
      kind: "noTeam",
      noTeamDefault: {
        setAt: row.noTeamDefault.setAt,
        setByUserId: row.noTeamDefault.setByUserId,
      },
    };
  }
  return { kind: "unset" };
}

/**
 * The fields a freshly created child is born with, spreadable straight into
 * an insert: `{ teamIds }` (a COPY), `{ noTeamDefault }` (the same decision,
 * same stamp — a copy-down is not a new decision), or `{}` so an absent
 * default stays absent rather than becoming an empty array (an empty array is
 * never stored — see schema.ts `teamIds`). Never both keys.
 *
 * Replaces NEO-277's `inheritedTeamIds`, which knew only the `teamIds` state.
 */
export function inheritedTeamDefault(
  parent: TeamDefaultRow | null | undefined,
):
  | { teamIds: Array<Id<"teams">> }
  | { noTeamDefault: NoTeamDefault }
  | Record<string, never> {
  return teamDefaultFields(teamDefaultOf(parent));
}

/**
 * The stored fields that spell a `TeamDefault` — the inverse of
 * `teamDefaultOf`. For an INSERT spread; a PATCH that must also remove the
 * other state uses `teamDefaultPatch`.
 */
export function teamDefaultFields(
  d: TeamDefault,
):
  | { teamIds: Array<Id<"teams">> }
  | { noTeamDefault: NoTeamDefault }
  | Record<string, never> {
  if (d.kind === "teams") return { teamIds: [...d.teamIds] };
  if (d.kind === "noTeam") return { noTeamDefault: { ...d.noTeamDefault } };
  return {};
}

/**
 * A PATCH that leaves the row holding exactly `d`: both fields always
 * present, the unused one `undefined` (how a Convex patch deletes a field),
 * so a write of one state can never leave the other behind.
 */
export function teamDefaultPatch(d: TeamDefault): {
  teamIds: Array<Id<"teams">> | undefined;
  noTeamDefault: NoTeamDefault | undefined;
} {
  return {
    teamIds: d.kind === "teams" ? [...d.teamIds] : undefined,
    noTeamDefault: d.kind === "noTeam" ? { ...d.noTeamDefault } : undefined,
  };
}

/**
 * Two defaults say the same thing: both unset, both No Team (whoever set it,
 * whenever), or the same team SET (order-insensitive).
 */
export function sameTeamDefault(a: TeamDefault, b: TeamDefault): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "teams" && b.kind === "teams") {
    return sameTeamSet(a.teamIds, b.teamIds);
  }
  return true;
}

/**
 * NEO-556 — the NEO-24 "equal-to-previous follows" rule for a descendant
 * NODE, over the three-state default:
 *
 *  - `"unchanged"`: the node already says `next`;
 *  - `"follow"`: the node is unset, or says what the edited row said BEFORE
 *    this edit — it was inheriting, so it keeps inheriting;
 *  - `"stay"`: anything else is an operator's override.
 *
 * So a set moving from team X to No Team carries every node that inherited X
 * (and every unset one) to No Team, and back again; a node an operator gave
 * team Y stays Y either way. `next` is never `unset` here: a clear never
 * cascades.
 */
export function teamDefaultFollowVerdict(
  current: TeamDefault,
  previous: TeamDefault,
  next: TeamDefault,
): TeamFollowVerdict {
  if (sameTeamDefault(current, next)) return "unchanged";
  if (current.kind === "unset") return "follow";
  if (sameTeamDefault(current, previous)) return "follow";
  return "stay";
}

/**
 * NEO-556 — the fields that stamp a card "carries no team"
 * (`teamNoneConfirmedAt` + `teamNoneConfirmedByUserId`). Both are always
 * server-sourced: `now` is the server's clock, `userId` is `requireAdmin`'s
 * subject for an operator's own action, or the set-level answer's
 * `noTeamDefault.setByUserId` for a background path acting on it.
 */
export function stampNoTeam(
  userId: string,
  now: number,
): { teamNoneConfirmedAt: number; teamNoneConfirmedByUserId: string } {
  return { teamNoneConfirmedAt: now, teamNoneConfirmedByUserId: userId };
}

/**
 * NEO-556 — why a card is NOT stamped "No Team" under a set-level No Team:
 *
 *  - `alreadyNoTeam`: it already is (`teamNoneConfirmedAt`); nothing to do.
 *  - `hasTeam`: it carries a real team (`teamOnCardIds`).
 *  - `pendingName`: it carries a typed or synced team NAME waiting on review
 *    — that is a team, unresolved (the attention rule reads it the same way).
 *  - `listingNamesTeam`: the BSC listing named a team NB could not place
 *    (`bscTeamName`). Product invariant 8: data that names a team holds back
 *    the guess. The hint is never kept for a name the operator ruled "not a
 *    team" (NEO-330 — `applyBscTeamResolution` and `commitTeamHint` drop it),
 *    so its presence alone is the claim; `ruledNotATeam` lets a caller that
 *    has just checked the ruling say so anyway.
 *  - `awaitingLookup`: the card has a BSC ref and the per-card lookup has not
 *    run (`teamCheckDoneAt` absent). Rule 8: the stamp waits for the answer;
 *    `applyBscTeamResolution` stamps it then, if BSC names no team.
 *  - `lookupGaveUp`: the lookup stopped retrying (`teamCheckOutcome`
 *    "gaveUp"). The data is missing, so the operator decides; never stamped
 *    automatically.
 *
 * Checked in that order. An SL-only or hand-added card (no BSC ref) has no
 * lookup to wait on. A lookup stamp with no recorded outcome (one written
 * before NEO-345) is read as answered: the queue only ever set it after BSC
 * replied or, rarely, gave up, and the operator's run counts what it stamps.
 *
 * Pure, ids-only: the commit's insert branch, `addCustomCard`, the parallel
 * build, `applyBscTeamResolution` and the operator's run all ask this one
 * function, so the confirm dialog's skip counts and the writes cannot
 * disagree.
 */
export type NoTeamKeepReason =
  | "alreadyNoTeam"
  | "hasTeam"
  | "pendingName"
  | "listingNamesTeam"
  | "awaitingLookup"
  | "lookupGaveUp";

export type NoTeamCardVerdict =
  | { verdict: "stamp" }
  | { verdict: "keep"; reason: NoTeamKeepReason };

export type NoTeamVerdictCard = {
  teamOnCardIds?: ReadonlyArray<Id<"teams">>;
  pendingTeamNames?: ReadonlyArray<string>;
  teamNoneConfirmedAt?: number;
  bscTeamName?: string;
  teamCheckDoneAt?: number;
  teamCheckOutcome?: "answered" | "gaveUp" | "checklist";
  /** Only `bsc`'s presence is read (see `features/cardAttention.ts`). */
  platformData?: { bsc?: { ref: string } };
};

export function noTeamCardVerdict(
  card: NoTeamVerdictCard,
  opts: { ruledNotATeam?: boolean } = {},
): NoTeamCardVerdict {
  if (card.teamNoneConfirmedAt !== undefined) {
    return { verdict: "keep", reason: "alreadyNoTeam" };
  }
  if ((card.teamOnCardIds?.length ?? 0) > 0) {
    return { verdict: "keep", reason: "hasTeam" };
  }
  if ((card.pendingTeamNames?.length ?? 0) > 0) {
    return { verdict: "keep", reason: "pendingName" };
  }
  if ((card.bscTeamName?.trim() ?? "") !== "" && !opts.ruledNotATeam) {
    return { verdict: "keep", reason: "listingNamesTeam" };
  }
  const hasBscRef = !!card.platformData?.bsc;
  if (hasBscRef && card.teamCheckDoneAt === undefined) {
    return { verdict: "keep", reason: "awaitingLookup" };
  }
  if (card.teamCheckOutcome === "gaveUp") {
    return { verdict: "keep", reason: "lookupGaveUp" };
  }
  return { verdict: "stamp" };
}

/**
 * Order-insensitive equality over two id lists. `teamOnCardIds` is display
 * order, so two rows carrying the same teams in a different order still carry
 * the same teams — a cascade must not read that as an override.
 */
export function sameTeamSet(
  a: ReadonlyArray<Id<"teams">> | undefined,
  b: ReadonlyArray<Id<"teams">> | undefined,
): boolean {
  const left = new Set<string>(a ?? []);
  const right = new Set<string>(b ?? []);
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}

/**
 * The verdict for one descendant row when the set-level team changes from
 * `previous` to `next` — the NEO-24 "equal-to-previous follows" rule:
 *
 *  - `"unchanged"`: the row already carries `next`; nothing to write, and it
 *    counts as neither following nor staying.
 *  - `"follow"`: the row is empty, or carries exactly what the set carried
 *    BEFORE this edit — it was inheriting, so it keeps inheriting.
 *  - `"stay"`: anything else is an operator's override and is left alone.
 *
 * `next` is never empty here: a CLEAR never cascades (see schema.ts), so the
 * callers do not ask.
 */
export type TeamFollowVerdict = "unchanged" | "follow" | "stay";

export function teamFollowVerdict(
  current: ReadonlyArray<Id<"teams">> | undefined,
  previous: ReadonlyArray<Id<"teams">> | undefined,
  next: ReadonlyArray<Id<"teams">>,
): TeamFollowVerdict {
  if (sameTeamSet(current, next)) return "unchanged";
  if (!current || current.length === 0) return "follow";
  if (sameTeamSet(current, previous)) return "follow";
  return "stay";
}

/**
 * Why a CARD stays when the set-level team changes — one of three reasons,
 * checked in this order:
 *
 *  - `"teamless"`: an operator said this card carries no team
 *    (`teamNoneConfirmedAt`) — that decision outranks every set-level
 *    default, always;
 *  - `"pendingName"`: the card carries a typed or synced team NAME nobody has
 *    resolved yet (`pendingTeamNames`) — that is the card's own answer
 *    waiting on review, and writing ids beside it would make the row say its
 *    team twice (the same rule `updateCard` and `addCustomCard` keep by never
 *    storing both);
 *  - `"overridden"`: the card carries a DIFFERENT team — neither empty nor
 *    what the set carried before this edit — so someone picked it on purpose.
 *
 * The cascade only needs the verdict; the confirm dialog wants the reason as
 * well, so it can say "3 cards keep their own team, 1 is marked teamless"
 * rather than one opaque "staying" number. Both read the same function so
 * the dialog can never attribute a stay the cascade does not make.
 */
export type CardTeamStayReason = "teamless" | "pendingName" | "overridden";

export type CardTeamFollowOutcome =
  | { verdict: "unchanged" | "follow" }
  | { verdict: "stay"; reason: CardTeamStayReason };

/**
 * The full outcome for one CARD, which has two more reasons to stay than a
 * node (see `CardTeamStayReason`).
 *
 * The teamless and pending-name checks run BEFORE the "already carries
 * `next`" short-circuit on purpose: a card that is confirmed teamless has
 * empty `teamOnCardIds`, and the empty-follows branch of `teamFollowVerdict`
 * would otherwise fill it in.
 */
export function cardTeamFollowOutcome(
  card: {
    teamOnCardIds?: ReadonlyArray<Id<"teams">>;
    teamNoneConfirmedAt?: number;
    pendingTeamNames?: ReadonlyArray<string>;
  },
  previous: ReadonlyArray<Id<"teams">> | undefined,
  next: ReadonlyArray<Id<"teams">>,
): CardTeamFollowOutcome {
  if (card.teamNoneConfirmedAt !== undefined) {
    return { verdict: "stay", reason: "teamless" };
  }
  if ((card.pendingTeamNames?.length ?? 0) > 0) {
    return { verdict: "stay", reason: "pendingName" };
  }
  const verdict = teamFollowVerdict(card.teamOnCardIds, previous, next);
  return verdict === "stay"
    ? { verdict, reason: "overridden" }
    : { verdict };
}

/**
 * The verdict for one CARD — `cardTeamFollowOutcome` without the reason, for
 * the cascade, which only needs to know whether to write.
 */
export function cardTeamFollowVerdict(
  card: {
    teamOnCardIds?: ReadonlyArray<Id<"teams">>;
    teamNoneConfirmedAt?: number;
    pendingTeamNames?: ReadonlyArray<string>;
  },
  previous: ReadonlyArray<Id<"teams">> | undefined,
  next: ReadonlyArray<Id<"teams">>,
): TeamFollowVerdict {
  return cardTeamFollowOutcome(card, previous, next).verdict;
}

/**
 * The team a NEW card is born with: its own, if it arrived with one in any
 * form — real ids, or a typed/synced name still waiting on review — else the
 * leaf's set-level team, else nothing. Returns a COPY of the leaf's list for
 * the same reason `inheritedTeamDefault` does. A leaf whose default is No
 * Team defaults no ids here — the stamp is `noTeamCardVerdict`'s call.
 *
 * "Arrived with a name" counts as arrived with a team for the reason given on
 * `cardTeamFollowVerdict`: the name is the card's answer, and defaulting the
 * set's team underneath it would have the row claim two different things
 * until an operator resolves the name.
 */
export function defaultTeamOnCardIds(
  card: {
    teamOnCardIds?: ReadonlyArray<Id<"teams">>;
    pendingTeamNames?: ReadonlyArray<string>;
  },
  leaf: TeamDefaultRow | null | undefined,
): { ids: Array<Id<"teams">> | undefined; defaulted: boolean } {
  if ((card.teamOnCardIds?.length ?? 0) > 0) {
    return { ids: [...card.teamOnCardIds!], defaulted: false };
  }
  if ((card.pendingTeamNames?.length ?? 0) > 0) {
    return { ids: undefined, defaulted: false };
  }
  const inherited = teamDefaultOf(leaf);
  return inherited.kind === "teams"
    ? { ids: inherited.teamIds, defaulted: true }
    : { ids: undefined, defaulted: false };
}
