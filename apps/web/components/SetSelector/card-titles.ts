import type { Id } from "../../convex/_generated/dataModel";
import { normalizeEntityName } from "../../convex/lib/entityNearMatch";
import { listingNamesAPlayer } from "../../convex/lib/cardPlayerDefaults";
import { teamFullName } from "../../lib/teams/team-name";
// Browser-safe: pure feature derivations only, the same ones the insert runs.
import {
  assessNewCardListing,
  checkShortNameAnswer,
  leftOutOfTitle,
  LISTING_TITLE_KEPT_MAX,
  setDescriptionForTitles,
  type TitleAttentionItem,
  type TitleContext,
} from "../../convex/features/listingInputs";
import type { ListingCardInputs } from "../../convex/features/generateListing";
import {
  ASPECT_VALUE_MAX,
  LISTING_TITLE_MAX,
} from "../../convex/features/listingLimits";
import { MAX_CARD_PLAYERS, MAX_CARD_TEAMS } from "../../convex/features/cardAttention";
import type { TeamAnswer } from "./teams-on-cards";

/**
 * NEO-335 — the wizard's "Card titles" step: which NEW cards will be born with
 * a title the attention walker would flag, what each title will say, and what
 * the operator answered.
 *
 * Pure: no Convex, no hooks. `CardTitlesStep` draws what this decides.
 *
 * ## Same rules as after save, by construction
 *
 * A card is on the step exactly when the row it is about to become would carry
 * `titleOverLimit` (NEO-535: the builder stopped over the cap rather than cut
 * description words), `titleTruncated` (it lost a first name, or its title
 * came from the set's box text) or `aspectValueOverLimit`: `assessNewCardListing`
 * (convex/features/listingInputs.ts) runs the insert's own feature merge and
 * title generator, and `titleAttentionItems` is the function
 * `deriveCardAttention` calls on a stored row. What this module adds is only
 * what the browser knows that the server does not yet: the names the
 * operator decided in the wizard, and their team answers.
 *
 * ## New rows only
 *
 * A card that re-syncs a stored row keeps that row's title (NB content the
 * operator may already have edited), so it is never asked about here.
 *
 * ## Names: a data claim, never a guess
 *
 * A printed name is in the title only when it will be ON the card: it
 * resolved before the wizard (`titleContext`), or the operator created or
 * linked it in the wizard. A name that did neither — skipped, or ruled out on
 * an earlier sync — is not on the card and not in its title. The printed
 * spelling is never used as a stand-in for a canonical name it did not
 * resolve to.
 */

/** The preview-card fields this module reads (a structural subset of `FetchPreview`'s cards). */
export interface PreviewCardForTitles {
  cardNumber: string;
  cardName: string;
  team?: string;
  teams?: string[];
  players?: string[];
  attributes?: string[];
  isRookie?: boolean;
  isRelic?: boolean;
  printRun?: number;
  autographType?: string;
  cardVariation?: string;
}

/**
 * The operator's own edits on the step, positionally aligned with the preview
 * cards (undefined = untouched). RAW drafts, as typed: what reaches the commit
 * is decided by `titleAnswersForCommit`, which is where a blank or over-long
 * draft stops counting.
 */
export type TitleAnswer = {
  /** Their own title. */
  listingTitle?: string;
  /** Their trimmed variation, shared by every card printing the same one. */
  cardVariation?: string;
};

/** What one card's answer puts on its preview card for `commitCardChecklist`. */
export type TitleCommitFields = {
  listingTitle?: string;
  /**
   * The generated title the step showed and the operator kept. The server
   * regenerates the title and skips the cut-short flag only when it comes
   * out as exactly this text.
   */
  listingTitleKept?: string;
  cardVariation?: string;
  cardVariationAnswered?: true;
};

