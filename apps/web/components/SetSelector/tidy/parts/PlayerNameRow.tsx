import { useMemo, useRef, useState } from "react";
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
import { TidyNote } from "../TidyTile";
import { useAnswered } from "../answered";
import { useInlinePart } from "../inline-stack";
import {
  linkedForText,
  NOT_A_PLAYER_SAME_AS_TEAM_NOTE,
  preselectReasonLine,
  stintYears,
  type LinkedForReason,
} from "./copy";
import { printedOnText } from "./printed-on";
import type { TidyWrite } from "./tidy-write";
import { useSportValue } from "./use-sport-value";
import WikidataBlock from "./WikidataBlock";

type Ctx = NonNullable<TidyCardContext>;
export type ContextName = Ctx["names"][number];
export type ContextPlayer = Ctx["players"][number];

const NO_FRAGMENT_MATCHES: NameFragmentMatch[] = [];

/** "Did you mean Jackson Holliday (Baltimore Orioles 2024–)?": a near spelling, with who he is. */
function didYouMeanLabel(near: {
  name: string;
  teamName?: string;
  fromYear?: number;
  toYear?: number;
}): string {
  const years = stintYears(near);
  const who = near.teamName ? ` (${[near.teamName, years].filter(Boolean).join(" ")})` : "";
  return `Did you mean ${near.name}${who}?`;
}

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

/**
 * One printed player name on the open card, in whatever state it is in:
 *
 *  - unanswered (pink): the question, with every way to answer it inline;
 *  - linked, by us ("Linked for you") or by the operator: the player, a note
 *    saying why, and Change;
 *  - "Not a player": said so, and Change.
 *
 * Every answer is `tidyNames.answerName` / `createPlayer`, scoped by the server
 * to the leaf that printed the name; this component never names a scope.
 */
export default function PlayerNameRow({
  row,
  name,
  linked,
  reason,
  setSportId,
  multi,
  write,
}: {
  row: TidyRow;
  name: ContextName;
  linked: ContextPlayer | undefined;
  reason: LinkedForReason | undefined;
  setSportId: Id<"selectorOptions"> | undefined;
  /** More than one name on the card: controls carry the name so no two read alike. */
  multi: boolean;
  write: TidyWrite;
}) {
  const answer = name.row?.answer;
  const answerName = useMutation(api.tidyNames.answerName);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // When the answer lands the question unmounts under the operator's focus. The
  // walk moves it on (`useAnswered`): never to this row's Change, where one more
  // Enter would undo the answer.

  const clear = () =>
    write.run(
      () =>
        answerName({
          cardId: row._id,
          kind: "player",
          name: name.printed,
          answer: { kind: "clear" },
        }),
      "Couldn't change that answer. Try again.",
    );

  const suffix = multi ? ` ${name.printed}` : "";

  if (answer?.kind === "notEntity") {
    return (
      <div ref={wrapRef} role="group" aria-label={`Player ${name.printed}`} className="grid gap-1.5">
        <p className="text-sm text-ink-2 wrap-anywhere">
          <span className="font-medium text-ink">{name.printed}</span> is not a player.
        </p>
        {answer.by === "auto" && answer.autoReason === "sameAsTeam" && (
          <TidyNote>{NOT_A_PLAYER_SAME_AS_TEAM_NOTE}</TidyNote>
        )}
        <div className="flex flex-wrap gap-2">
          <NeonButton
            size="1"
            variant="secondary"
            outline
            aria-label={multi ? `Change player${suffix}` : undefined}
            aria-disabled={write.busy ? true : undefined}
            onClick={() => void clear()}
          >
            Change player
          </NeonButton>
        </div>
      </div>
    );
  }

  if (answer?.kind === "linkPlayer") {
    return (
      <div ref={wrapRef} role="group" aria-label={`Player ${name.printed}`} className="grid gap-1.5">
        <p className="text-sm">
          <PlayerSummary player={linked} fallbackName={name.printed} />
        </p>
        {reason && <TidyNote>{linkedForText(reason)}</TidyNote>}
        <div className="flex flex-wrap gap-2">
          <NeonButton
            size="1"
            variant="secondary"
            outline
            aria-label={multi ? `Change player${suffix}` : undefined}
            aria-disabled={write.busy ? true : undefined}
            onClick={() => void clear()}
          >
            Change player
          </NeonButton>
        </div>
      </div>
    );
  }

  return (
    <UnansweredPlayerName
      row={row}
      name={name}
      setSportId={setSportId}
      multi={multi}
      write={write}
      wrapRef={wrapRef}
    />
  );
}

