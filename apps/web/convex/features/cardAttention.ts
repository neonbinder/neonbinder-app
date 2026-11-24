/**
 * NEO-102 — "this stored card still needs a human", derived rather than queued.
 *
 * ## Why a derivation and not a review-queue row
 *
 * The first design for reconciling teamless cards added a third
 * review-row kind and rode the commit wire: rows created during the
 * fetch, decided in the wizard, applied by the commit. That works only for
 * cards a sync is about to touch. The cards that actually need attention are
 * the ones ALREADY COMMITTED — dev's 2026 Topps base has ten teamless League
 * Leaders cards sitting in `cardChecklist` today, every one of them stamped
 * `teamCheckDoneAt` by the background queue and therefore invisible forever.
 * A pure derivation over stored rows covers those with zero migration, needs
 * no per-batch state, and cannot be raced by a commit.
 *
 * So this module is deliberately PURE: no ctx, no database, no async. It reads
 * the fields a card already carries and answers what a human still owes it.
 * That is what lets the SPA call it directly on a `getCardChecklist` row (the
 * same way it already imports `expectedFeatures`) and lets a Convex query call
 * it server-side, with no chance of the two disagreeing.
 *
 * NEO-101 added the three listing-title/aspect kinds below. Keep this module
 * free of anything that would stop it running in the browser — its only import
 * is `listingInputs.ts` (NEO-335), which is itself pure: the title generator,
 * the feature derivations and `listingLimits.ts`'s numbers.
 */

// NEO-335: the title/aspect rules live in `listingInputs.ts`, which is as
// browser-safe as this module (pure features only, no server imports).
import { titleAttentionItems } from "./listingInputs";
// NEO-645: "does this card have a name?" is one pure helper, read here and by the
// checklist reader that mints the placeholder, so the two cannot disagree.
import { hasCardName } from "../../lib/cards/unnamed-card";
// NEO-645: the autograph rule reads NB's own vocabulary (attribute token and
// format list). Both live in a module that is as browser-safe as this one.
import { AUTOGRAPH_FORMATS, carriesAutographToken } from "./deriveCardFeatures";

/**
 * One thing a card still needs from a human.
 *
 * Nothing here carries a message string: how an item is worded is a UI
 * decision, and duplicating it server-side is how the two drift. The wording
 * lives in `components/SetSelector/card-attention.ts` (`ATTENTION_LABELS`),
 * which is a `Record<AttentionKind, string>` — so adding a member here without
 * adding its label there does not typecheck, deliberately.
 *
 * The numeric payloads exist so a label or a fixer can state the actual
 * measurement without re-measuring the row it was derived from.
 */
export type AttentionItem =
  | { kind: "missingTeam" }
  // NEO-101: the stored title is longer than eBay will accept. eBay REJECTS
  // rather than truncating, so this one BLOCKS listing — the only way a row
  // reaches this state is an operator edit made before `updateCard` gained its
  // cap, since the generator cannot produce one.
  | { kind: "titleOverLimit"; length: number }
  // NEO-101: the auto-generated title's core was cut at a word boundary to fit
  // (see `cardChecklist.listingTitleTruncated`). Listable as-is; a human should
  // put the missing identifying words back.
  | { kind: "titleTruncated" }
  // NEO-101: an aspect-shaped field is longer than eBay's item-specific value
  // limit. WARN ONLY — nothing blocks the write, because no NB field is yet
  // proven to map verbatim onto an eBay aspect.
  | { kind: "aspectValueOverLimit"; field: "cardVariation"; length: number }
  // NEO-221: names on this card that the operator never ruled on in the review
  // wizard, so the card carries them as free text and links to no player/team.
  // The names are carried so the label and the fixer can say WHICH, without
  // re-reading the row.
  | { kind: "unreviewedName"; names: string[] };

/** The discriminant alone, for keying label maps and fixer registries. */
export type AttentionKind = AttentionItem["kind"];

/**
 * Exactly the fields `deriveCardAttention` reads, typed STRUCTURALLY rather
 * than as `Doc<"cardChecklist">`.
 *
 * Two reasons. The SPA passes a `getCardChecklist` row, which is a doc plus
 * cross-listing annotations and is not the doc type; and a caller that only
 * has a projection (a test fixture, a future narrowed query) should be able to
 * use this without inventing an `_id`. `readonly string[]` accepts
 * `Id<"teams">[]` because a Convex id is a branded string.
 */