/** The subset of an `entityReviewQueue.getBatch` row this module reads. */
export interface TitleReviewRow {
  kind: "player" | "team" | "league";
  name: string;
  enrichment?: {
    existingCandidates?: Array<{ playerId: string; name: string }>;
  } | null;
  decision?:
    | { action: "create"; create?: { location?: string; name: string } }
    | { action: "link"; linkedPlayerId?: string; linkedTeamId?: string }
    | { action: "skip" }
    | null;
}

/** Where the names the operator decided in the wizard come from. All optional. */
export interface TitleNameSources {
  /** The review batch, every row decided. Absent = no wizard names (teams/titles only). */
  rows?: readonly TitleReviewRow[];
  /** Linked team id → full name, for a team the operator linked in the Names phase. */
  linkedTeamNameById?: ReadonlyMap<string, string>;
  /** Team id → full name, for the ids in a card's team answer (`teamIdNamesFromGroups`). */
  teamNameById?: ReadonlyMap<string, string>;
}

const norm = (raw: string): string => normalizeEntityName(raw.trim());

interface NameIndex {
  player: (printed: string) => string | null;
  team: (printed: string) => string | null;
  teamById: (id: string) => string | null;
}

function nameIndex(context: TitleContext, sources: TitleNameSources | undefined): NameIndex {
  const ctxPlayers = new Map(context.players.map((p) => [p.printed, p.name]));
  const ctxTeams = new Map(context.teams.map((t) => [t.printed, t.name]));
  const playerRows = new Map<string, TitleReviewRow>();
  const teamRows = new Map<string, TitleReviewRow>();
  for (const row of sources?.rows ?? []) {
    const key = norm(row.name);
    if (!key) continue;
    const target = row.kind === "player" ? playerRows : row.kind === "team" ? teamRows : null;
    if (target && !target.has(key)) target.set(key, row);
  }
  return {
    player(raw) {
      const printed = raw.trim();
      if (!printed) return null;
      const row = playerRows.get(norm(printed));
      if (row) {
        const d = row.decision;
        if (d?.action === "create") return row.name.trim();
        if (d?.action === "link") {
          const candidate = row.enrichment?.existingCandidates?.find(
            (c) => c.playerId === d.linkedPlayerId,
          );
          return candidate?.name ?? ctxPlayers.get(printed) ?? row.name.trim();
        }
        return null; // skipped or undecided: not on the card
      }
      return ctxPlayers.get(printed) ?? null;
    },
    team(raw) {
      const printed = raw.trim();
      if (!printed) return null;
      const row = teamRows.get(norm(printed));
      if (row) {
        const d = row.decision;
        if (d?.action === "create") return d.create ? teamFullName(d.create) : null;
        if (d?.action === "link") {
          return (
            (d.linkedTeamId && sources?.linkedTeamNameById?.get(d.linkedTeamId)) ||
            ctxTeams.get(printed) ||
            row.name.trim()
          );
        }
        return null;
      }
      return ctxTeams.get(printed) ?? null;
    },
    teamById(id) {
      return sources?.teamNameById?.get(id) ?? null;
    },
  };
}

function printedTeams(card: PreviewCardForTitles): string[] {
  const named = (card.teams ?? []).map((t) => t.trim()).filter(Boolean);
  if (named.length === 0 && card.team?.trim()) named.push(card.team.trim());
  return named;
}

/**
 * The canonical names the card will carry, in the order the commit writes
 * them: the team answer's picks first, then its (or the card's printed) team
 * strings, capped; with no team at all, the set-level team (NEO-277).
 */