function UnansweredPlayerName({
  row,
  name,
  setSportId,
  multi,
  write,
  wrapRef,
}: {
  row: TidyRow;
  name: ContextName;
  setSportId: Id<"selectorOptions"> | undefined;
  multi: boolean;
  write: TidyWrite;
  wrapRef: React.RefObject<HTMLDivElement | null>;
}) {
  const answerName = useMutation(api.tidyNames.answerName);
  const createPlayer = useMutation(api.tidyNames.createPlayer);
  const setNameSport = useMutation(api.tidyNames.setNameSport);
  const requestLookup = useMutation(api.tidyNames.requestLookup);
  const answered = useAnswered();

  /** A write that ANSWERS the name: on success the walk moves focus on. */
  const answer = async (fn: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    const ok = await write.run(fn, fallback);
    if (ok) answered();
    return ok;
  };

  const nameRow = name.row;
  const rowSportId = nameRow?.sportId ?? setSportId;
  const queryName = nameRow?.name ?? name.printed;
  const enrichment = nameRow?.enrichment;
  const status = nameRow?.status ?? "ready";
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
  // NEO-645 (S2): players on file whose name is a near spelling of this one.
  // Offered, never linked: the operator presses the button.
  const didYouMean = useQuery(
    api.players.didYouMean,
    rowSportId ? { cardId: row._id, name: queryName, sportId: rowSportId } : "skip",
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

  // NEO-254: the players already filed under this exact name. The server's own
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
  // NEO-645: what this set already did with the name leads the row whatever else
  // is on file: a namesake in the exact list does not take the suggestion away,
  // and its own links follow it.
  const setHistoryLead =
    preselect !== null && preselect.reason === "setHistory" && !createAnyway && matches !== undefined;
  const showPreselect =
    setHistoryLead || (preselectOffered && matches !== undefined && exactRows.length === 0);
  const showExact =
    !pickStep &&
    !createAnyway &&
    exactSingle !== null &&
    !(showPreselect && exactSingle._id === preselect?.playerId) &&
    (!showPreselect || setHistoryLead);
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
  const nearSpellings = creating && !createAnyway ? (didYouMean ?? []) : [];
  // Nothing is created until both lookups have answered: either can still turn
  // "new" into a link, a same-name pick or the fragment question, and a created
  // player can't be taken back.
  const checking = rowSportId !== undefined && (nearMatches === undefined || fragmentCheck === undefined);

  const link = (playerId: string) =>
    answer(
      async () => {
        await answerName({
          cardId: row._id,
          kind: "player",
          name: name.printed,
          answer: {
            kind: "linkPlayer",
            playerId: playerId as Id<"players">,
            ...(crossSport && addSetSport ? { addSetSport: true as const } : {}),
          },
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

  const create = (oneNamePlayer: boolean) =>
    checking ? Promise.resolve(false) : answer(
      () =>
        createPlayer({
          cardId: row._id,
          name: name.printed,
          ...(oneNamePlayer ? { oneNamePlayer: true as const } : {}),
          ...(excludedNames.length > 0 ? { excludedCareerTeamNames: excludedNames } : {}),
        }),
      "Couldn't add that player. Try again.",
    );

  const notAPlayer = () =>
    answer(
      () =>
        answerName({
          cardId: row._id,
          kind: "player",
          name: name.printed,
          answer: { kind: "notEntity" },
        }),
      "Couldn't save that answer. Try again.",
    );

  const addAnyway = () => {
    setCreateAnyway(true);
    // Ask Wikidata now: a name born without a lookup gets one at this press.
    void write.run(
      () => requestLookup({ cardId: row._id, kind: "player", name: name.printed }),
      "Couldn't ask for the lookup. Try again.",
    );
  };

  const switchSport = (sportId: Id<"selectorOptions">) =>
    write.run(
      () => setNameSport({ cardId: row._id, kind: "player", name: name.printed, sportId }),
      "Couldn't switch the sport. Try again.",
    );

  const printedOn = printedOnText(name.printedOn);
  const disabled = write.busy ? true : undefined;

  return (
    <div ref={wrapRef} role="group" aria-label={`Player ${name.printed}`} className="grid gap-2">
      {printedOn && <p className="text-xs text-ink-3 wrap-anywhere">{printedOn}</p>}

      {showPreselect && preselect && !linkOpen && (
        <p className="border-l-4 border-l-selection pl-3 text-sm text-ink-2 wrap-anywhere">
          {preselectReasonLine(preselect)}
        </p>
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
        {creating && !linkOpen && checking ? "Checking for players by that name…" : null}
      </p>

      {creating && !linkOpen && !checking && (
        <div className="grid gap-1">
          <p className="text-sm text-ink wrap-anywhere">{`“${queryName}” is new to NeonBinder.`}</p>
          <WikidataBlock
            status={status}
            enrichment={enrichment}
            excludedCareerTeams={excludedCareer}
            onToggleCareerTeam={toggleCareerTeam}
            disabled={write.busy}
            labelSuffix={suffix}
          />
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
        <div className="grid gap-0.5">
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
          <p className="pl-8 text-xs text-ink-3">Leave it off for a one-off appearance in this set.</p>
        </div>
      )}

      {linkOpen ? (
        rowSportId && (
          <EntityLinkSearch
            kind="player"
            sportId={rowSportId}
            initialQuery={queryName}
            contextCardId={row._id}
            onSelect={(id) => void link(id)}
            onCancel={closeLink}
          />
        )
      ) : (
        <div className="flex flex-wrap items-center gap-2" aria-busy={write.busy || undefined}>
          {showPreselect && preselect && (
            <NeonButton
              size="1"
              aria-label={`Link to ${preselect.name} (${preselect.sportValue})${suffix}`}
              aria-disabled={disabled}
              onClick={() => void link(preselect.playerId)}
            >
              {`Link to ${preselect.name} (${preselect.sportValue})`}
            </NeonButton>
          )}
          {showExact && exactSingle && (
            <NeonButton
              size="1"
              aria-label={`Link to ${exactSingle.name}${suffix}`}
              aria-disabled={disabled}
              onClick={() => void link(exactSingle._id)}
            >
              {`Link to ${exactSingle.name}`}
            </NeonButton>
          )}
          {nearSpellings.map((near) => {
            const label = didYouMeanLabel(near);
            return (
              <NeonButton
                key={near._id}
                size="1"
                aria-label={`${label}${suffix}`}
                aria-disabled={disabled}
                onClick={() => void link(near._id)}
              >
                {label}
              </NeonButton>
            );
          })}
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
              outline={nearSpellings.length > 0 ? true : undefined}
              variant={nearSpellings.length > 0 ? "secondary" : undefined}
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
            aria-label={`Not a player (checklist, team card, stadium)${suffix}`}
            aria-disabled={disabled}
            onClick={() => void notAPlayer()}
          >
            Not a player (checklist, team card, stadium)
          </NeonButton>
          {nameRow && setSportId && rowSportId && (
            <span className="text-xs text-ink-3">
              <SportSwitch
                value={rowSportId}
                setSportId={setSportId}
                disabled={write.busy}
                label={multi ? `Sport for ${name.printed}` : "Sport for this name"}
                prefix="Sport:"
                onChange={(sportId) => void switchSport(sportId)}
              />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
