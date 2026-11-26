import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { eraLabel, teamOptionLabel } from "../../../../lib/teams/team-era";
import { teamFullName } from "../../../../lib/teams/team-name";
import NeonButton from "../../../modules/NeonButton";
import { Checkbox } from "../../../primitives/Checkbox";
import { TeamMatchSearch } from "../../../entities/TeamMatchSearch";
import SportSwitch from "../../SportSwitch";
import type { TidyCardContext, TidyRow } from "../tile-types";
import { WRAP_LABEL_CLASS } from "../TidyTile";
import { useAnswered } from "../answered";
import { useNameLookup, useWalkMemory } from "../walk-memory";
import EditLine from "./EditLine";
import InlineNewTeam, { teamLookupCarryOf } from "./InlineNewTeam";
import NameApplyToAll from "./NameApplyToAll";
import { printedOnOf, printedOnText } from "./printed-on";
import TeamCandidates, { type TeamCandidate } from "./TeamCandidates";
import { orderCandidateTeams } from "./team-candidates";
import type { TidyWrite } from "./tidy-write";
import { useReopenedFocus } from "./use-reopened-focus";

const NO_IDS: Array<Id<"teams">> = [];

type Ctx = NonNullable<TidyCardContext>;
export type ContextName = Ctx["names"][number];

/** Answering a name needs the sport it is asked in; with none there is nothing to send. */
function needSport(sportId: Id<"selectorOptions"> | undefined): Id<"selectorOptions"> {
  if (!sportId) throw new Error("Pick a sport.");
  return sportId;
}

/**
 * One printed team name still waiting on the open card (`pendingTeamNames`):
 * the rows the name could mean, a search over every team ("Remember it as a name
 * for this team" included), the inline New team form, "Not a team" and the
 * Sport chip. A team that is linked has no name of its own on the card: it is
 * the card's team, and Change goes through the Team tile.
 *
 * Every answer is `tidyNames.answerName` and links THIS card (NEO-656). A
 * listing's name is never written as NB data: it only finds the rows offered
 * here.
 */
export default function TeamNameRow({
  row,
  name,
  setSportId,
  leafId,
  multi,
  write,
  leafCards,
}: {
  row: TidyRow;
  name: ContextName;
  setSportId: Id<"selectorOptions"> | undefined;
  leafId: Id<"selectorOptions">;
  multi: boolean;
  write: TidyWrite;
  /** The checklist's cards: "Printed on". */
  leafCards: readonly TidyRow[];
}) {
  return (
    <UnansweredTeamName
      row={row}
      name={name}
      setSportId={setSportId}
      leafId={leafId}
      multi={multi}
      write={write}
      leafCards={leafCards}
    />
  );
}

/**
 * A team name the operator ruled out ("Not a team") on the card that is open.
 * The name is off the card, so the walk's memory is all that holds it; Edit
 * puts it back to waiting. Gone with the card.
 */
export function RuledOutTeamRow({
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
    memory.oweFocus(row._id, "team", printed);
    const ok = await write.run(
      () =>
        answerName({
          cardId: row._id,
          kind: "team",
          name: printed,
          sportId: needSport(memory.defaultSportFor("team", printed, setSportId)),
          answer: { kind: "clear" },
        }),
      "Couldn't change that answer. Try again.",
    );
    // The row re-opens as soon as the card says so, which can be before this
    // await resolves: the focus is owed first, and given back if the write fails.
    if (ok) memory.forgetAnswer(row._id, "team", printed);
    else memory.takeFocusOwed(row._id, "team", printed);
  };
  return (
    <div role="group" aria-label={`Team ${printed}`} className="grid gap-1.5">
      <EditLine
        editLabel={`Edit ${printed}`}
        busy={write.busy}
        onEdit={() => void clear()}
        textClass="text-sm text-ink-2"
      >
        <span className="font-medium text-ink">{printed}</span> is not a team.
      </EditLine>
      <NameApplyToAll
        cardId={row._id}
        kind="team"
        printed={printed}
        answer={{ kind: "notEntity" }}
        leafCards={leafCards}
      />
    </div>
  );
}