function cardNames(
  card: PreviewCardForTitles,
  teamAnswer: TeamAnswer | undefined,
  index: NameIndex,
  context: TitleContext,
): { playerNames: string[]; teamNames: string[]; cameoNames: string[] } {
  let playerNames: string[] = [];
  for (const p of card.players ?? []) {
    const name = index.player(p);
    if (name) playerNames.push(name);
  }
  // NEO-528 — a new card whose listing names nobody is born with the row's
  // "Player on every card", and its title names them, as the commit's will.
  // A card that prints any name (even one ruled "not a person", or still
  // waiting for review) is left blank by the commit, so its title names
  // nobody (`listingNamesAPlayer`, the commit's own test; Jason, 2026-11-15).
  // The name is the server's, never written onto the card here.
  if (playerNames.length === 0 && !listingNamesAPlayer(card.players)) {
    playerNames = [...(context.setPlayerNames ?? [])];
  }
  const fromIds = (teamAnswer?.teamIds ?? [])
    .map((id) => index.teamById(id))
    .filter((n): n is string => !!n);
  const strings = teamAnswer?.teams?.length ? teamAnswer.teams : printedTeams(card);
  const fromStrings = strings.map((t) => index.team(t)).filter((n): n is string => !!n);
  let teamNames = [...fromIds, ...fromStrings];
  if (fromIds.length > 0 || teamAnswer?.teams?.length) {
    teamNames = Array.from(new Set(teamNames)).slice(0, MAX_CARD_TEAMS);
  }
  if (teamNames.length === 0) teamNames = [...context.setTeamNames];
  // NEO-528 + NEO-535 — the row's default cameos go on every new card, never
  // as one of its own players (the commit's `planDefaultCameos`), so its
  // title names them while it has room, as the insert's will.
  const own = new Set(playerNames.map((n) => normalizeEntityName(n)));
  const cameoNames = (context.setCameoNames ?? [])
    .filter((n) => !own.has(normalizeEntityName(n)))
    .slice(0, MAX_CARD_PLAYERS);
  return { playerNames, teamNames, cameoNames };
}

/** The variation the card will be saved with: a valid trimmed answer, else its own. */
export function effectiveVariation(
  card: PreviewCardForTitles,
  answer: TitleAnswer | undefined,
): string | undefined {
  const valid = validVariationAnswer(card, answer);
  return valid ?? card.cardVariation;
}

/** A variation answer that counts: changed, not blank, within the aspect cap. */
function validVariationAnswer(
  card: PreviewCardForTitles,
  answer: TitleAnswer | undefined,
): string | undefined {
  const draft = answer?.cardVariation?.trim();
  if (!draft || draft.length > ASPECT_VALUE_MAX) return undefined;
  if (draft === card.cardVariation?.trim()) return undefined;
  return draft;
}

/** One card, assessed the way the insert will assess it. */
export interface CardTitleAssessment {
  index: number;
  cardNumber: string;
  cardName: string;
  /**
   * The generated title, built with the box draft when there is one — what
   * "keep it" keeps. Over the cap when the builder stopped (NEO-535: it never
   * cuts description words to force a fit).
   */
  title: string;
  /** `title` is at most `LISTING_TITLE_MAX`. */
  fits: boolean;
  /**
   * The generator's inputs for this card as shown (the box draft and the
   * variation answer applied). "Left out to fit" is read from these against
   * whatever text the card's field holds now (`leftOutOfTitle`).
   */
  inputs: ListingCardInputs;
  /**
   * The words this card's own players, teams and number are made of. What a
   * card leaves out of these is its own business, never what its group shares
   * (`groupKey`).
   */
  ownWords: ReadonlySet<string>;
  /**
   * The variation when it is over the aspect cap. It has its own field on the
   * step, so "Left out to fit" never repeats it.
   */
  overCapVariation?: string;
  /**
   * Which group the card sits in. Read from the GENERATED title without any
   * of the operator's drafts (box text, variation or title), so the groups
   * never reshuffle under the operator's typing.
   */
  groupKey: string;
  /** The kinds the row would be born with, read with the card's ORIGINAL variation. */
  items: TitleAttentionItem[];
}

