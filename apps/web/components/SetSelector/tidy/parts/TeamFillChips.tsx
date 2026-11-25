import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MAX_CARD_TEAMS } from "../../../../convex/features/cardAttention";
import { idSetKey } from "../../../../convex/lib/teamFill";
import { teamOptionLabel } from "../../../../lib/teams/team-era";
import { teamFullName } from "../../../../lib/teams/team-name";
import NeonButton from "../../../modules/NeonButton";
import EntityLinkSearch from "../../EntityLinkSearch";
import { useAnswered } from "../answered";
import { useInlinePart } from "../inline-stack";
import type { TidyCardContext, TidyRow } from "../tile-types";
import { careerHeading, chipYearsText, marketplaceHeading, outcomeHeading, playedHere } from "./copy";
import InlineNewTeam from "./InlineNewTeam";
import TeamChipButton from "./TeamChip";
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
 * Clicking a team saves it (`updateCard`, which sets the teams on the card
 * through the one writer), a chip, a team picked with Other team… or one made
 * with + New team alike. "No team on this card" writes `confirmCardNoTeam`. A
 * second team is added after the save, with the tile's "+ Another team".
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

  const [searchOpen, setSearchOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const otherRef = useRef<HTMLButtonElement | null>(null);
  const newRef = useRef<HTMLButtonElement | null>(null);
  const searchScopeRef = useRef<HTMLDivElement | null>(null);
  const answered = useAnswered();
  // Cancel and Esc hand focus back to "Other team…".
  const closeSearch = () => {
    setSearchOpen(false);
    requestAnimationFrame(() => otherRef.current?.focus({ preventScroll: true }));
  };
  useInlinePart(searchOpen, closeSearch, searchScopeRef);

  // Batch: the distinct team sets the checklist's OTHER cards of this player set carry.
  const batchSets = useMemo(() => {
    if (playerIds.length === 0) return [];
    const key = idSetKey(playerIds);
    const sets = new Map<string, Array<Id<"teams">>>();
    for (const card of leafCards) {
      if (card._id === row._id) continue;
      const teams = card.teamOnCardIds ?? [];
      // A team on a card is the card's team, whoever wrote it (NEO-656, J8).
      if (teams.length === 0 || idSetKey(card.playerIds ?? []) !== key) continue;
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
  // The "Looking up teams…" sentence goes in a tick after the status node
  // mounts, so a reader sees a change to a live region that is already in the page.
  const [announce, setAnnounce] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAnnounce(true), 0);
    return () => clearTimeout(t);
  }, []);

  // The pre-fill shows as the chosen chips; a click saves the team it names.
  const chosenSet = useMemo(
    () => new Set((ready ? preselect : []) as unknown as string[]),
    [ready, preselect],
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

  const disabled = write.busy ? true : undefined;

  /** "Padres", "Padres and Mets", "Padres, Mets and Cubs". */
  const joinLabels = (labels: readonly string[]): string =>
    labels.length <= 1
      ? (labels[0] ?? "")
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;

  /**
   * Writes the teams on the card (the one writer, `updateCard`). A click on a
   * preselected chip writes EVERY preselected team (what main's Save wrote
   * untouched); a click on any other chip, Other team… and + New team write the
   * one team. On success the walk's own live region says what was saved: the
   * tile is gone by then.
   */
  const save = async (teamIds: readonly Id<"teams">[], labels: readonly string[] = []) => {
    const ok = await write.run(
      () => updateCard({ id: row._id, teamOnCardIds: [...teamIds], regenerateListing: true }),
      "Couldn't save those teams. Try again.",
    );
    if (ok) answered(labels.length > 0 ? `Saved ${joinLabels(labels)}.` : "Saved the team.");
  };

  const chipLabelOf = (teamId: Id<"teams">): string =>
    [...marketplaceChips, ...careerChips].find((c) => c.teamId === teamId)?.label ?? "the team";

  const recordNoTeam = async () => {
    const ok = await write.run(async () => {
      const result = await confirmCardNoTeam({ cardId: row._id, regenerateListing: true });
      if (!result.confirmed) {
        throw new Error(
          "This card has teams now, or it is no longer on this checklist, so there's nothing to confirm.",
        );
      }
    }, "Couldn't record that. Try again.");
    if (ok) answered();
  };

  const caseLine = outcomeHeading(row.teamCheckOutcome, bscName !== "");

  // Two or more preselected chips save together, and a click on any one says so
  // to a reader (it describes the chip; the chip's name is unchanged).
  const togetherId = `fill-together-${row._id}`;
  const savesTogether =
    [...marketplaceChips, ...careerChips].filter((c) => chosenSet.has(c.teamId as string)).length >= 2;

  const renderChip = (chip: TeamChip, opts: { suffix?: string }) => {
    const on = chosenSet.has(chip.teamId as string);
    // The accessible name, built from the visible parts. An absolutely
    // positioned sr-only span inside the text makes Chromium pad it with
    // spaces ("Team , suggested"), so the name is stated whole instead:
    // "<Team>, suggested · <player> played here" (or "<Team>, suggested").
    const accessibleName = `${chip.label}${on ? ", suggested" : ""}${opts.suffix ? ` · ${opts.suffix}` : ""}`;
    return (
      <li key={chip.teamId as string} className="max-w-full">
        <TeamChipButton
          label={chip.label}
          on={on}
          suffix={opts.suffix}
          accessibleName={accessibleName}
          busy={write.busy}
          describedBy={on && savesTogether ? togetherId : undefined}
          onClick={() => {
            // A preselected chip stands for the whole pre-fill; any other is one team.
            const teams = on ? preselect : [chip.teamId];
            void save(teams, teams.map(chipLabelOf));
          }}
        />
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
      {/* NEO-661: the status node is in the page empty on the first commit and
          the sentence is put in a tick later (this part mounts with the
          loading already under way, so text rendered with the node is often
          skipped by a reader). Shown only while the suggestions are loading;
          the buttons below stay pressable. */}
      <p role="status" className="text-xs italic text-ink-3 empty:hidden">
        {announce && !ready ? "Looking up teams…" : null}
      </p>
      {savesTogether && (
        <p id={togetherId} className="sr-only">
          Suggested teams save together.
        </p>
      )}

      {marketplaceChips.length > 0 && (
        <div className="grid gap-1">
          <p id={`fill-listing-${row._id}`} className="text-xs text-ink-2">
            {marketplaceHeading(bscName, marketplaceChips.length)}
          </p>
          <ul role="list" className="flex flex-wrap gap-1.5" aria-labelledby={`fill-listing-${row._id}`} aria-busy={ready ? undefined : true}>
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
          <ul role="list" className="flex flex-wrap gap-1.5" aria-labelledby={`fill-career-${row._id}`} aria-busy={ready ? undefined : true}>
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

      {searchOpen && sportId ? (
        <div ref={searchScopeRef}>
          <EntityLinkSearch
            kind="team"
            sportId={sportId}
            contextOptionId={leafId}
            onSelect={(id, name) => {
              setSearchOpen(false);
              void save([id as Id<"teams">], name ? [name] : []);
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
          onCreated={(teamId) => save([teamId])}
          onClose={() => {
            setNewOpen(false);
            requestAnimationFrame(() => newRef.current?.focus({ preventScroll: true }));
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
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
