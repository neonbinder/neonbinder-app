import { useEffect, useMemo, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { pickTeamForYear } from "../../../../lib/teams/team-era";
import NeonButton from "../../../modules/NeonButton";
import { UNKNOWN_TEAM_AMBIGUOUS } from "../../CareerTeamEntry";
import UndatedCareerTeams from "../../UndatedCareerTeams";
import { useInlinePart } from "../inline-stack";
import type { TidyCardContext, TidyRow } from "../tile-types";
import AddStintEntry from "./AddStintEntry";
import { careerLineText } from "./copy";
import InlineNewTeam, { teamLookupCarryOf, type TeamLookupCarry } from "./InlineNewTeam";
import type { TidyWrite } from "./tidy-write";

type Ctx = NonNullable<TidyCardContext>;
type CareerEntry = { name: string; fromYear: number; toYear?: number; wikidataId?: string };

/** What a Wikidata career team resolved to in NeonBinder. */
type Resolution =
  | { kind: "known"; teamId: Id<"teams"> }
  | { kind: "missing" }
  | { kind: "ambiguous" };

/**
 * NEO-645 — a NEW player's career, as Wikidata gave it (`newPlayerCareer`,
 * blue). Create-player already added the stints for teams NeonBinder holds; this
 * row is what is left, and the operator's call:
 *
 *  - a team NB holds with the stint still missing joins the career with
 *    "Add stints to {player}";
 *  - a team NB lacks gets the inline New team form in its own line ("Create
 *    team and add stint"), or "Not now", which writes nothing and leaves that
 *    stint off the career;
 *  - a team Wikidata gave without years is asked for them
 *    (`UndatedCareerTeams`), and joins the career once it has some;
 *  - "+ Add stint" adds any other team NB holds, by hand.
 *
 * Teams are matched by NB's rows (era by the stint's year), never by guessing a
 * name into a new row. Nothing here creates a team except the operator's own
 * New team form.
 */
export default function NewPlayerCareerRow({
  row,
  context,
  playerId,
  leafId,
  write,
}: {
  row: TidyRow;
  context: Ctx;
  playerId: string;
  leafId: Id<"selectorOptions">;
  write: TidyWrite;
}) {
  const player = context.players.find((p) => p.playerId === playerId);
  const enrichment = context.names.find(
    (n) => n.row?.answer?.kind === "linkPlayer" && n.row.answer.playerId === playerId,
  )?.row?.enrichment;
  const careerTeams = useMemo(() => enrichment?.careerTeams ?? [], [enrichment]);
  const undated = enrichment?.undatedCareerTeams ?? [];

  const addStint = useMutation(api.players.addStint);
  const convex = useConvex();
  const [resolved, setResolved] = useState<Record<string, Resolution>>({});
  const [notNow, setNotNow] = useState<ReadonlySet<string>>(new Set());
  const [newTeamFor, setNewTeamFor] = useState<CareerEntry | null>(null);
  const [addedUndated, setAddedUndated] = useState<ReadonlySet<string>>(new Set());
  const [undatedOpen, setUndatedOpen] = useState(false);
  const [undatedError, setUndatedError] = useState<string | null>(null);
  useInlinePart(undatedOpen, () => {});

  // NEO-645: the team the operator is making gets the same lookup a printed team
  // name gets (league, colours, era, location, ESPN id), asked when the form
  // opens. Assistive: the form never waits on it, and a failed ask is not shown.
  const requestTeamLookup = useMutation(api.tidyNames.requestTeamLookup);
  const [askFailedFor, setAskFailedFor] = useState<string | null>(null);
  const lookupName = newTeamFor?.name;
  const lookupSportId = player?.sportId;
  const cardId = row._id;
  useEffect(() => {
    if (!lookupName || !lookupSportId) return;
    void requestTeamLookup({ cardId, name: lookupName, sportId: lookupSportId }).catch(() =>
      setAskFailedFor(lookupName),
    );
  }, [cardId, lookupName, lookupSportId, requestTeamLookup]);
  const teamLookup = useQuery(
    api.tidyNames.teamLookup,
    lookupName ? { cardId, name: lookupName } : "skip",
  );

  if (!player) return null;

  /** What the New team form is given from the lookup, plus Wikidata's own id for this stint's team. */
  const lookupProps = (entry: CareerEntry) => {
    const found = teamLookup?.status === "ready" ? teamLookup.enrichment : undefined;
    const carry: TeamLookupCarry | undefined = teamLookupCarryOf({
      ...(found ?? {}),
      ...(entry.wikidataId ? { wikidataId: entry.wikidataId } : {}),
    });
    return {
      espnLocation: found?.location,
      leagueSuggestion: found?.league,
      carry,
      lookupStatus:
        askFailedFor === entry.name ? ("error" as const) : (teamLookup?.status ?? ("pending" as const)),
    };
  };

  const keyOf = (e: CareerEntry) => `${e.name}|${e.fromYear}|${e.toYear ?? ""}`;
  const onPlayer = (teamId: string, fromYear: number) =>
    player.stints.some((s) => s.teamId === teamId && s.fromYear === fromYear);

  const add = (stint: { teamId: Id<"teams">; fromYear: number; toYear?: number }) =>
    write.run(
      () =>
        addStint({
          playerId: player.playerId,
          teamId: stint.teamId,
          fromYear: stint.fromYear,
          ...(stint.toYear !== undefined ? { toYear: stint.toYear } : {}),
          cardId: row._id,
        }),
      "Couldn't add that stint. Try again.",
    );

  const visible = careerTeams.filter((e) => !notNow.has(keyOf(e)));
  const addable = visible.filter((e) => {
    const r = resolved[keyOf(e)];
    return r?.kind === "known" && !onPlayer(r.teamId, e.fromYear);
  });
  const disabled = write.busy ? true : undefined;

  const addAll = () =>
    write.run(async () => {
      for (const e of addable) {
        const r = resolved[keyOf(e)];
        if (r?.kind !== "known") continue;
        await addStint({
          playerId: player.playerId,
          teamId: r.teamId,
          fromYear: e.fromYear,
          ...(e.toYear !== undefined ? { toYear: e.toYear } : {}),
          cardId: row._id,
        });
      }
    }, "Couldn't add those stints. Try again.");

  /** A year the operator typed for a team Wikidata gave without years. */
  const addUndated = async (entry: CareerEntry) => {
    setUndatedError(null);
    const found = await convex.query(api.teams.erasByNameAndSport, {
      name: entry.name,
      sportId: player.sportId,
    });
    const own = found.filter((t) => !t.viaAlias);
    const rows = own.length > 0 ? own : found;
    if (rows.length === 0) {
      setNewTeamFor(entry);
      return;
    }
    const pick = pickTeamForYear(rows, entry.fromYear);
    if (!pick) {
      setUndatedError(UNKNOWN_TEAM_AMBIGUOUS);
      return;
    }
    const ok = await add({
      teamId: pick.row._id,
      fromYear: entry.fromYear,
      ...(entry.toYear !== undefined ? { toYear: entry.toYear } : {}),
    });
    if (ok) setAddedUndated((prev) => new Set(prev).add(entry.name));
  };

  const undatedLeft = undated.filter((n) => !addedUndated.has(n));

  return (
    <div role="group" aria-label={`Career ${player.name}`} className="grid gap-2">
      <p className="text-sm text-ink wrap-anywhere">
        <span className="font-medium">{player.name}</span>{" "}
        <span>{visible.length > 0 ? "Career from Wikidata." : "No career from Wikidata."}</span>
      </p>

      {visible.length > 0 && (
        <ul className="grid gap-1.5" aria-label={`Wikidata career for ${player.name}`}>
          {visible.map((e) => {
            const key = keyOf(e);
            const r = resolved[key];
            const have = r?.kind === "known" && onPlayer(r.teamId, e.fromYear);
            return (
              <li key={key} className="grid gap-1">
                <CareerTeamResolver
                  entry={e}
                  sportId={player.sportId}
                  onResolved={(res) =>
                    setResolved((prev) =>
                      prev[key]?.kind === res.kind &&
                      (res.kind !== "known" || (prev[key] as { teamId?: string }).teamId === res.teamId)
                        ? prev
                        : { ...prev, [key]: res },
                    )
                  }
                />
                <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2 wrap-anywhere">
                  <span>{careerLineText(e.name, e.fromYear, e.toYear)}</span>
                  {have && <span className="text-neon-green-text">✓ in the career</span>}
                  {r?.kind === "known" && !have && <span className="text-ink-3">✓ team in NB</span>}
                  {r?.kind === "missing" && <span className="text-ink-3">team not in NB</span>}
                  {r?.kind === "ambiguous" && (
                    <span className="text-ink-3">{UNKNOWN_TEAM_AMBIGUOUS}</span>
                  )}
                </div>
                {r?.kind === "missing" &&
                  (newTeamFor === null || keyOf(newTeamFor) !== key ? (
                    <div className="flex flex-wrap gap-2">
                      <NeonButton
                        size="1"
                        variant="secondary"
                        aria-label={`+ New team ${e.name}`}
                        aria-disabled={disabled}
                        onClick={() => setNewTeamFor(e)}
                      >
                        + New team
                      </NeonButton>
                      <NeonButton
                        size="1"
                        variant="secondary"
                        outline
                        aria-label={`Not now ${e.name}`}
                        onClick={() => setNotNow((prev) => new Set(prev).add(key))}
                      >
                        Not now
                      </NeonButton>
                    </div>
                  ) : (
                    <InlineNewTeam
                      formKey={`career:${player.playerId}:${key}`}
                      sportId={player.sportId}
                      initialName={e.name}
                      {...lookupProps(e)}
                      neededBy={player.name}
                      createLabel="Create team and add stint"
                      createAriaLabel={(full, creating) =>
                        creating
                          ? `Creating team ${full}`
                          : full
                            ? `Create team ${full} and add stint`
                            : "Create team and add stint"
                      }
                      disabled={write.busy}
                      onCreated={async (teamId) => {
                        await addStint({
                          playerId: player.playerId,
                          teamId,
                          fromYear: e.fromYear,
                          ...(e.toYear !== undefined ? { toYear: e.toYear } : {}),
                          cardId: row._id,
                        });
                      }}
                      onClose={() => setNewTeamFor(null)}
                    />
                  ))}
              </li>
            );
          })}
        </ul>
      )}

      {undatedLeft.length > 0 && (
        <UndatedCareerTeams
          names={undatedLeft}
          disabled={write.busy}
          onOpenChange={setUndatedOpen}
          onAdd={(entry) => void addUndated(entry)}
        />
      )}
      {undatedError && (
        <p role="alert" className="text-xs text-neon-pink-text">
          {undatedError}
        </p>
      )}
      {newTeamFor !== null && !visible.some((e) => keyOf(e) === keyOf(newTeamFor)) && (
        <InlineNewTeam
          formKey={`career:${player.playerId}:undated:${newTeamFor.name}`}
          sportId={player.sportId}
          initialName={newTeamFor.name}
          {...lookupProps(newTeamFor)}
          neededBy={player.name}
          createLabel="Create team and add stint"
          createAriaLabel={(full, creating) =>
            creating
              ? `Creating team ${full}`
              : full
                ? `Create team ${full} and add stint`
                : "Create team and add stint"
          }
          disabled={write.busy}
          onCreated={async (teamId) => {
            await addStint({
              playerId: player.playerId,
              teamId,
              fromYear: newTeamFor.fromYear,
              ...(newTeamFor.toYear !== undefined ? { toYear: newTeamFor.toYear } : {}),
              cardId: row._id,
            });
            setAddedUndated((prev) => new Set(prev).add(newTeamFor.name));
          }}
          onClose={() => setNewTeamFor(null)}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {addable.length > 0 && (
          <NeonButton
            size="1"
            aria-label={`Add stints to ${player.name}`}
            aria-disabled={disabled}
            onClick={() => void addAll()}
          >
            {`Add stints to ${player.name}`}
          </NeonButton>
        )}
        <AddStintEntry
          playerName={player.name}
          sportId={player.sportId}
          leafId={leafId}
          disabled={write.busy}
          onAdd={(entry) =>
            add({
              teamId: entry.teamId,
              fromYear: entry.fromYear,
              ...(entry.toYear !== undefined ? { toYear: entry.toYear } : {}),
            })
          }
        />
      </div>
    </div>
  );
}

/**
 * Looks up one Wikidata career team in NeonBinder and reports what it is. A
 * component of its own because each line asks its own question
 * (`teams.erasByNameAndSport`) and a hook cannot run in a loop. Renders nothing.
 *
 * The stint's year picks the era (`pickTeamForYear`): a stint is a season the
 * player played, so a lone row dated after the year is not that team. Nothing
 * held under the name is "missing"; several that no year separates are
 * "ambiguous", and neither is ever guessed.
 */
function CareerTeamResolver({
  entry,
  sportId,
  onResolved,
}: {
  entry: CareerEntry;
  sportId: Id<"selectorOptions">;
  onResolved: (res: Resolution) => void;
}) {
  const eras = useQuery(api.teams.erasByNameAndSport, { name: entry.name, sportId });
  useEffect(() => {
    if (eras === undefined) return;
    const own = eras.filter((t) => !t.viaAlias);
    const rows = own.length > 0 ? own : eras;
    if (rows.length === 0) {
      onResolved({ kind: "missing" });
      return;
    }
    const pick = pickTeamForYear(rows, entry.fromYear);
    onResolved(pick ? { kind: "known", teamId: pick.row._id } : { kind: "ambiguous" });
  }, [eras, entry.fromYear, onResolved]);
  return null;
}
