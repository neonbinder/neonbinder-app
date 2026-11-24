import { useId, useMemo, useRef, useState } from "react";
import { QuestionMarkCircleIcon } from "@heroicons/react/16/solid";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { formatCareerLine } from "../../../../lib/players/player-description";
import NeonButton from "../../../modules/NeonButton";
import { NearMatchPanel, type NearMatch } from "../../../entities/NearMatchPanel";
import EntityLinkSearch from "../../EntityLinkSearch";
import SportSwitch from "../../SportSwitch";
import SameNamePlayerPanel, { type SameNameCandidate } from "../../SameNamePlayerPanel";
import NameFragmentPanel, {
  ONE_NAME_PLAYER_LABEL,
  type NameFragmentMatch,
} from "../../NameFragmentPanel";
import { PLAYER_AMBIGUITY_SCAN_LIMIT } from "../../../../lib/players/name-limits";
import type { TidyCardContext, TidyRow } from "../tile-types";
import { WRAP_LABEL_CLASS } from "../TidyTile";
import { useAnswered } from "../answered";
import { useInlinePart } from "../inline-stack";
import { useNameLookup, useWalkMemory } from "../walk-memory";
import EditLine from "./EditLine";
import { preselectReasonLine, stintYears } from "./copy";
import NameApplyToAll from "./NameApplyToAll";
import { printedOnOf, printedOnText } from "./printed-on";
import type { TidyWrite } from "./tidy-write";
import { useSportValue } from "./use-sport-value";
import WikidataBlock from "./WikidataBlock";

type Ctx = NonNullable<TidyCardContext>;
export type ContextName = Ctx["names"][number];
export type ContextPlayer = Ctx["players"][number];

const NO_FRAGMENT_MATCHES: NameFragmentMatch[] = [];

/** "Jackson Merrill · b. 2003 · Padres 2024–": who a linked name is. */
export function PlayerSummary({
  player,
  fallbackName,
}: {
  player: ContextPlayer | undefined;
  fallbackName: string;
}) {
  if (!player) return <span className="font-medium text-ink">{fallbackName}</span>;
  const latest = player.stints[player.stints.length - 1];
  const facts = [
    player.birthYear ? `b. ${player.birthYear}` : null,
    latest ? `${latest.teamName} ${stintYears(latest)}`.trim() : null,
  ].filter(Boolean);
  return (
    <span className="wrap-anywhere">
      <span className="font-medium text-ink">{player.name}</span>
      {player.nameOnCard && (
        <span className="text-ink-3">{` (printed “${player.nameOnCard}”)`}</span>
      )}
      {facts.length > 0 && <span className="text-xs text-ink-3">{` · ${facts.join(" · ")}`}</span>}
    </span>
  );
}

/** Answering a name needs the sport it is asked in; with none there is nothing to send. */
function needSport(sportId: Id<"selectorOptions"> | undefined): Id<"selectorOptions"> {
  if (!sportId) throw new Error("Pick a sport.");
  return sportId;
}

/**
 * One printed player name on the open card, in whatever state it is in:
 *
 *  - waiting (pink): the question, with every way to answer it inline;
 *  - linked: the player with Edit at the end of its line, and "Apply to all"
 *    while other cards of this checklist still wait on the name.
 *
 * "Not a player" has its own row (`RuledOutPlayerRow`): the name is off the card
 * then, so the walk's memory holds it while the card is open.
 *
 * Every answer is `tidyNames.answerName` / `createPlayer`, and each links THIS
 * card only (NEO-656). The card names its own state: a name is linked when it
 * is a `playerLinks.nameOnCard`, waiting when it is in `pendingPlayerNames`.
 */