/** Options shared by every entry point. */
export interface TitleReviewOptions {
  names?: TitleNameSources;
  /** Preview positions that re-sync a stored row — never asked about. */
  existingIndexes?: Iterable<number>;
  /** The operator's edits; only a variation answer changes what is generated. */
  answers?: ReadonlyArray<TitleAnswer | undefined>;
  /**
   * NEO-535 — the "Set name in titles" box draft, ALREADY CHECKED
   * (`validShortName`) and only when the operator edited the box. Passed to
   * the builder as-is, as the leaf's whole description; the builder decides
   * which cards it rewrites (those over the cap or short a first name), so
   * the titles shown and the titles kept are the ones the server will
   * generate with it. It never changes which cards are on the step.
   */
  listingShortName?: string;
}

/**
 * NEO-535 — a title (or the "Set name in titles" box) is one line. Its field
 * wraps so the whole text stays in view, but a newline (a paste, say) is
 * never part of the value: each run of line breaks reads as one space.
 */
export function oneLine(raw: string): string {
  return raw.replace(/\s*[\r\n]+\s*/g, " ");
}

/**
 * NEO-335 — the short-name draft that counts: trimmed, within the rule both
 * write paths apply. A draft the server would refuse counts as none, so the
 * titles shown and the titles kept never assume a name that will not land.
 */
export function validShortName(draft: string | undefined): string | undefined {
  return checkShortNameAnswer(draft).value;
}

/**
 * NEO-535 — the "Set name in titles" box's starting text: the set's stored
 * box text (already carrying its insert and parallel names when it sits above
 * them), else the builder's own full description for this set's cards.
 */
export function setNameInTitlesPrefill(titleContext: TitleContext): string {
  return titleContext.listingShortName?.trim() || setDescriptionForTitles(titleContext);
}

/**
 * NEO-535 — does the step show the "Set name in titles" box? Whenever it lists
 * titles. Read WITHOUT any draft, so the box never vanishes under the
 * operator's typing.
 */
export function shortNameFieldApplies(
  cards: readonly PreviewCardForTitles[],
  titleContext: TitleContext,
  teamAnswers?: ReadonlyArray<TeamAnswer | undefined>,
  options?: Omit<TitleReviewOptions, "answers" | "listingShortName">,
): boolean {
  return assessAll(cards, titleContext, teamAnswers, options).some(isTitleCard);
}

/** On the step for its title: over the cap, or short a first name / on the box. */
export function isTitleCard(a: Pick<CardTitleAssessment, "items">): boolean {
  return a.items.some((i) => i.kind === "titleOverLimit" || i.kind === "titleTruncated");
}

function assessAll(
  cards: readonly PreviewCardForTitles[],
  titleContext: TitleContext,
  teamAnswers: ReadonlyArray<TeamAnswer | undefined> | undefined,
  options: TitleReviewOptions | undefined,
): CardTitleAssessment[] {
  // NEO-535 — the box draft stands in for the set's own box text.
  const drafted = options?.listingShortName
    ? { ...titleContext, listingShortName: options.listingShortName }
    : titleContext;
  const index = nameIndex(titleContext, options?.names);
  const existing = new Set(options?.existingIndexes ?? []);
  const out: CardTitleAssessment[] = [];
  cards.forEach((card, i) => {
    if (existing.has(i)) return;
    const names = cardNames(card, teamAnswers?.[i], index, titleContext);
    const facts = {
      cardNumber: card.cardNumber,
      isRookie: card.isRookie,
      isRelic: card.isRelic,
      autographType: card.autographType,
      attributes: card.attributes,
      printRun: card.printRun,
    };
    // Membership is read with the card's OWN variation and without the box
    // draft, so nothing the operator types on the step takes a card off it.
    const own = assessNewCardListing({ ...facts, cardVariation: card.cardVariation }, titleContext, names);
    if (own.items.length === 0) return;
    const variation = effectiveVariation(card, options?.answers?.[i]);
    const shown =
      variation === card.cardVariation && drafted === titleContext
        ? own
        : assessNewCardListing({ ...facts, cardVariation: variation }, drafted, names);
    // A variation over the aspect cap has its own field on the step; the
    // title notes do not repeat it as a loss as well.
    const overCapVariation = own.items.some((it) => it.kind === "aspectValueOverLimit")
      ? card.cardVariation?.trim()
      : undefined;
    const ownWords = ownWordsOf(names, card.cardNumber);
    out.push({
      index: i,
      cardNumber: card.cardNumber,
      cardName: card.cardName,
      title: shown.assessment.title,
      fits: shown.assessment.fits,
      inputs: shown.inputs,
      ownWords,
      ...(overCapVariation ? { overCapVariation } : {}),
      groupKey: titleGroupKey(own.inputs, own.assessment.title, ownWords, overCapVariation),
      items: own.items,
    });
  });
  return out;
}