export type AttentionCardRow = {
  /** The team(s) printed on the card. Absent and `[]` are the same statement. */
  teamOnCardIds?: readonly string[];
  /**
   * NEO-221 — the player(s) this card is linked to. Read only for whether it
   * is empty: a card that already links to a player has its answer, whatever
   * extra spelling `pendingPlayerNames` still carries.
   */
  playerIds?: readonly string[];
  /**
   * Team names an operator typed that no `teams` row exists for yet; the next
   * sync's resolve pass turns them into `teamOnCardIds` (see schema.ts and
   * selectorOptions.ts). A non-empty list is an answer already given: the card
   * is UNRESOLVED, not unanswered, so it counts as having a team. Reading only
   * `teamOnCardIds` badged every hand-added card with a typed team and sent
   * the walker to ask the operator for something they had just supplied.
   *
   * NEO-208 note on where these come from. The quick-add form used to be the
   * main producer — it had a free-text "Team (optional)" box that wrote here —
   * and it now uses `TeamPicker` and sends real `teamOnCardIds`, so a card
   * added by hand today is born linked and never lands in this state. What
   * remains are rows written before that, and an old SPA bundle still sending
   * the legacy `addCustomCard.teams` name array. THE RULE IS UNCHANGED: a
   * pending name still counts as an answer, because those legacy rows are
   * exactly as answered as they ever were, and because the operator who typed
   * the name is not the person to re-ask. `updateCard` clears the names when a
   * real team is linked, so a row cannot end up counted twice.
   */
  pendingTeamNames?: readonly string[];
  /**
   * NEO-221 — player names this card carries that resolve to no `players` row.
   *
   * Two producers, one meaning. `addCustomCard` writes them when an operator
   * types a player the table does not have yet; `commitCardChecklist` writes
   * them when a synced card's name reached commit with no review decision.
   * Either way the card names a player it does not link to, and either way the
   * fix is the same — link it, or let the next sync's wizard resolve it. The
   * rule below deliberately does NOT try to tell the two apart: where a row
   * came from is not something NB behaviour is keyed on.
   *
   * NEO-220 note on the first producer, mirroring the NEO-208 note on
   * `pendingTeamNames` above. The quick-add form used to be it — a free-text
   * "Player(s)" box that wrote here — and it now uses `PlayerPicker` and sends
   * real `playerIds`, so a card added by hand today is born linked and never
   * lands in this state. What remains are rows written before that, rows an
   * old SPA bundle wrote through the legacy `addCustomCard.players` name
   * array, and the commit path. THE RULE IS UNCHANGED.
   */
  pendingPlayerNames?: readonly string[];
  /** Operator confirmed this card carries no team — see schema.ts. */
  teamNoneConfirmedAt?: number;
  /** The BSC per-card team lookup has RUN, whatever it found — see schema.ts. */
  teamCheckDoneAt?: number;
  /**
   * Only `bsc.ref`'s presence is read: it is what makes a card eligible for
   * the BSC per-card team lookup at all. `sportlots` is declared so a caller
   * can hand over a whole stored row without a cast, and is deliberately NOT
   * consulted — SportLots' checklist scrape never attempts team extraction
   * (see the note in adapters/sportlots.ts), so an SL ref is not something to
   * wait on.
   */
  platformData?: {
    bsc?: { ref: string };
    sportlots?: { ref: string };
  };
  /**
   * NEO-101 — the marketplace-agnostic listing title (see schema.ts). Measured,
   * never parsed: `titleOverLimit` is just its length against the eBay cap.
   */
  listingTitle?: string;
  /**
   * NEO-101 — the generator had to cut the title's core at creation time.
   *
   * A STORED flag rather than a recomputation, unlike every other input here,
   * and that asymmetry is deliberate: a row does not carry the player names or
   * set name its title was built from, so "did the core fit?" cannot be
   * re-derived from the row. `updateCard` clears it on any operator title
   * write, so the item goes away the moment a human authors the title — which
   * is the same self-clearing behaviour a recomputation would have given.
   */
  listingTitleTruncated?: boolean;
  /**
   * NEO-101/189 — NB's own per-card variation name. Read only for its length
   * against eBay's item-specific value cap.
   */
  cardVariation?: string;
  /**
   * NEO-645 — NB's own attribute tokens ("RC", "AU"). Read only by the new
   * derivation, for the autograph rule: a card that carries the AU token and
   * has no autograph FORMAT yet is a pink stop.
   */
  attributes?: readonly string[];
  /**
   * NEO-645 — the card's feature map. Read only for `autographed`: a value in
   * `AUTOGRAPH_FORMATS` answers the autograph question; anything else ("None",
   * absent) does not.
   */
  features?: Readonly<Record<string, string>>;
  /**
   * NEO-645 — the card's own name, read only by `needsName`: a card with no
   * player must carry one. Absent on a fixture that does not say (then nothing
   * is raised); a stored row always has the field.
   */
  cardName?: string;
  /** NEO-645 — fields on which the sources still disagree. See the schema. */
  sourceDisagreements?: readonly TidyDisagreement[];
};