export default function PlayerNameRow({
  row,
  name,
  linked,
  setSportId,
  multi,
  lead = true,
  write,
  leafCards,
}: {
  row: TidyRow;
  name: ContextName;
  linked: ContextPlayer | undefined;
  setSportId: Id<"selectorOptions"> | undefined;
  /** More than one name on the card: controls carry the name so no two read alike. */
  multi: boolean;
  /**
   * This row may carry the tile's one filled button. A tile has at most one
   * (the first unanswered row's best answer); every other row's answers are
   * outlines, so a card with three names does not shout three times.
   */
  lead?: boolean;
  write: TidyWrite;
  /** The checklist's cards: "Printed on", and who "Apply to all" would reach. */
  leafCards: readonly TidyRow[];
}) {
  const answerName = useMutation(api.tidyNames.answerName);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // When the answer lands the question unmounts under the operator's focus. The
  // walk moves it on (`useAnswered`): never to this row's Edit, where one more
  // Enter would undo the answer.

  if (!name.pending) {
    const clear = () =>
      write.run(
        () =>
          answerName({
            cardId: row._id,
            kind: "player",
            name: name.printed,
            sportId: needSport(linked?.sportId ?? setSportId),
            answer: { kind: "clear" },
          }),
        "Couldn't change that answer. Try again.",
      );
    return (
      <div ref={wrapRef} role="group" aria-label={`Player ${name.printed}`} className="grid gap-1.5">
        <EditLine
          editLabel={`Edit ${linked?.name ?? name.printed}`}
          busy={write.busy}
          onEdit={() => void clear()}
        >
          <PlayerSummary player={linked} fallbackName={name.printed} />
        </EditLine>
        {name.playerId && (
          <NameApplyToAll
            cardId={row._id}
            kind="player"
            printed={name.printed}
            answer={{ kind: "linkPlayer", playerId: name.playerId }}
            leafCards={leafCards}
          />
        )}
      </div>
    );
  }

  return (
    <UnansweredPlayerName
      row={row}
      name={name}
      setSportId={setSportId}
      multi={multi}
      lead={lead}
      write={write}
      wrapRef={wrapRef}
      leafCards={leafCards}
    />
  );
}

/**
 * A name the operator ruled out ("Not a player") on the card that is open. The
 * name is off the card, so the walk's memory is all that holds it; Edit puts it
 * back to waiting. Gone with the card: once the walk moves on, the card is what
 * it is.
 */
export function RuledOutPlayerRow({
  row,
  printed,
  setSportId,
  write,
  leafCards,
}: {
  row: TidyRow;
  printed: string;
  setSportId: Id<"selectorOptions"> | undefined;
  write: TidyWrite;
  leafCards: readonly TidyRow[];
}) {
  const memory = useWalkMemory();
  const answerName = useMutation(api.tidyNames.answerName);
  const clear = async () => {
    const ok = await write.run(
      () =>
        answerName({
          cardId: row._id,
          kind: "player",
          name: printed,
          sportId: needSport(memory.defaultSportFor("player", printed, setSportId)),
          answer: { kind: "clear" },
        }),
      "Couldn't change that answer. Try again.",
    );
    if (ok) memory.forgetAnswer(row._id, "player", printed);
  };
  return (
    <div role="group" aria-label={`Player ${printed}`} className="grid gap-1.5">
      <EditLine
        editLabel={`Edit ${printed}`}
        busy={write.busy}
        onEdit={() => void clear()}
        textClass="text-sm text-ink-2"
      >
        <span className="font-medium text-ink">{printed}</span> is not a player.
      </EditLine>
      <NameApplyToAll
        cardId={row._id}
        kind="player"
        printed={printed}
        answer={{ kind: "notEntity" }}
        leafCards={leafCards}
      />
    </div>
  );
}

