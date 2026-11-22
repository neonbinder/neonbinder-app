import { useEffect, useMemo, useRef, useState } from "react";
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
import { useInlinePart } from "../inline-stack";
import { linkedForText, preselectReasonLine, stintYears, type LinkedForReason } from "./copy";
import { printedOnText } from "./printed-on";
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
  const answered = answer !== undefined;
  const answerName = useMutation(api.tidyNames.answerName);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const changeRef = useRef<HTMLButtonElement | null>(null);

  // When the answer lands the question unmounts under the operator's focus;
  // hand it to the answered view's Change button instead of <body>.
  const wasAnswered = useRef(answered);
  useEffect(() => {
    if (answered && !wasAnswered.current) {
      const active = document.activeElement;
      if (!active || active === document.body) changeRef.current?.focus({ preventScroll: true });
    }
    wasAnswered.current = answered;
  }, [answered]);

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
        <div className="flex flex-wrap gap-2">
          <NeonButton
            ref={changeRef}
            size="1"
            variant="secondary"
            outline
            aria-label={`Change${suffix}`}
            aria-disabled={write.busy ? true : undefined}
            onClick={() => void clear()}
          >
            Change
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
            ref={changeRef}
            size="1"
            variant="secondary"
            outline
            aria-label={`Change${suffix}`}
            aria-disabled={write.busy ? true : undefined}
            onClick={() => void clear()}
          >
            Change
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

  const nameRow = name.row;
  const rowSportId = nameRow?.sportId ?? setSportId;
  const queryName = nameRow?.name ?? name.printed;
  const enrichment = nameRow?.enrichment;
  const status = nameRow?.status ?? "ready";
  const suffix = multi ? ` ${name.printed}` : "";

  const [linkOpen, setLinkOpen] = useState(false);
  const [createAnyway, setCreateAnyway] = useState(false);
  const [sportOpen, setSportOpen] = useState(false);
  const [addSetSport, setAddSetSport] = useState(false);
  const linkButtonRef = useRef<HTMLButtonElement | null>(null);

  useInlinePart(linkOpen, () => setLinkOpen(false));
  useInlinePart(sportOpen, () => {});

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
  const showPreselect = preselectOffered && matches !== undefined && exactRows.length === 0;
  const showExact = !showPreselect && !pickStep && !createAnyway && exactSingle !== null;
  const promotedId = showPreselect ? preselect?.playerId : showExact ? exactSingle?._id : undefined;
  const panelMatches = (matches ?? []).filter(
    (m) =>
      m._id !== promotedId &&
      // The same-name candidates are the pick step's own list.
      !(pickStep && sameNameCandidates.some((c) => c.playerId === m._id)),
  );
  const creating = !pickStep && !showPreselect && !showExact;

  const link = (playerId: string) =>
    write.run(
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

  const create = (oneNamePlayer: boolean) =>
    write.run(
      () =>
        createPlayer({
          cardId: row._id,
          name: name.printed,
          ...(oneNamePlayer ? { oneNamePlayer: true as const } : {}),
        }),
      "Couldn't add that player. Try again.",
    );

  const notAPlayer = () =>
    write.run(
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

  const closeLink = () => {
    setLinkOpen(false);
    requestAnimationFrame(() => linkButtonRef.current?.focus({ preventScroll: true }));
  };

  return (
    <div ref={wrapRef} role="group" aria-label={`Player ${name.printed}`} className="grid gap-2">
      {printedOn && <p className="text-xs text-ink-3 wrap-anywhere">{printedOn}</p>}

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

      {showPreselect && preselect && !linkOpen && (
        <p className="border-l-4 border-l-selection pl-3 text-sm text-ink-2 wrap-anywhere">
          {preselectReasonLine(preselect)}
        </p>
      )}

      {creating && !linkOpen && (
        <div className="grid gap-1">
          <p className="text-sm text-ink wrap-anywhere">{`“${queryName}” is new to NeonBinder.`}</p>
          <WikidataBlock status={status} enrichment={enrichment} />
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
          <label className="flex items-center gap-2 text-xs text-ink-2">
            <input
              type="checkbox"
              checked={addSetSport}
              disabled={write.busy}
              onChange={(e) => setAddSetSport(e.target.checked)}
              aria-label={`Also add ${setSportValue ?? "the set's sport"} to their sports${suffix}`}
              className="h-4 w-4 rounded accent-neon-green-text focus-outline"
            />
            <span>{`Also add ${setSportValue ?? "the set's sport"} to their sports`}</span>
          </label>
          <p className="pl-6 text-xs text-ink-3">Leave it off for a one-off appearance in this set.</p>
        </div>
      )}

      {linkOpen ? (
        rowSportId && (
          <EntityLinkSearch
            kind="player"
            sportId={rowSportId}
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
              aria-label={`${fragmentStep ? ONE_NAME_PLAYER_LABEL : "Add as new player"}${suffix}`}
              aria-disabled={disabled}
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
                onOpenChange={setSportOpen}
                onChange={(sportId) => void switchSport(sportId)}
              />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