/**
 * Structural twin of `sourceDisagreementValidator` (schema.ts).
 *
 * `chosen` is LEGACY and read-only (NEO-656): a pick now removes the entry from
 * the card, so nothing writes `chosen` any more. A card that still holds one
 * (stored before the release, until the armed clear has run) is read as if the
 * entry were absent (`isOpenDisagreement`).
 */
export type TidyDisagreement = {
  field: "players" | "teams";
  values: ReadonlyArray<{ value: readonly string[]; sources: readonly string[] }>;
  chosen?: { value: readonly string[]; by: "operator"; typed?: true };
};

/**
 * NEO-656 — is this entry a disagreement still waiting on the operator? One
 * env-free predicate for every reader (`allTidyItems`, `entryFor`, the tile):
 * an entry that carries the legacy `chosen` is settled, so it raises nothing and
 * offers nothing, exactly as a card picked after the release.
 */
export function isOpenDisagreement(d: Pick<TidyDisagreement, "chosen">): boolean {
  return !d.chosen;
}

/**
 * NEO-656 (J5/J6, Jason: "it should read real data and display pink/blue as
 * appropriate depending on the current state of the data") — the career gaps the
 * caller has read LIVE: `careerCoverage.careerGaps` answers them for the cards
 * on screen. Ids are plain strings so this module stays free of generated code.
 * Without it `deriveCardAttention` raises no careerGap (it stays pure).
 */
export type LiveCareerGap = { playerId: string; teamId: string };
export type LiveAttention = { careerGaps?: ReadonlyArray<LiveCareerGap> };

/**
 * NEO-102 — what this card still needs from a human.
 *
 * NEO-645: this is the LEGACY derivation, kept under its own name while the
 * badge, the pill and the attention walker still read it. The One-card Tidy
 * Up derivation is `deriveCardAttention` below. Both are removed together with
 * the walker.
 *
 * ## The `missingTeam` rule, and why it has three clauses
 *
 *   1. the card has no team on file — `teamOnCardIds` AND `pendingTeamNames`
 *      are both empty. A pending name is a team the operator typed that no
 *      `teams` row exists for yet, so the card is unresolved rather than
 *      unanswered; nothing else is a missing team.
 *   2. `teamNoneConfirmedAt` is unset. An operator who said "this card carries
 *      no team" has answered; re-asking is the bug this field exists to stop.
 *   3. the card is not still WAITING on the automatic answer.
 *   4. (NEO-221) no `unreviewedName` item fired. That item's fixer links the
 *      whole card in one write, so raising both would stop the walker twice
 *      for one piece of work.
 *
 * Clause 3 is the one worth explaining. A card with a `platformData.bsc.ref`
 * has an automatic source for its team: the `bscTeamPool` lane walks the
 * cards a commit just wrote, about one BSC detail request every 2 s, and fills
 * `teamOnCardIds` where BSC has an answer. Right after a 900-card sync, that
 * lane is up to half an hour from finishing — badging every BSC card "missing team"
 * during the drain would flood the checklist with items that resolve
 * themselves, and would train the operator to ignore the badge. So a
 * BSC-linked card is only badged once `teamCheckDoneAt` says the lookup has
 * been and gone. A card with no BSC ref (a custom card, a SportLots-only card
 * — SportLots deliberately never scrapes team, see adapters/sportlots.ts) has
 * no automatic source to wait for, so it is badged immediately.
 *
 * Note clause 3 does NOT read whether the queue SUCCEEDED. `teamCheckDoneAt`
 * means "asked, regardless of outcome", and a BSC card that came back with no
 * team on file is precisely the case a human has to settle.
 *
 * NEO-330 — clause 3 is only safe because the wait ENDS. A lookup that failed
 * used to leave `teamCheckDoneAt` unset with nothing scheduled to ask again,
 * so this clause hid the card forever. The queue now retries a failure a
 * bounded number of times (`BSC_TEAM_CHECK_MAX_PASSES` in
 * `adapters/buysportscards.ts`) and then stamps `teamCheckDoneAt` through
 * `bscTeamCheck.markBscTeamCheckGivenUp`, writing no team — so the card lands
 * here, badged, for the operator to pick. Jason, 2026-10-11: "If a team lookup
 * never returns then the user must select a team." A lookup that never
 * returned is missing data, not a claim (invariant 8, NEO-639): the fixer
 * offers the career as for any card, preselecting a player's set-year team
 * only when he has exactly one.
 */