/** `entries` without an over-cap variation (it has its own field). */
function withoutVariation(entries: string[], variation: string | undefined): string[] {
  return variation ? entries.filter((e) => e !== variation) : entries;
}

/** Every word of `entry` is one of the card's own player/team/number words. */
function isOwnEntry(entry: string, ownWords: ReadonlySet<string>): boolean {
  const words = entry.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => ownWords.has(w));
}

/**
 * NEO-535 — "Left out to fit" for one card, from the text its field holds NOW
 * (the operator's own words included): retyping a cut word takes it off the
 * note. Never from the generator's own assessment.
 */
export function leftOutOfCardTitle(card: CardTitleAssessment, text: string): string[] {
  return withoutVariation(leftOutOfTitle(card.inputs, text.trim()), card.overCapVariation);
}

/**
 * The preview positions the "Card titles" step asks about, ascending: NEW
 * cards whose row would be born flagged `titleOverLimit`, `titleTruncated` or
 * `aspectValueOverLimit`. Empty → no step. Recomputed from the team answers
 * (the team is part of the title); never from the step's own answers — nor
 * its box draft, so the list holds still while the operator is on it.
 */
export function cardsNeedingTitleReview(
  cards: readonly PreviewCardForTitles[],
  titleContext: TitleContext,
  teamAnswers?: ReadonlyArray<TeamAnswer | undefined>,
  options?: Omit<TitleReviewOptions, "answers" | "listingShortName">,
): number[] {
  return assessAll(cards, titleContext, teamAnswers, options).map((a) => a.index);
}

/** Cards that print the same over-long variation share one field. */
export interface VariationGroup {
  key: string;
  /** The variation as printed (trimmed). */
  variation: string;
  cards: Array<{ index: number; cardNumber: string; cardName: string }>;
}

/** One title row: the card, and what its field's text leaves out beyond its group's line. */
export interface TitleRowView extends CardTitleAssessment {
  /** The text in the card's field now: the operator's draft, else `title`. */
  text: string;
  /** "Left out to fit" under this row: what it lacks that its group line does not say. */
  leftOut: string[];
}

/**
 * Cards whose generated titles left out the same words share one line. "The
 * same" is read without each card's own players, teams and number, and from
 * the generated titles before any draft (`groupKey`), so a group never
 * reshuffles while the operator types.
 */
export interface TitleGroup {
  key: string;
  /**
   * What every card on the line is missing NOW, read from each field's
   * current text. Empty for a one-card group: that card's row says it all.
   */
  leftOut: string[];
  cards: TitleRowView[];
}

