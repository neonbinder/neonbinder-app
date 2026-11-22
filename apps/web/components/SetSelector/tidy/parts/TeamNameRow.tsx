import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { eraLabel, teamOptionLabel } from "../../../../lib/teams/team-era";
import { teamFullName } from "../../../../lib/teams/team-name";
import NeonButton from "../../../modules/NeonButton";
import { TeamMatchSearch } from "../../../entities/TeamMatchSearch";
import SportSwitch from "../../SportSwitch";
import type { TidyCardContext, TidyRow } from "../tile-types";
import { WRAP_LABEL_CLASS } from "../TidyTile";
import { useAnswered } from "../answered";
import { teamLinkedForText } from "./copy";
import InlineNewTeam, { teamLookupCarryOf } from "./InlineNewTeam";
import { printedOnText } from "./printed-on";
import TeamCandidates, { type TeamCandidate } from "./TeamCandidates";
import { orderCandidateTeams } from "./team-candidates";
import type { TidyWrite } from "./tidy-write";

type Ctx = NonNullable<TidyCardContext>;
export type ContextName = Ctx["names"][number];

/**
 * One printed team name on the open card, in whatever state it is in:
 *
 *  - unanswered (pink): the rows the name could mean, a search over every team
 *    ("Remember it as a name for this team" included), the inline New team
 *    form, "Not a team" and the Sport chip;
 *  - linked (by us or by the operator): the team, a note saying why when we
 *    linked it, and Change;
 *  - "Not a team": said so, and Change.
 *
 * Every answer is `tidyNames.answerName`, scoped by the server to the leaf that
 * printed the name. A listing's name is never written as NB data: it only finds
 * the rows offered here.
 */
export default function TeamNameRow({
  row,
  name,
  context,
  setSportId,
  leafId,
  multi,
  write,
}: {
  row: TidyRow;
  name: ContextName;
  context: Ctx;
  setSportId: Id<"selectorOptions"> | undefined;
  leafId: Id<"selectorOptions">;
  multi: boolean;
  write: TidyWrite;
}) {
  const answer = name.row?.answer;
  const answerName = useMutation(api.tidyNames.answerName);

  const suffix = multi ? ` ${name.printed}` : "";
  const clear = () =>
    write.run(
      () =>
        answerName({ cardId: row._id, kind: "team", name: name.printed, answer: { kind: "clear" } }),
      "Couldn't change that answer. Try again.",
    );

  if (answer?.kind === "notEntity" || answer?.kind === "linkTeam") {
    const team =
      answer.kind === "linkTeam" ? context.teams.find((t) => t.teamId === answer.teamId) : undefined;
    const linkedTeamId = answer.kind === "linkTeam" ? answer.teamId : undefined;
    const reason =
      answer.kind === "linkTeam"
        ? context.linkedFor.find((l) => l.kind === "team" && l.teamId === answer.teamId)?.reason
        : undefined;
    return (
      <div role="group" aria-label={`Team ${name.printed}`} className="grid gap-1.5">
        <p className="text-sm text-ink-2 wrap-anywhere">
          {answer.kind === "notEntity" ? (
            <>
              <span className="font-medium text-ink">{name.printed}</span> is not a team.
            </>
          ) : (
            <span className="font-medium text-ink">{team?.name ?? name.printed}</span>
          )}
        </p>
        {reason && (
          <p
            role="note"
            className="w-fit max-w-full rounded-md border border-neon-purple-text/60 bg-neon-purple/10 px-2 py-0.5 text-xs text-neon-purple-text wrap-anywhere"
          >
            {teamLinkedForText(
              reason,
              context.players.find((p) => p.stints.some((s) => s.teamId === linkedTeamId))?.name,
            )}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <NeonButton
            size="1"
            variant="secondary"
            outline
            aria-label={multi ? `Change team${suffix}` : undefined}
            aria-disabled={write.busy ? true : undefined}
            onClick={() => void clear()}
          >
            Change team
          </NeonButton>
        </div>
      </div>
    );
  }

  return (
    <UnansweredTeamName
      row={row}
      name={name}
      setSportId={setSportId}
      leafId={leafId}
      multi={multi}
      write={write}
    />
  );
}

function UnansweredTeamName({
  row,
  name,
  setSportId,
  leafId,
  multi,
  write,
}: {
  row: TidyRow;
  name: ContextName;
  setSportId: Id<"selectorOptions"> | undefined;
  leafId: Id<"selectorOptions">;
  multi: boolean;
  write: TidyWrite;
}) {
  const answerName = useMutation(api.tidyNames.answerName);
  const setNameSport = useMutation(api.tidyNames.setNameSport);
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
  const candidateIds = nameRow?.candidateTeamIds ?? [];
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- candidateIds is read through nameRow
  }, [nameRow?.candidateTeamIds, candidateRows, leagues]);
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
    nameRow?.candidatePlace === true || (matches ?? []).some((m) => m.locationMatch === true);
  const aliasDefaultPending = aliasChoice === undefined && matches === undefined;
  const saveAsAlias = aliasChoice ?? (!nameIsAPlace && !aliasDefaultPending);

  const link = (teamId: string) =>
    answer(async () => {
      await answerName({
        cardId: row._id,
        kind: "team",
        name: name.printed,
        answer: {
          kind: "linkTeam",
          teamId: teamId as Id<"teams">,
          ...(saveAsAlias ? { saveAsAlias: true as const } : {}),
        },
      });
    }, "Couldn't link that team. Try again.");

  const notATeam = () =>
    answer(
      () =>
        answerName({
          cardId: row._id,
          kind: "team",
          name: name.printed,
          answer: { kind: "notEntity" },
        }),
      "Couldn't save that answer. Try again.",
    );

  const switchSport = (sportId: Id<"selectorOptions">) =>
    write.run(
      () => setNameSport({ cardId: row._id, kind: "team", name: name.printed, sportId }),
      "Couldn't switch the sport. Try again.",
    );

  const printedOn = printedOnText(name.printedOn);
  const disabled = write.busy ? true : undefined;

  return (
    <div role="group" aria-label={`Team ${name.printed}`} className="grid gap-2">
      <p className="text-sm text-ink wrap-anywhere">
        {candidateStep ? `Which team: ${queryName}` : `“${queryName}” isn't linked to a team yet.`}
      </p>
      {printedOn && <p className="text-xs text-ink-3 wrap-anywhere">{printedOn}</p>}

      <TeamCandidates
        candidates={candidates}
        printedName={queryName}
        fromPlace={nameRow?.candidatePlace === true}
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
            <label className="flex min-h-6 items-center gap-2 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={saveAsAlias}
                aria-disabled={write.busy || aliasDefaultPending || undefined}
                aria-label={`Remember “${name.printed}” as a name for this team`}
                onChange={(e) => {
                  if (write.busy || aliasDefaultPending) return;
                  setAliasChoice(e.target.checked);
                }}
                className="h-6 w-6 shrink-0 rounded accent-neon-green-text focus-outline aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
              />
              <span>{`Remember “${name.printed}” as a name for this team`}</span>
            </label>
            <p className="pl-8 text-xs text-ink-3">
              Kicks in when you link. Next time this name shows up, it goes straight to that team.
            </p>
          </div>
        </TeamMatchSearch>
      )}

      {/* Mounted for the whole life of the row, so the sentence is a change to a
          live region that is already in the page. */}
      <p role="status" className="text-xs italic text-ink-3 empty:hidden">
        {checking && !newOpen ? "Checking for teams by that name…" : null}
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
              answer: { kind: "linkTeam", teamId },
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
          {nameRow && setSportId && rowSportId && (
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