export function deriveLegacyCardAttention(row: AttentionCardRow): AttentionItem[] {
  const items: AttentionItem[] = [];

  // ── NEO-221: a name on the card that links to nothing ────────────────────
  //
  // Computed first because `missingTeam` below defers to it — see there.
  //
  // Fires per side, on the same shape of test: a pending NAME with no
  // corresponding LINK. `pendingPlayerNames` with an empty `playerIds`, or
  // `pendingTeamNames` with an empty `teamOnCardIds`. A card that already
  // links to a player or a team has its answer, and the leftover spelling is
  // a duplicate rather than a gap.
  //
  // ## No marketplace gate, deliberately
  //
  // An earlier draft badged only cards carrying a BSC or SportLots ref, on the
  // theory that a hand-added card's pending name is an answer awaiting the
  // next sync while a synced card's is a question never asked. That is the
  // "custom card" concept re-spelled, and NB behaviour is never keyed on
  // whether a row has marketplace ids (see the product invariant in the root
  // CLAUDE.md). It is also not true: both producers leave a card naming a
  // player it does not link to, and both are fixed the same way — link it in
  // the walker, or let the next sync's wizard resolve it.
  const unreviewed = [
    ...((row.playerIds?.length ?? 0) === 0 ? (row.pendingPlayerNames ?? []) : []),
    ...((row.teamOnCardIds?.length ?? 0) === 0 ? (row.pendingTeamNames ?? []) : []),
  ];

  const hasTeam =
    (row.teamOnCardIds?.length ?? 0) > 0 || (row.pendingTeamNames?.length ?? 0) > 0;
  const awaitingBscLookup = !!row.platformData?.bsc?.ref && !row.teamCheckDoneAt;
  // `unreviewed.length === 0` is the fourth clause, and it is about the
  // WALKER rather than about teams. `unreviewedName`'s fixer links the whole
  // card — players and teams, in one write — so a card carrying both items
  // would stop the operator twice for one piece of work, and the second stop
  // would present a question the first had already answered. One gap, one
  // badge. (The two only ever coincide on a card with an unresolved PLAYER
  // name and no team at all: a pending TEAM name already counts as having a
  // team, so it suppresses `missingTeam` through `hasTeam` above.)
  if (
    !hasTeam &&
    !row.teamNoneConfirmedAt &&
    !awaitingBscLookup &&
    unreviewed.length === 0
  ) {
    items.push({ kind: "missingTeam" });
  }

  // NEO-101 — the title/aspect kinds. NEO-335 moved the rules into
  // `listingInputs.titleAttentionItems`, unchanged, so the wizard's pre-save
  // "Card titles" step asks the same question of a card that is not a row yet
  // (over the assessment `buildCardRowForInsert` writes the row from). See
  // there for why the two title rules are mutually exclusive.
  items.push(...titleAttentionItems(row));

  // NEO-221 — see the note where `unreviewed` is computed, at the top. Pushed
  // last so the title/aspect items keep the order they had.
  if (unreviewed.length > 0) {
    items.push({ kind: "unreviewedName", names: [...unreviewed] });
  }

  return items;
}