/** The step's two lists, each in the order of its first card. */
export function buildTitleGroups(
  cards: readonly PreviewCardForTitles[],
  titleContext: TitleContext,
  teamAnswers?: ReadonlyArray<TeamAnswer | undefined>,
  options?: TitleReviewOptions,
): { variationGroups: VariationGroup[]; titleGroups: TitleGroup[] } {
  const variationGroups = new Map<string, VariationGroup>();
  const assessments = assessAll(cards, titleContext, teamAnswers, options);
  for (const a of assessments) {
    if (a.items.some((i) => i.kind === "aspectValueOverLimit")) {
      const variation = (cards[a.index].cardVariation ?? "").trim();
      const group = variationGroups.get(variation) ?? {
        key: `variation:${variation}`,
        variation,
        cards: [],
      };
      group.cards.push({ index: a.index, cardNumber: a.cardNumber, cardName: a.cardName });
      variationGroups.set(variation, group);
    }
  }
  return {
    variationGroups: [...variationGroups.values()],
    titleGroups: groupTitleAssessments(assessments, options?.answers),
  };
}

/**
 * NEO-535 — the grouping half of `buildTitleGroups`, over any assessed cards:
 * the wizard's preview cards, or a parallel's stored cards in the Card titles
 * dialog (`parallel-titles.ts`). Only the cards on the step for their TITLE
 * are grouped; each row's text is the operator's draft, else the title.
 */
export function groupTitleAssessments(
  assessments: readonly CardTitleAssessment[],
  answers?: ReadonlyArray<TitleAnswer | undefined>,
): TitleGroup[] {
  const byKey = new Map<string, Array<{ card: CardTitleAssessment; text: string; missing: string[] }>>();
  for (const a of assessments) {
    if (!isTitleCard(a)) continue;
    const draft = answers?.[a.index]?.listingTitle;
    const text = draft !== undefined && draft.trim() ? draft : a.title;
    const list = byKey.get(a.groupKey) ?? [];
    list.push({ card: a, text, missing: leftOutOfCardTitle(a, text) });
    byKey.set(a.groupKey, list);
  }
  const titleGroups: TitleGroup[] = [];
  for (const [key, members] of byKey) {
    // What every card is missing, in the first card's order.
    const shared =
      members.length > 1
        ? members[0].missing.filter((entry) => members.every((m) => m.missing.includes(entry)))
        : [];
    titleGroups.push({
      key,
      leftOut: shared,
      cards: members.map(({ card, text, missing }) => ({
        ...card,
        text,
        leftOut: missing.filter((entry) => !shared.includes(entry)),
      })),
    });
  }
  return titleGroups;
}

/**
 * The words a card's own players, teams and number are made of
 * (`CardTitleAssessment.ownWords`).
 */
export function ownWordsOf(
  names: {
    playerNames: readonly string[];
    teamNames: readonly string[];
    cameoNames?: readonly string[];
  },
  cardNumber: string,
): Set<string> {
  return new Set(
    [
      ...names.playerNames,
      ...(names.cameoNames ?? []),
      ...names.teamNames,
      cardNumber,
      `#${cardNumber}`,
    ].flatMap((n) =>
      n.toLowerCase().split(/\s+/).filter(Boolean),
    ),
  );
}

/**
 * The group a card sits in, read from the title it was given (never a
 * draft): what that title leaves out beyond the card's own names and number.
 */
export function titleGroupKey(
  inputs: ListingCardInputs,
  title: string,
  ownWords: ReadonlySet<string>,
  overCapVariation?: string,
): string {
  const baseline = withoutVariation(leftOutOfTitle(inputs, title), overCapVariation);
  return `left:${baseline.filter((e) => !isOwnEntry(e, ownWords)).join("\u0000")}`;
}

/** Where an operator's title draft stands against the generated title. */
export type TitleDraftState =
  | { kind: "kept" }
  | { kind: "own"; title: string }
  | { kind: "over"; length: number };

export function titleDraftState(draft: string | undefined, generated: string): TitleDraftState {
  const value = draft?.trim();
  if (!value || value === generated) return { kind: "kept" };
  if (value.length > LISTING_TITLE_MAX) return { kind: "over", length: value.length };
  return { kind: "own", title: value };
}

