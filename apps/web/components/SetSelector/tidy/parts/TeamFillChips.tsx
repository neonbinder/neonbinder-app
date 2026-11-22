import { useMemo, useRef, useState } from "react";
import { CheckIcon } from "@heroicons/react/16/solid";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MAX_CARD_TEAMS, teamFillOf } from "../../../../convex/features/cardAttention";
import { idSetKey } from "../../../../convex/lib/teamFill";
import { leagueShortName, teamDetailLine } from "../../../../lib/teams/team-detail";
import { teamOptionLabel } from "../../../../lib/teams/team-era";
import { teamFullName } from "../../../../lib/teams/team-name";
import NeonButton from "../../../modules/NeonButton";
import EntityLinkSearch from "../../EntityLinkSearch";
import { useAnswered } from "../answered";
import { useInlinePart } from "../inline-stack";
import type { TidyCardContext, TidyRow } from "../tile-types";
import { careerHeading, chipYearsText, marketplaceHeading, outcomeHeading, playedHere } from "./copy";
import InlineNewTeam from "./InlineNewTeam";
import { buildTeamLine, type PlayerEvidence, type TeamHold } from "./team-line";
import type { TidyWrite } from "./tidy-write";

type ContextPlayer = NonNullable<TidyCardContext>["players"][number];

type TeamChip = {
  teamId: Id<"teams">;
  label: string;
  playerNames: string[];
};

/** `teamSuggestionsForPreview` answers for at most this many players; a card has a handful. */
const EVIDENCE_MAX_PLAYERS = 32;

/**
 * NEO-645 — a card with NO team: the chips, the search, New team, and "No team
 * on this card".
 *
 * The chips are main's Tidy Up wizard's, rule for rule (`team-line.ts`):
 *
 *  - The tiers: the checklist's other cards with the same player set and a team
 *    (batch), then, per player, his stored cards and his career window
 *    (`cardChecklist.teamSuggestionsForPreview`, the wizard's own query). Every
 *    player must answer for anything to be preselected.
 *  - A data claim holds the guess back (rule 8): the listing naming a team
 *    (`bscTeamName`), the publisher's checklist settling the card
 *    (`teamCheckOutcome: "checklist"`), or the set's own "No Team" (`setNoTeam`,
 *    NEO-639 decision A). Nothing is preselected over a claim, even when the
 *    career agrees with it; the listing's NB teams are offered first, then the
 *    evidence's teams. A lookup that failed or never ran is not a claim.
 *  - A chip that is not preselected carries the players' years with that team
 *    ("2024–present"; the player's name only when several are on the card). The
 *    label follows the pre-fill, never the current pick, so a toggle never
 *    changes it.
 *
 * Nothing is written until Save (`updateCard`, which sets the teams on the card
 * through the one writer) or "No team on this card" (`confirmCardNoTeam`).
 */