/**
 * Convenience for a row badge or a filter predicate.
 *
 * NEO-645: still the LEGACY rule (`deriveLegacyCardAttention`), so the grid
 * filter and the pill keep their old meaning until the walk shell flips them
 * to `deriveCardAttention`. Callers that want the new rule read
 * `deriveCardAttention(row).level !== "none"`.
 */
export function needsAttention(row: AttentionCardRow): boolean {
  return deriveLegacyCardAttention(row).length > 0;
}

/**
 * NEO-335 — a card still waiting on the automatic BSC team lookup: linked to
 * BSC, no team on it, nobody has said it has none, and the lookup has not
 * stamped `teamCheckDoneAt`. PR 451 (NEO-487): that is a card on the
 * one-slot `bscTeamPool` lane, queued or in flight; the lane stamps
 * `teamCheckDoneAt` when it answers and when it gives up (the operator's
 * turn), so the row alone says whether the lookup is still owed.
 *
 * These are exactly the cards `deriveCardAttention` holds back from
 * `missingTeam` while they wait (its clause 3). Never a reason to badge or
 * ask: the lookup answers most of them. Two readers: the walker's done line,
 * and the checklist's "Still looking up teams" status line, which is the
 * only handle on them while nothing else needs the operator.
 *
 * Reads only the presence of the BSC ref, the same as the rule it mirrors.
 * Lives here, in the pure module, rather than beside the fixers in
 * `cardAttentionRegistry.ts` (which re-exports it), so the checklist can count
 * with it without loading the fixer components.
 */
export function isAwaitingTeamLookup(row: AttentionCardRow): boolean {
  return (
    !!row.platformData?.bsc?.ref &&
    !row.teamCheckDoneAt &&
    !row.teamNoneConfirmedAt &&
    (row.teamOnCardIds?.length ?? 0) === 0 &&
    (row.pendingTeamNames?.length ?? 0) === 0
  );
}

/**
 * NEO-102 — the hard cap on how many teams one card can carry.
 *
 * eBay's Team aspect is single-select, so a listing only ever sends one team
 * regardless of how many a card has on file; the multi-team case this feature
 * exists for is a League Leaders / rookie-combo card, where a handful of
 * players each contribute one team. 8 is a sanity bound on that, not a
 * marketplace rule — nothing requires exactly this number, it just keeps a
 * fat-fingered "select all" from writing an unbounded array. Enforced
 * server-side in `selectorOptions.updateCard`; `MissingTeamFixer.tsx` IMPORTS
 * this same constant (through the `components/SetSelector/card-attention`
 * seam) rather than keeping its own copy, so the picker and its cap message
 * cannot disagree with what the server will actually accept.
 */
export const MAX_CARD_TEAMS = 8;

/**
 * NEO-220 — the hard cap on how many players one card can be LINKED to.
 *
 * Deliberately much wider than `MAX_CARD_TEAMS`: a card is never printed for
 * more than a handful of teams, but a League Leaders / rookie-combo / team
 * checklist card legitimately names well past eight players. 20 is a sanity
 * bound on a picker, not a marketplace rule — it sits comfortably above the
 * widest real multi-player card while still being a hard bound, and it is the
 * SAME number `selectorOptions.MAX_PENDING_PLAYER_NAMES` already uses for the
 * typed-name shape of the same field, so the two spellings of "the players on
 * this card" cannot accept different amounts.
 *
 * Enforced server-side by BOTH writers of the field —
 * `selectorOptions.addCustomCard` and `selectorOptions.updateCard` — through
 * the one shared `resolvePlayerIdsForWrite`, so a card born with a player list
 * and a card given one later cannot be held to different limits (NEO-246;
 * `updateCard` was the unvalidated half until then). Same arrangement
 * `MAX_CARD_TEAMS` has with `resolveTeamOnCardIdsForWrite`.
 */
export const MAX_CARD_PLAYERS = 20;