/**
 * What each card sends to the commit, positionally aligned with `cards`
 * (undefined = nothing; the card commits exactly as it did before the step).
 *
 *  - A card on the step for its TITLE (over the cap, or short a first name)
 *    sends its own title when the operator wrote one that fits, else
 *    `listingTitleKept` carrying the title the step showed (built with the
 *    box draft, when there is one) — keeping is the answer, and the walker
 *    does not ask about the first name again after save as long as the
 *    server generates that same title. A kept title over the cap is still
 *    flagged by its length after save. A draft over the cap sends neither:
 *    the server titles the card itself and flags it, and the walker picks it
 *    up (the step never blocks a save).
 *  - A card on the step for its VARIATION sends the trimmed variation when it
 *    fits the aspect cap; otherwise nothing, and the warn-only item stays.
 */
export function titleAnswersForCommit(
  cards: readonly PreviewCardForTitles[],
  titleContext: TitleContext,
  teamAnswers?: ReadonlyArray<TeamAnswer | undefined>,
  options?: TitleReviewOptions,
): Array<TitleCommitFields | undefined> {
  const out: Array<TitleCommitFields | undefined> = new Array(cards.length).fill(undefined);
  for (const a of assessAll(cards, titleContext, teamAnswers, options)) {
    const answer = options?.answers?.[a.index];
    const fields: TitleCommitFields = {};
    if (isTitleCard(a)) {
      const state = titleDraftState(answer?.listingTitle, a.title);
      if (state.kind === "own") fields.listingTitle = state.title;
      else if (state.kind === "kept" && a.title.length <= LISTING_TITLE_KEPT_MAX) {
        fields.listingTitleKept = a.title;
      }
    }
    if (a.items.some((i) => i.kind === "aspectValueOverLimit")) {
      const variation = validVariationAnswer(cards[a.index], answer);
      if (variation) {
        fields.cardVariation = variation;
        fields.cardVariationAnswered = true;
      }
    }
    if (Object.keys(fields).length > 0) out[a.index] = fields;
  }
  return out;
}

/**
 * A preview card with its title answer put on it, as the commit receives it.
 * No answer → the same object, so the unanswered wire payload is unchanged.
 * `cardVariation` REPLACES the printed one; `cardVariationAnswered` tells the
 * commit it is the operator's and holds it to the aspect cap.
 */
export function withTitleAnswer<T extends PreviewCardForTitles>(
  card: T,
  fields: TitleCommitFields | undefined,
): T & TitleCommitFields {
  if (!fields) return card;
  return { ...card, ...fields };
}

/**
 * Team id → name for every team a Teams-step line offers, so a card's team
 * answer (ids) can be titled. Pass the step's groups' option refs.
 */
export function teamIdNamesFromRefs(
  refs: Iterable<{ teamId?: Id<"teams"> | string; label: string }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const ref of refs) if (ref.teamId && !out.has(ref.teamId)) out.set(ref.teamId, ref.label);
  return out;
}

/**
 * NEO-535 — where a `CardTitlesStep` gets its cards. The wizard's step reads
 * the preview cards it is given (its default); the parallel Card titles
 * dialog hands it a parallel's stored cards (`parallel-titles.ts`). Keep the
 * object stable across renders (memoise it): the step recomputes its groups
 * whenever it changes.
 */
export interface CardTitlesSource {
  /** Positions the step's answers are aligned with. */
  count: number;
  /** What the "Set name in titles" box opens with. */
  prefill: string;
  /** The step's two lists for these drafts and this checked box draft. */
  groups(options: {
    answers: ReadonlyArray<TitleAnswer | undefined>;
    listingShortName?: string;
  }): { variationGroups: VariationGroup[]; titleGroups: TitleGroup[] };
  /** Cards beyond the ones listed, and the line that says so. */
  more?: { count: number; line: string };
  /**
   * Names the step's controls apart from another step's on the same screen
   * (one per parallel in the dialog): "Title for Gold Refractor #12 …".
   */
  scope?: string;
}