function UnansweredTeamName({
  row,
  name,
  setSportId,
  leafId,
  multi,
  write,
  leafCards,
}: {
  row: TidyRow;
  name: ContextName;
  setSportId: Id<"selectorOptions"> | undefined;
  leafId: Id<"selectorOptions">;
  multi: boolean;
  write: TidyWrite;
  leafCards: readonly TidyRow[];
}) {
  const answerName = useMutation(api.tidyNames.answerName);
  const answered = useAnswered();
  const memory = useWalkMemory();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Edit on a ruled-out name re-opens this row: focus lands on its first control.
  useReopenedFocus(memory, row._id, "team", name.printed, wrapRef);

  /** A write that ANSWERS the name: on success the walk moves focus on. */
  const answer = async (fn: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    const ok = await write.run(fn, fallback);
    if (ok) answered();
    return ok;
  };

  // The Sport chip is local: it is the question's sport for this sitting, never
  // saved. The facts' sport leads, else the set's.
  const [chipSportId, setChipSportId] = useState<Id<"selectorOptions"> | undefined>(undefined);
  const rowSportId = chipSportId ?? memory.defaultSportFor("team", name.printed, setSportId);
  const queryName = name.printed;
  const { lookup, retry } = useNameLookup({
    memory,
    cardId: row._id,
    kind: "team",
    name: name.printed,
    sportId: rowSportId,
  });
  const enrichment = lookup?.enrichment;
  const lookupFailed = rowSportId !== undefined && lookup?.status === "error";
  // The rows the name reached (from the set's facts) are that sport's: another
  // sport's would not link.
  const gateItem = memory.gateItemFor("team", name.printed);
  const factsApply = gateItem !== undefined && gateItem.sportId === rowSportId;
  const candidateIds = factsApply ? (gateItem.candidateTeamIds ?? NO_IDS) : NO_IDS;
  const candidatePlace = factsApply && gateItem.candidatePlace === true;
  const suffix = multi ? ` ${name.printed}` : "";

  const [newOpen, setNewOpen] = useState(false);
  const [aliasChoice, setAliasChoice] = useState<boolean | undefined>(undefined);
  const newRef = useRef<HTMLButtonElement | null>(null);

  const nearMatches = useQuery(
    api.teams.nearMatches,
    rowSportId
      ? {
          name: queryName,
          sportId: rowSportId,
          ...(candidateIds.length > 5 ? { limit: candidateIds.length } : {}),
        }
      : "skip",
  );
  const candidateRows = useQuery(
    api.teams.getManyByIds,
    candidateIds.length >= 2 ? { ids: [...candidateIds].sort() } : "skip",
  );
  const leagues = useQuery(
    api.leagues.list,
    rowSportId && candidateIds.length >= 2 ? { sportId: rowSportId } : "skip",
  );

  const candidates: TeamCandidate[] = useMemo(() => {
    if (candidateIds.length < 2) return [];
    const leagueById = new Map((leagues ?? []).map((l) => [l._id as string, l.abbreviation ?? l.name]));
    const rowById = new Map((candidateRows ?? []).map((t) => [t._id as string, t]));
    const rows = candidateIds.map((id) => {
      const team = rowById.get(id);
      return {
        id,
        fullName: team ? teamFullName(team) : queryName,
        ...(team?.yearsActive ? { yearsActive: team.yearsActive } : {}),
        candidate: {
          teamId: id,
          fullName: team ? teamFullName(team) : queryName,
          era: team ? eraLabel(team.yearsActive) : "",
          ...(team?.leagueId && leagueById.get(team.leagueId)
            ? { league: leagueById.get(team.leagueId) }
            : {}),
        } satisfies TeamCandidate,
      };
    });
    return orderCandidateTeams(rows).map((r) => r.candidate);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `queryName` is the name `candidateRows` were asked about
  }, [candidateIds, candidateRows, leagues]);
  const candidateStep = candidateIds.length >= 2;
  // "+ New team" waits for the near-match answer: an exact match turns it into
  // a link, and a created team can't be taken back.
  const checking = rowSportId !== undefined && nearMatches === undefined;

  const matches = nearMatches;
  const exactRows = (matches ?? []).filter((m) => m.confidence === "exact");
  const exactSingle =
    !candidateStep && exactRows.length === 1 && !exactRows[0].matchedAlias ? exactRows[0] : null;
  // Collector review: a string equal to some team's LOCATION is a place, not a
  // name for the team linked here, so it starts unticked.
  const nameIsAPlace =
    candidatePlace || (matches ?? []).some((m) => m.locationMatch === true);
  const aliasDefaultPending = aliasChoice === undefined && matches === undefined;
  const saveAsAlias = aliasChoice ?? (!nameIsAPlace && !aliasDefaultPending);

  const link = (teamId: string) =>
    answer(async () => {
      await answerName({
        cardId: row._id,
        kind: "team",
        name: name.printed,
        sportId: needSport(rowSportId),
        answer: {
          kind: "linkTeam",
          teamId: teamId as Id<"teams">,
          ...(saveAsAlias ? { saveAsAlias: true as const } : {}),
        },
      });
      // What "Apply to all" copies; the card itself holds only the team.
      memory.rememberAnswer(row._id, "team", name.printed, {
        kind: "linkTeam",
        printed: name.printed,
        teamId: teamId as Id<"teams">,
      });
    }, "Couldn't link that team. Try again.");

  const notATeam = () =>
    answer(async () => {
      await answerName({
        cardId: row._id,
        kind: "team",
        name: name.printed,
        sportId: needSport(rowSportId),
        answer: { kind: "notEntity" },
      });
      memory.rememberAnswer(row._id, "team", name.printed, {
        kind: "notEntity",
        printed: name.printed,
      });
    }, "Couldn't save that answer. Try again.");

  const switchSport = (sportId: Id<"selectorOptions">) => setChipSportId(sportId);

  const printedOn = printedOnText(printedOnOf(leafCards, "team", name.printed));
  const disabled = write.busy ? true : undefined;

  return (
    <div ref={wrapRef} role="group" aria-label={`Team ${name.printed}`} className="grid gap-2">
      <p className="text-sm text-ink wrap-anywhere">
        {candidateStep ? `Which team: ${queryName}` : `“${queryName}” isn't linked to a team yet.`}
      </p>
      {printedOn && <p className="text-xs text-ink-3 wrap-anywhere">{printedOn}</p>}

      <TeamCandidates
        candidates={candidates}
        printedName={queryName}
        fromPlace={candidatePlace}
        disabled={write.busy}
        onLink={(teamId) => void link(teamId)}
      />

      {rowSportId && !newOpen && (
        <TeamMatchSearch
          sportId={rowSportId}
          contextOptionId={leafId}
          defaultMatches={matches}
          onPick={(id) => {
            if (write.busy) return;
            void link(id);
          }}
        >
          <div className="space-y-0.5">
            <Checkbox
              className="text-xs text-ink-2"
              checked={saveAsAlias}
              aria-disabled={write.busy || aliasDefaultPending || undefined}
              aria-label={`Remember “${name.printed}” as a name for this team`}
              onChange={(e) => {
                if (write.busy || aliasDefaultPending) return;
                setAliasChoice(e.target.checked);
              }}
            >
              {`Remember “${name.printed}” as a name for this team`}
            </Checkbox>
            <p className="pl-6 text-xs text-ink-3">
              Kicks in when you link. Next time this name shows up, it goes straight to that team.
            </p>
          </div>
        </TeamMatchSearch>
      )}

      {/* Mounted for the whole life of the row, so the sentence is a change to a
          live region that is already in the page. */}
      <p role="status" className="text-xs italic text-ink-3 empty:hidden">
        {checking && !newOpen
          ? "Checking for teams by that name…"
          : lookupFailed && !newOpen
            ? "Couldn't look this one up."
            : null}
      </p>

      {newOpen && rowSportId ? (
        <InlineNewTeam
          formKey={`team:${name.nameNormalized}`}
          sportId={rowSportId}
          initialName={queryName}
          espnLocation={enrichment?.location}
          leagueSuggestion={enrichment?.league}
          carry={teamLookupCarryOf(enrichment)}
          createLabel="Create team"
          createAriaLabel={(full, creating) =>
            creating ? `Creating team ${full}` : full ? `Create team ${full}` : "Create team"
          }
          disabled={write.busy}
          onCreated={async (teamId) => {
            await answerName({
              cardId: row._id,
              kind: "team",
              name: name.printed,
              sportId: needSport(rowSportId),
              answer: { kind: "linkTeam", teamId },
            });
            memory.rememberAnswer(row._id, "team", name.printed, {
              kind: "linkTeam",
              printed: name.printed,
              teamId,
            });
            answered();
          }}
          onUseExisting={(teamId) => void link(teamId)}
          onClose={() => {
            setNewOpen(false);
            requestAnimationFrame(() => newRef.current?.focus({ preventScroll: true }));
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2" aria-busy={write.busy || undefined}>
          {exactSingle && (
            <NeonButton
              size="1"
              className={WRAP_LABEL_CLASS}
              aria-label={`Link to ${teamOptionLabel(exactSingle.name, exactSingle.yearsActive)}${suffix}`}
              aria-disabled={disabled}
              onClick={() => void link(exactSingle._id)}
            >
              {`Link to ${teamOptionLabel(exactSingle.name, exactSingle.yearsActive)}`}
            </NeonButton>
          )}
          <NeonButton
            ref={newRef}
            size="1"
            variant="secondary"
            aria-label={`+ New team${suffix}`}
            aria-disabled={disabled || checking ? true : undefined}
            onClick={() => {
              if (checking) return;
              setNewOpen(true);
            }}
          >
            + New team
          </NeonButton>
          <NeonButton
            size="1"
            variant="negative"
            outline
            aria-label={`Not a team${suffix}`}
            aria-disabled={disabled}
            onClick={() => void notATeam()}
          >
            Not a team
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
                label={multi ? `Sport for team ${name.printed}` : "Sport for this team name"}
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