export default function TeamFillChips({
  row,
  sportId,
  leafId,
  players,
  leafCards,
  write,
  setNoTeam = false,
}: {
  row: TidyRow;
  sportId: Id<"selectorOptions"> | undefined;
  leafId: Id<"selectorOptions">;
  players: readonly ContextPlayer[];
  /** The whole checklist: the batch tier reads the other cards of this player set. */
  leafCards: readonly TidyRow[];
  write: TidyWrite;
  /** The set's own team default is "No Team" (NEO-639 decision A). */
  setNoTeam?: boolean;
}) {
  const playerIds = useMemo(
    () => [...new Set<string>(row.playerIds ?? [])].slice(0, EVIDENCE_MAX_PLAYERS),
    [row.playerIds],
  );
  const evidenceRes = useQuery(
    api.cardChecklist.teamSuggestionsForPreview,
    playerIds.length > 0
      ? {
          selectorOptionId: leafId,
          players: playerIds.map((playerId) => ({ playerId: playerId as Id<"players"> })),
        }
      : "skip",
  );
  const evidence = useMemo(
    () =>
      evidenceRes
        ? new Map<string, PlayerEvidence>(
            playerIds.flatMap((id, i) => (evidenceRes.players[i] ? [[id, evidenceRes.players[i]] as const] : [])),
          )
        : undefined,
    [evidenceRes, playerIds],
  );
  const bscName = row.bscTeamName?.trim() ?? "";
  const bscLookedUp = bscName !== "" && sportId !== undefined;
  const bscEras = useQuery(
    api.teams.erasByNameAndSport,
    bscLookedUp ? { name: bscName, sportId } : "skip",
  );
  const bscSettled = !bscLookedUp || bscEras !== undefined;
  const updateCard = useMutation(api.selectorOptions.updateCard);
  const confirmCardNoTeam = useMutation(api.cardChecklist.confirmCardNoTeam);

  const [teamIds, setTeamIds] = useState<Array<Id<"teams">> | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const otherRef = useRef<HTMLButtonElement | null>(null);
  const newRef = useRef<HTMLButtonElement | null>(null);
  const saveRef = useRef<HTMLButtonElement | null>(null);
  const searchScopeRef = useRef<HTMLDivElement | null>(null);
  const answered = useAnswered();
  // Cancel and Esc hand focus back to "Other team…". A pick or a created team
  // is NOT an answer yet (Save team is), so it goes to Save team instead: one
  // more Enter there saves, where Other team… would only reopen the search.
  const closeSearch = () => {
    setSearchOpen(false);
    requestAnimationFrame(() => otherRef.current?.focus({ preventScroll: true }));
  };
  const focusSave = () => requestAnimationFrame(() => saveRef.current?.focus({ preventScroll: true }));
  const createdRef = useRef(false);
  useInlinePart(searchOpen, closeSearch, searchScopeRef);

  // Batch: the distinct team sets the checklist's OTHER cards of this player set carry.
  const batchSets = useMemo(() => {
    if (playerIds.length === 0) return [];
    const key = idSetKey(playerIds);
    const sets = new Map<string, Array<Id<"teams">>>();
    for (const card of leafCards) {
      if (card._id === row._id) continue;
      const teams = card.teamOnCardIds ?? [];
      // A team NB filled itself is a guess, never evidence for the next card.
      if (teams.length === 0 || teamFillOf(card) || idSetKey(card.playerIds ?? []) !== key) continue;
      const teamKey = idSetKey(teams);
      if (!sets.has(teamKey)) sets.set(teamKey, [...new Set(teams)]);
    }
    return [...sets.values()];
  }, [leafCards, playerIds, row._id]);

  // The claim standing on the card, if any (rule 8). A failed lookup is none.
  const held: TeamHold | null = setNoTeam
    ? "setNoTeam"
    : bscName !== ""
      ? "listing"
      : row.teamCheckOutcome === "checklist"
        ? "checklist"
        : null;
  const line = useMemo(
    () =>
      buildTeamLine({
        playerIds,
        evidence,
        batchSets,
        held,
        setYear: evidenceRes?.setYear ?? null,
      }),
    [playerIds, evidence, batchSets, held, evidenceRes?.setYear],
  );

  // Teams a chip names that the server's evidence did not (batch), plus every
  // chip's row, so two chips of one name can be told apart by era.
  const optionIds = useMemo(() => line.options.map((o) => o.teamId), [line.options]);
  const marketplaceChips = useMemo<TeamChip[]>(
    () =>
      (bscLookedUp ? (bscEras ?? []) : []).map((era) => ({
        teamId: era._id,
        label: era.label,
        playerNames: [],
      })),
    [bscLookedUp, bscEras],
  );
  const marketplaceIds = useMemo(
    () => new Set<string>(marketplaceChips.map((c) => c.teamId as string)),
    [marketplaceChips],
  );
  const optionRows = useQuery(
    api.teams.getManyByIds,
    optionIds.length > 0 ? { ids: [...optionIds].sort() } : "skip",
  );
  const playerNameById = useMemo(
    () => new Map(players.map((p) => [p.playerId as string, p.name] as const)),
    [players],
  );
  const careerChips = useMemo<TeamChip[]>(() => {
    const rows = new Map((optionRows ?? []).map((t) => [t._id as string, t] as const));
    const chips = line.options
      .filter((o) => !marketplaceIds.has(o.teamId as string))
      .map((o) => {
        const row = rows.get(o.teamId as string);
        return {
          teamId: o.teamId,
          name: o.name ?? (row ? teamFullName(row) : "Team"),
          era: row?.yearsActive,
          playerNames: o.playerIds.flatMap((id) => playerNameById.get(id) ?? []),
        };
      });
    const count = new Map<string, number>();
    for (const c of chips) count.set(c.name, (count.get(c.name) ?? 0) + 1);
    return chips.map((c) => ({
      teamId: c.teamId,
      label: (count.get(c.name) ?? 0) > 1 ? teamOptionLabel(c.name, c.era) : c.name,
      playerNames: c.playerNames,
    }));
  }, [line.options, optionRows, marketplaceIds, playerNameById]);

  // The pre-fill. Only what the tiers give, never against a standing claim.
  const preselect = useMemo(
    () => line.suggestion.slice(0, MAX_CARD_TEAMS),
    [line.suggestion],
  );
  const ready = !line.loading && bscSettled;

  // Untouched, the chosen teams ARE the pre-fill; the first press makes them the operator's.
  const chosen = useMemo(() => teamIds ?? (ready ? preselect : []), [teamIds, ready, preselect]);
  const chosenSet = useMemo(() => new Set(chosen as unknown as string[]), [chosen]);
  const atCap = chosen.length >= MAX_CARD_TEAMS;
  const chipIds = useMemo(
    () => new Set<string>([...marketplaceChips, ...careerChips].map((c) => c.teamId as string)),
    [marketplaceChips, careerChips],
  );
  // Picked with Other team… or created here: not a chip, but chosen.
  const extraIds = chosen.filter((id) => !chipIds.has(id as string));
  const extraRows = useQuery(
    api.teams.getManyByIds,
    extraIds.length > 0 ? { ids: [...extraIds].sort() } : "skip",
  );
  // NEO-645 — a team picked with Other team… shows its league and years, so three
  // "Baltimore Orioles" can be told apart once one is chosen.
  const extraLeagues = useQuery(
    api.leagues.list,
    extraIds.length > 0 && sportId ? { sportId } : "skip",
  );

  // The players' years with a team, as main's wizard printed them: one player's
  // bare, several players' named, only those with a dated stint there.
  const yearsWith = (teamId: Id<"teams">): string =>
    chipYearsText(
      playerIds.map((id, i) => ({
        name: playerNameById.get(id) ?? "Player",
        stints: (evidenceRes?.players[i]?.stints ?? []).filter((s) => s.teamId === teamId),
      })),
    );

  const toggle = (teamId: Id<"teams">) => {
    if (chosenSet.has(teamId as string)) setTeamIds(chosen.filter((id) => id !== teamId));
    else if (!atCap) setTeamIds([...chosen, teamId]);
  };
  const addChosen = (teamId: Id<"teams">) => {
    if (chosenSet.has(teamId as string) || atCap) return;
    setTeamIds([...chosen, teamId]);
  };

  const disabled = write.busy ? true : undefined;
  const canSave = chosen.length > 0 && !write.busy;

  const save = async () => {
    const ok = await write.run(
      () => updateCard({ id: row._id, teamOnCardIds: chosen }),
      "Couldn't save those teams. Try again.",
    );
    if (ok) answered();
  };

  const recordNoTeam = async () => {
    const ok = await write.run(async () => {
      const result = await confirmCardNoTeam({ cardId: row._id });
      if (!result.confirmed) {
        throw new Error(
          "This card has teams now, or it is no longer on this checklist, so there's nothing to confirm.",
        );
      }
    }, "Couldn't record that. Try again.");
    if (ok) answered();
  };

  const caseLine = outcomeHeading(row.teamCheckOutcome, bscName !== "");

  const renderChip = (chip: TeamChip, opts: { suffix?: string }) => {
    const on = chosenSet.has(chip.teamId as string);
    const blocked = !on && atCap;
    return (
      <li key={chip.teamId as string} className="max-w-full">
        <button
          type="button"
          aria-pressed={on}
          aria-disabled={blocked || write.busy || undefined}
          onClick={() => {
            if (blocked || write.busy) return;
            toggle(chip.teamId);
          }}
          className={`hit-area-24 inline-flex max-w-full flex-col items-start gap-0 border px-2 py-0.5 text-left text-xs focus-outline ${
            opts.suffix ? "rounded-2xl" : "rounded-full"
          } ${
            on
              ? "border-neon-green-text bg-neon-green/20 text-neon-green-text"
              : "border-control bg-raised text-ink-2 hover:border-neon-blue-text hover:text-neon-blue-text"
          } ${blocked ? "opacity-40" : ""}`}
        >
          <span className="inline-flex items-center gap-1">
            {/* The chosen mark that is not a colour (SC 1.4.1); aria-pressed says it to a reader. */}
            {on && <CheckIcon aria-hidden="true" className="h-3 w-3 shrink-0" />}
            {chip.label}
          </span>
          {/* NEO-645: the years (every player's, merged) get their own line, so a
              long list wraps inside the chip at 320px and is never clipped. The
              dot stays in the accessible name ("Team · Player 1967–1983") as a
              reader-only separator. */}
          {opts.suffix && (
            <span className="block max-w-full text-ink-2 wrap-anywhere">
              <span className="sr-only"> · </span>
              {opts.suffix}
            </span>
          )}
        </button>
      </li>
    );
  };

  /** "Jimmie Foxx played here" when it is preselected; the players' years when it is not. */
  const chipSuffix = (chip: TeamChip): string | undefined => {
    const years = yearsWith(chip.teamId);
    if (preselect.includes(chip.teamId)) {
      return chip.playerNames.length > 0 ? playedHere(chip.playerNames) : undefined;
    }
    if (years) return years;
    return chip.playerNames.length > 0 ? playedHere(chip.playerNames) : undefined;
  };

  return (
    <div className="grid gap-2" aria-busy={write.busy || undefined}>
      {caseLine && <p className="text-xs text-ink-2">{caseLine}</p>}

      {marketplaceChips.length > 0 && (
        <div className="grid gap-1">
          <p id={`fill-listing-${row._id}`} className="text-xs text-ink-2">
            {marketplaceHeading(bscName, marketplaceChips.length)}
          </p>
          <ul className="flex flex-wrap gap-1.5" aria-labelledby={`fill-listing-${row._id}`}>
            {marketplaceChips.map((chip) =>
              renderChip(chip, { suffix: chipSuffix(chip) }),
            )}
          </ul>
        </div>
      )}

      {careerChips.length > 0 && (
        <div className="grid gap-1">
          <p id={`fill-career-${row._id}`} className="text-xs text-ink-2">
            {careerHeading(preselect.length > 0, {
              tie: line.tie,
              ...(line.uncoveredSetYear !== undefined ? { uncoveredSetYear: line.uncoveredSetYear } : {}),
              noYear: line.noYear,
              disagree: line.disagree,
              held: line.held,
              otherCards: line.source === "otherCards",
            })}
          </p>
          <ul className="flex flex-wrap gap-1.5" aria-labelledby={`fill-career-${row._id}`}>
            {careerChips.map((chip) =>
              renderChip(chip, { suffix: chipSuffix(chip) }),
            )}
          </ul>
        </div>
      )}

      {/* The listing's string is plain text, never an anchor or a title: it is
          untrusted content on an admin screen. Held back while the era lookup is
          in flight, so it does not flash up and then turn into chips. */}
      {bscName !== "" && bscSettled && marketplaceChips.length === 0 && (
        <p className="text-xs text-ink-3">
          The listing says: <span className="text-ink-2">{row.bscTeamName}</span>
        </p>
      )}

      {extraIds.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Teams you added">
          {extraIds.map((id) => {
            const team = extraRows?.find((t) => t._id === id);
            const league = team?.leagueId
              ? extraLeagues?.find((l) => l._id === team.leagueId)
              : undefined;
            const detail = team ? teamDetailLine(league ? leagueShortName(league) : undefined, team.yearsActive) : "";
            return renderChip(
              {
                teamId: id,
                label: team ? teamFullName(team) : "Team",
                playerNames: [],
                },
              { suffix: detail || undefined },
            );
          })}
        </ul>
      )}

      {/* Mounted for the life of the chips, so reaching the limit is a change to a
          live region already in the page, and a card that opens at it says nothing. */}
      <p role="status" className="text-xs text-ink-2 empty:hidden">
        {atCap ? `That is the limit of ${MAX_CARD_TEAMS} teams on one card. Remove one to add another.` : ""}
      </p>

      {searchOpen && sportId ? (
        <div ref={searchScopeRef}>
          <EntityLinkSearch
            kind="team"
            sportId={sportId}
            contextOptionId={leafId}
            onSelect={(id) => {
              addChosen(id as Id<"teams">);
              setSearchOpen(false);
              focusSave();
            }}
            onCancel={closeSearch}
          />
        </div>
      ) : null}

      {newOpen && sportId ? (
        <InlineNewTeam
          formKey={`fill:${row._id}`}
          sportId={sportId}
          initialName=""
          createLabel="Create team"
          createAriaLabel={(full, creating) =>
            creating ? `Creating team ${full}` : full ? `Create team ${full}` : "Create team"
          }
          disabled={write.busy}
          onCreated={(teamId) => {
            createdRef.current = true;
            addChosen(teamId);
          }}
          onClose={() => {
            setNewOpen(false);
            // A created team goes to Save team; Cancel and Esc go back to "+ New team".
            const created = createdRef.current;
            createdRef.current = false;
            if (created) focusSave();
            else requestAnimationFrame(() => newRef.current?.focus({ preventScroll: true }));
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {/* Nothing chosen, nothing to save: the button appears with the first chip
              (a press on a chip or a team picked with Other team… / New team). */}
          {chosen.length > 0 && (
            <NeonButton
              ref={saveRef}
              size="1"
              aria-disabled={canSave ? undefined : true}
              onClick={() => {
                if (canSave) void save();
              }}
            >
              {write.busy ? "Saving…" : chosen.length > 1 ? "Save teams" : "Save team"}
            </NeonButton>
          )}
          {sportId && !searchOpen && (
            <NeonButton
              ref={otherRef}
              size="1"
              variant="secondary"
              outline
              aria-disabled={disabled}
              onClick={() => setSearchOpen(true)}
            >
              Other team…
            </NeonButton>
          )}
          {sportId && (
            <NeonButton
              ref={newRef}
              size="1"
              variant="secondary"
              aria-disabled={disabled}
              onClick={() => setNewOpen(true)}
            >
              + New team
            </NeonButton>
          )}
          <NeonButton
            size="1"
            variant="secondary"
            aria-disabled={disabled}
            onClick={() => void recordNoTeam()}
          >
            No team on this card
          </NeonButton>
        </div>
      )}
    </div>
  );
}