function UnansweredPlayerName({
  row,
  name,
  setSportId,
  multi,
  lead,
  write,
  wrapRef,
  leafCards,
}: {
  row: TidyRow;
  name: ContextName;
  setSportId: Id<"selectorOptions"> | undefined;
  multi: boolean;
  lead: boolean;
  write: TidyWrite;
  wrapRef: React.RefObject<HTMLDivElement | null>;
  leafCards: readonly TidyRow[];
}) {
  const answerName = useMutation(api.tidyNames.answerName);
  const createPlayer = useMutation(api.tidyNames.createPlayer);
  const answered = useAnswered();
  const memory = useWalkMemory();

  /** A write that ANSWERS the name: on success the walk moves focus on. */
  const answer = async (fn: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    const ok = await write.run(fn, fallback);
    if (ok) answered();
    return ok;
  };

  // The Sport chip is local: it is the question's sport for this sitting, never
  // saved. The facts' sport (an auto-linked player's home) leads, else the set's.
  const [chipSportId, setChipSportId] = useState<Id<"selectorOptions"> | undefined>(undefined);
  const rowSportId = chipSportId ?? memory.defaultSportFor("player", name.printed, setSportId);
  const queryName = name.printed;
  const { lookup, retry } = useNameLookup({
    memory,
    cardId: row._id,
    kind: "player",
    name: name.printed,
    sportId: rowSportId,
  });
  const enrichment = lookup?.enrichment;
  const lookupStatus = lookup?.status ?? "pending";
  const lookupFailed = rowSportId !== undefined && lookupStatus === "error";
  const suffix = multi ? ` ${name.printed}` : "";

  const [linkOpen, setLinkOpen] = useState(false);
  const [createAnyway, setCreateAnyway] = useState(false);
  const [addSetSport, setAddSetSport] = useState(false);
  // NEO-212: the Wikidata career teams the operator unticked, by name.
  const [excludedCareer, setExcludedCareer] = useState<ReadonlySet<string>>(new Set());
  const linkButtonRef = useRef<HTMLButtonElement | null>(null);

  // Cancel and Esc hand focus back to "Link to existing…"; a link is an answer
  // and does not (the walk moves on).
  const closeLink = () => {
    setLinkOpen(false);
    requestAnimationFrame(() => linkButtonRef.current?.focus({ preventScroll: true }));
  };
  useInlinePart(linkOpen, closeLink, wrapRef);

  const nearMatches = useQuery(
    api.players.nearMatches,
    rowSportId ? { name: queryName, sportId: rowSportId } : "skip",
  );
  const fragmentCheck = useQuery(
    api.players.nameFragmentCheck,
    rowSportId ? { name: queryName, sportId: rowSportId } : "skip",
  );
  const crossSport = setSportId !== undefined && rowSportId !== undefined && rowSportId !== setSportId;
  const setSportValue = useSportValue(setSportId);

  // NEO-463: a one-word name that is a piece of a fuller one on file.
  const fragmentWithheld = fragmentCheck?.isFragment === true && fragmentCheck.truncated;
  const fragmentMatches: NameFragmentMatch[] =
    fragmentCheck?.isFragment && !fragmentCheck.truncated ? fragmentCheck.matches : NO_FRAGMENT_MATCHES;
  const fragmentStep = fragmentMatches.length > 0 || fragmentWithheld;

  const matches: NearMatch[] | undefined = nearMatches;
  const exactRows = (matches ?? []).filter((m) => m.confidence === "exact");
  const exactSingle = exactRows.length === 1 && !exactRows[0].matchedAlias ? exactRows[0] : null;

  // NEO-254: the players already filed under this exact name. The lookup's own
  // list when it has one, else the live exact rows when there is more than one.
  const storedCandidates: SameNameCandidate[] =
    (enrichment?.existingCandidates?.length ?? 0) >= 2 ? (enrichment?.existingCandidates ?? []) : [];
  const sameNameCandidates: SameNameCandidate[] = useMemo(() => {
    if (storedCandidates.length > 0) return storedCandidates;
    if (exactRows.length > 1) {
      return exactRows.map((m) => ({
        playerId: m._id,
        name: m.name,
        ...(m.birthYear !== undefined ? { birthYear: m.birthYear } : {}),
        ...(m.matchedAlias !== undefined ? { matchedAlias: m.matchedAlias } : {}),
        careerSummary: formatCareerLine(m.career),
      }));
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- both inputs are derived from `enrichment` and `matches`
  }, [enrichment, matches]);
  const scanCapped = storedCandidates.length >= PLAYER_AMBIGUITY_SCAN_LIMIT;
  const pickStep = sameNameCandidates.length > 0 && !createAnyway;

  // NEO-424: a player NB suggests for a name it could not answer. Held until
  // the exact-name evidence has loaded, so it never flips under the operator.
  const preselect = enrichment?.preselect ?? null;
  const preselectOffered = preselect !== null && sameNameCandidates.length === 0 && !createAnyway;
  // Only where nothing better is on screen: an exact namesake in the list is
  // the stronger, live answer, so the suggestion (set history included) gives
  // way to it. Held until the exact-name evidence has loaded.
  const showPreselect = preselectOffered && matches !== undefined && exactRows.length === 0;
  const showExact = !pickStep && !createAnyway && exactSingle !== null && !showPreselect;
  const promotedIds = new Set<string>([
    ...(showPreselect && preselect ? [preselect.playerId as string] : []),
    ...(showExact && exactSingle ? [exactSingle._id as string] : []),
  ]);
  const panelMatches = (matches ?? []).filter(
    (m) =>
      !promotedIds.has(m._id as string) &&
      // The same-name candidates are the pick step's own list.
      !(pickStep && sameNameCandidates.some((c) => c.playerId === m._id)),
  );
  const creating = !pickStep && !showPreselect && !showExact;
  // Nothing is created until the lookups have answered: any of them can still
  // turn "new" into a link, a same-name pick or the fragment question, and a
  // created player can't be taken back. The Wikidata lookup carries the set's
  // history picks, so it is one of them (a failed one is not: Try again is
  // offered and the rest still decide).
  const checking =
    rowSportId !== undefined &&
    (nearMatches === undefined || fragmentCheck === undefined || lookupStatus === "pending");

  // A player the lookup itself offered may be in another sport: the server
  // takes the link without the sport check only for those (`offered`).
  const offeredIds = new Set<string>([
    ...(preselect ? [preselect.playerId as string] : []),
    ...(enrichment?.existingCandidates ?? []).map((c) => c.playerId as string),
  ]);

  const link = (playerId: string) =>
    answer(
      async () => {
        await answerName({
          cardId: row._id,
          kind: "player",
          name: name.printed,
          sportId: needSport(rowSportId),
          answer: {
            kind: "linkPlayer",
            playerId: playerId as Id<"players">,
            ...(crossSport && addSetSport ? { addSetSport: true as const } : {}),
          },
          ...(offeredIds.has(playerId) ? { offered: true as const } : {}),
        });
        setLinkOpen(false);
      },
      "Couldn't link that player. Try again.",
    );

  const toggleCareerTeam = (teamName: string) =>
    setExcludedCareer((prev) => {
      const next = new Set(prev);
      if (!next.delete(teamName)) next.add(teamName);
      return next;
    });
  // Only names this row's lookup actually proposed, in the lookup's own spelling.
  const excludedNames = Array.from(
    new Set(
      (enrichment?.careerTeams ?? []).map((ct) => ct.name).filter((n) => excludedCareer.has(n)),
    ),
  );

  // What the operator saw the lookup find seeds the new player (B14).
  const seen =
    enrichment &&
    (enrichment.wikidataId !== undefined ||
      enrichment.isHallOfFame !== undefined ||
      (enrichment.careerTeams?.length ?? 0) > 0)
      ? {
          ...(enrichment.wikidataId !== undefined ? { wikidataId: enrichment.wikidataId } : {}),
          ...(enrichment.isHallOfFame !== undefined ? { isHallOfFame: enrichment.isHallOfFame } : {}),
          ...(enrichment.careerTeams ? { careerTeams: enrichment.careerTeams } : {}),
        }
      : undefined;

  const create = (oneNamePlayer: boolean) =>
    checking ? Promise.resolve(false) : answer(
      () =>
        createPlayer({
          cardId: row._id,
          name: name.printed,
          sportId: needSport(rowSportId),
          ...(oneNamePlayer ? { oneNamePlayer: true as const } : {}),
          ...(excludedNames.length > 0 ? { excludedCareerTeamNames: excludedNames } : {}),
          ...(seen ? { enrichment: seen } : {}),
        }),
      "Couldn't add that player. Try again.",
    );

  const notAPlayer = async () => {
    const ok = await answer(
      () =>
        answerName({
          cardId: row._id,
          kind: "player",
          name: name.printed,
          sportId: needSport(rowSportId),
          answer: { kind: "notEntity" },
        }),
      "Couldn't save that answer. Try again.",
    );
    if (ok) memory.rememberAnswer(row._id, "player", name.printed, { kind: "notEntity", printed: name.printed });
  };

  const addAnyway = () => setCreateAnyway(true);

  const switchSport = (sportId: Id<"selectorOptions">) => {
    // A new question: the old answer's career ticks and "add anyway" do not carry.
    setChipSportId(sportId);
    setExcludedCareer(new Set());
    setCreateAnyway(false);
  };

  const printedOn = printedOnText(printedOnOf(leafCards, "player", name.printed));
  const disabled = write.busy ? true : undefined;
  // The reason line under the suggestion, and the id the suggestion's button
  // is described by while that line is on screen.
  const reasonId = useId();

  // One filled button per tile (the walk's own rule: the best answer leads,
  // everything else is an outline). In this order, and only on the lead row:
  // the suggested link, the exact link, Add as new.
  const leadAction: "preselect" | "exact" | "create" | null = !lead
    ? null
    : showPreselect && preselect
      ? "preselect"
      : showExact && exactSingle
        ? "exact"
        : creating
          ? "create"
          : null;
  /** The filled green button, or a blue outline. */
  const tone = (filled: boolean) =>
    filled ? ({} as const) : ({ variant: "secondary", outline: true } as const);

  return (
    <div ref={wrapRef} role="group" aria-label={`Player ${name.printed}`} className="grid gap-2">
      {printedOn && <p className="text-xs text-ink-3 wrap-anywhere">{printedOn}</p>}

      {showPreselect && preselect && !linkOpen && (
        <div className="flex items-start gap-2 rounded-md bg-raised-deep px-2.5 py-1.5">
          <QuestionMarkCircleIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
          <p id={reasonId} className="min-w-0 text-sm text-ink-2 wrap-anywhere">
            {preselectReasonLine(preselect)}
          </p>
        </div>
      )}

      {pickStep && !linkOpen && (
        <>
          <p className="text-sm font-medium text-ink wrap-anywhere">{`Which ${queryName} is this?`}</p>
          <SameNamePlayerPanel
            candidates={sameNameCandidates}
            scanCapped={scanCapped}
            setSportValue={setSportValue}
            disabled={write.busy}
            onPick={(playerId) => {
              if (write.busy) return;
              void link(playerId);
            }}
          />
        </>
      )}

      {/* Mounted for the whole life of the row, so the sentence is a change to a
          live region that is already in the page. */}
      <p role="status" className="text-xs italic text-ink-3 empty:hidden">
        {creating && !linkOpen && checking
          ? "Checking for players by that name…"
          : lookupFailed && !linkOpen
            ? "Couldn't look this one up."
            : null}
      </p>

      {creating && !linkOpen && !checking && (
        <div className="grid gap-1">
          <p className="text-sm text-ink wrap-anywhere">{`“${queryName}” is new to NeonBinder.`}</p>
          {!lookupFailed && (
            <WikidataBlock
              status={lookupStatus}
              enrichment={enrichment}
              excludedCareerTeams={excludedCareer}
              onToggleCareerTeam={toggleCareerTeam}
              disabled={write.busy}
              labelSuffix={suffix}
            />
          )}
        </div>
      )}

      {!linkOpen && !pickStep && fragmentStep && (
        <NameFragmentPanel
          name={queryName}
          matches={fragmentMatches}
          disabled={write.busy}
          onPick={(id) => {
            if (write.busy) return;
            void link(id);
          }}
        />
      )}

      {!linkOpen && <NearMatchPanel kind="player" matches={panelMatches} busy={write.busy} onPick={(id) => void link(id)} />}

      {crossSport && (
        <label className="flex min-h-6 items-center gap-2 text-xs text-ink-2">
          <input
            type="checkbox"
            checked={addSetSport}
            aria-disabled={write.busy || undefined}
            onChange={(e) => {
              if (write.busy) return;
              setAddSetSport(e.target.checked);
            }}
            aria-label={`Also add ${setSportValue ?? "the set's sport"} to their sports${suffix}`}
            className="h-6 w-6 shrink-0 rounded accent-neon-green-text focus-outline aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          />
          <span>{`Also add ${setSportValue ?? "the set's sport"} to their sports`}</span>
        </label>
      )}

      {linkOpen ? (
        rowSportId && (
          <EntityLinkSearch
            kind="player"
            sportId={rowSportId}
            initialQuery={queryName}
            onSelect={(id) => void link(id)}
            onCancel={closeLink}
          />
        )
      ) : (
        <div className="flex flex-wrap items-center gap-2" aria-busy={write.busy || undefined}>
          {showPreselect && preselect && (
            <NeonButton
              size="1"
              {...tone(leadAction === "preselect")}
              className={WRAP_LABEL_CLASS}
              aria-label={`Link to ${preselect.name} (${preselect.sportValue})${suffix}`}
              aria-describedby={reasonId}
              aria-disabled={disabled}
              onClick={() => void link(preselect.playerId)}
            >
              {`Link to ${preselect.name} (${preselect.sportValue})`}
            </NeonButton>
          )}
          {showExact && exactSingle && (
            <NeonButton
              size="1"
              {...tone(leadAction === "exact")}
              className={WRAP_LABEL_CLASS}
              aria-label={`Link to ${exactSingle.name}${suffix}`}
              aria-disabled={disabled}
              onClick={() => void link(exactSingle._id)}
            >
              {`Link to ${exactSingle.name}`}
            </NeonButton>
          )}
          {(showPreselect || showExact || pickStep) && (
            <NeonButton
              size="1"
              variant="secondary"
              outline
              aria-label={`Add as new player anyway${suffix}`}
              aria-disabled={disabled}
              onClick={addAnyway}
            >
              Add as new player anyway
            </NeonButton>
          )}
          {creating && (
            <NeonButton
              size="1"
              {...tone(leadAction === "create")}
              className={WRAP_LABEL_CLASS}
              aria-label={`${fragmentStep ? ONE_NAME_PLAYER_LABEL : "Add as new player"}${suffix}`}
              aria-disabled={disabled || checking ? true : undefined}
              onClick={() => void create(fragmentStep)}
            >
              {fragmentStep ? ONE_NAME_PLAYER_LABEL : "Add as new player"}
            </NeonButton>
          )}
          <NeonButton
            ref={linkButtonRef}
            size="1"
            variant="secondary"
            outline
            aria-label={`Link to existing…${suffix}`}
            aria-disabled={disabled}
            onClick={() => setLinkOpen(true)}
          >
            Link to existing…
          </NeonButton>
          <NeonButton
            size="1"
            variant="negative"
            outline
            className={WRAP_LABEL_CLASS}
            aria-label={`Not a player (checklist, team card, stadium)${suffix}`}
            aria-disabled={disabled}
            onClick={() => void notAPlayer()}
          >
            Not a player (checklist, team card, stadium)
          </NeonButton>
          {lookupFailed && (
            <NeonButton
              size="1"
              variant="secondary"
              outline
              aria-label={`Try again${suffix}`}
              aria-disabled={disabled}
              onClick={retry}
            >
              Try again
            </NeonButton>
          )}
          {setSportId && rowSportId && (
            <span className="text-xs text-ink-3">
              <SportSwitch
                value={rowSportId}
                setSportId={setSportId}
                disabled={write.busy}
                label={multi ? `Sport for ${name.printed}` : "Sport for this name"}
                prefix="Sport:"
                onChange={switchSport}
              />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