// ═══════════════════════════════════════════════════════════════════════════
// NEO-645 — One-card Tidy Up: ONE derivation, two levels
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pink ("fix") blocks Save and the card cannot be listed until it is answered.
 * Blue ("check") is a stop for review, never something that hits nearly every
 * card. A card with neither drops out of the walk.
 */
export type AttentionLevel = "fix" | "check" | "none";

/**
 * One thing the Tidy Up walk asks of a card, from the row alone (D3).
 *
 * Blue items carry no key (NEO-656): nothing is stored about having seen one.
 *
 * Nothing here carries a message string (see `AttentionItem`): the wording
 * lives with the tiles. The numeric and name payloads exist so a tile can
 * state the measurement without re-measuring the row.
 *
 * Notes ("Left out to fit", "Numbers didn't match") are deliberately NOT items: they only ever show on a
 * card that is already a stop, and are worked out for the open card only.
 */
export type TidyAttentionItem =
  // ── pink ──
  // A `sourceDisagreements` entry (an entry carrying the legacy `chosen` is settled).
  | { level: "fix"; kind: "sourcesDisagree"; field: "players" | "teams" }
  // `pendingPlayerNames` is not empty. A same-name pair is a pending name, so it is
  // covered. A multi-player card with
  // one name linked is still pink while another is pending.
  | { level: "fix"; kind: "playerName"; names: string[] }
  // NEO-645 (Jason, 2026-11-23): no player and no name. A card always has one.
  | { level: "fix"; kind: "needsName" }
  // `pendingTeamNames` is not empty (flips NEO-208's "pending counts as answered").
  | { level: "fix"; kind: "teamName"; names: string[] }
  // No team, no pending team name, no No-team stamp, not awaiting the team
  // lookup, and no unsettled teams disagreement.
  | { level: "fix"; kind: "noTeam" }
  // The AU token with no autograph format on the card.
  | { level: "fix"; kind: "autograph" }
  // The stored title is over eBay's cap (`titleAttentionItems`).
  | { level: "fix"; kind: "titleOverLimit"; length: number }
  // ── blue ── (NEO-656: nothing is remembered as "seen"; a blue item shows
  // for as long as the data holds it)
  // J2: no stint covers the card's team by the card's year (read live, `LiveAttention`).
  | { level: "check"; kind: "careerGap"; playerId: string; teamId: string }
  // The generated title's core was cut to fit ("Left out where today's wizard asks").
  | { level: "check"; kind: "titleCut" }
  // The variation is over the item-specific value cap.
  | { level: "check"; kind: "variationOverLimit"; length: number };

export type TidyAttentionKind = TidyAttentionItem["kind"];

/** What `deriveCardAttention` answers. `level` is "none" exactly when `items` is empty. */
export type CardAttention = { level: AttentionLevel; items: TidyAttentionItem[] };

/**
 * NEO-645 — everything this card has to say. Order is the tiles' order:
 * sources (2), players (3), name (3b), career (4), team (5), autograph (6),
 * title (7).
 *
 * NEO-656 — the career gap is read LIVE (`live.careerGaps`), never from the row.
 */
function allTidyItems(row: AttentionCardRow, live?: LiveAttention): TidyAttentionItem[] {
  const items: TidyAttentionItem[] = [];
  const disagreements = row.sourceDisagreements ?? [];
  const playerIds = row.playerIds ?? [];
  const teamIds = row.teamOnCardIds ?? [];

  // 2 — Sources disagree.
  for (const d of disagreements) {
    if (isOpenDisagreement(d)) {
      items.push({ level: "fix", kind: "sourcesDisagree", field: d.field });
    }
  }

  // 3 — Player. A pending name is a pink row whatever else the card links: it
  // is the NAME that has no answer.
  const pendingPlayers = (row.pendingPlayerNames ?? []).filter((n) => n.trim().length > 0);
  if (pendingPlayers.length > 0) {
    items.push({ level: "fix", kind: "playerName", names: [...pendingPlayers] });
  }

  // 3b — Name (Jason, 2026-11-23: "there should always be a name associated
  // with the card"). A card with nobody on it, and nobody waiting to be, names
  // itself: "Team Card", "Checklist", whatever it is. NB's own placeholder
  // ("Card #3") is no name. Never keyed on a marketplace's wording.
  if (
    playerIds.length === 0 &&
    pendingPlayers.length === 0 &&
    typeof row.cardName === "string" &&
    !hasCardName(row.cardName)
  ) {
    items.push({ level: "fix", kind: "needsName" });
  }

  // 4 — Career (NEO-656: read live). Single-player cards only, the same as
  // `deriveCareerPairs`: nobody can say which of several players a team
  // belongs to. The entity must still be on the card.
  if (playerIds.length === 1) {
    for (const c of live?.careerGaps ?? []) {
      if (c.playerId === playerIds[0] && teamIds.includes(c.teamId)) {
        items.push({
          level: "check",
          kind: "careerGap",
          playerId: c.playerId,
          teamId: c.teamId,
        });
      }
    }
  }

  // 5 — Team.
  const pendingTeams = (row.pendingTeamNames ?? []).filter((n) => n.trim().length > 0);
  if (pendingTeams.length > 0) {
    items.push({ level: "fix", kind: "teamName", names: [...pendingTeams] });
  }
  const unsettledTeams = disagreements.some(
    (d) => d.field === "teams" && isOpenDisagreement(d),
  );
  if (
    teamIds.length === 0 &&
    pendingTeams.length === 0 &&
    !row.teamNoneConfirmedAt &&
    !isAwaitingTeamLookup(row) &&
    !unsettledTeams
  ) {
    items.push({ level: "fix", kind: "noTeam" });
  }

  // 6 — Autograph. The format is NB's own vocabulary; "None" and absent both
  // mean it has not been answered.
  if (
    carriesAutographToken(row.attributes) &&
    !(AUTOGRAPH_FORMATS as readonly string[]).includes(row.features?.autographed ?? "")
  ) {
    items.push({ level: "fix", kind: "autograph" });
  }

  // 7 — Title. The over-limit title blocks; a cut title and a long variation
  // are stops to check.
  for (const t of titleAttentionItems(row)) {
    if (t.kind === "titleOverLimit") {
      items.push({ level: "fix", kind: "titleOverLimit", length: t.length });
    } else if (t.kind === "titleTruncated") {
      items.push({ level: "check", kind: "titleCut" });
    } else {
      items.push({ level: "check", kind: "variationOverLimit", length: t.length });
    }
  }
  return items;
}

/**
 * NEO-661 (Jason, 2026-11-24: "if there is anything that would cause a pink box
 * we should hold the parallels back.") — does this card keep its parallels from
 * being built? The parallels COPY the card, so any card that shows pink holds
 * the build: exactly `deriveCardAttention(row).level === "fix"`, whatever the
 * pink item is. (NEO-645 J3 had held only unanswered names.) A card still
 * awaiting its BSC team lookup is not pink, so it does not hold; that is
 * `deriveCardAttention`'s own behaviour, unchanged. One pure rule, read by the
 * server's refusal (`parallelChecklistBuild`) and the client's held auto-start
 * (`CardChecklist`), so the two can never disagree.
 */
export function blocksParallelBuild(row: AttentionCardRow): boolean {
  return deriveCardAttention(row).level === "fix";
}

/**
 * NEO-645 — what this card still needs from a human. The badge, the pill count
 * and the walk membership all call this, so they cannot disagree (count = walk
 * = pill).
 *
 * NEO-656 (Jason: "it should read real data and display pink/blue as
 * appropriate depending on the current state of the data"): nothing is
 * remembered. A blue item shows for as long as the data holds it, and is never
 * suppressed. `level` is "fix" when any pink item is left, else "check" when
 * any blue one is, else "none".
 *
 * The one blue fact that needs other tables, the career gap, comes in as
 * `live.careerGaps` (`careerCoverage.careerGaps`); with no `live` the card
 * raises none, so this stays a pure function of the row.
 */
export function deriveCardAttention(row: AttentionCardRow, live?: LiveAttention): CardAttention {
  const items = allTidyItems(row, live);
  const level: AttentionLevel = items.some((i) => i.level === "fix")
    ? "fix"
    : items.length > 0
      ? "check"
      : "none";
  return { level, items };
}
