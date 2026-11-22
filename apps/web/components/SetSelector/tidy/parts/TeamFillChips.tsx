import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MAX_CARD_TEAMS } from "../../../../convex/features/cardAttention";
import { teamFullName } from "../../../../lib/teams/team-name";
import NeonButton from "../../../modules/NeonButton";
import EntityLinkSearch from "../../EntityLinkSearch";
import { useInlinePart } from "../inline-stack";
import type { TidyCardContext, TidyRow } from "../tile-types";
import { careerHeading, marketplaceHeading, outcomeHeading, playedHere, stintYears } from "./copy";
import InlineNewTeam from "./InlineNewTeam";
import type { TidyWrite } from "./tidy-write";

type ContextPlayer = NonNullable<TidyCardContext>["players"][number];

type TeamChip = {
  teamId: Id<"teams">;
  label: string;
  playerNames: string[];
  inSetYear: boolean;
};

/**
 * NEO-645 — a card with NO team: the chips, the search, New team, and "No team
 * on this card".
 *
 * Lifted from the retired `MissingTeamFixer` (NEO-330 / NEO-345), with its
 * pre-fill rules intact:
 *
 *  - The listing's team (`bscTeamName`) is the listing's CLAIM, shown as the
 *    rows NB holds under that name. It is never written as NB data.
 *  - A career chip is preselected only when a stint COVERS the set's year, and
 *    never when the listing names a team the career does not (rule 8: a data
 *    claim holds back a guess). A lookup that failed or never ran is not a
 *    claim: with no listing name, the career pre-fills as usual.
 *  - A chip that is not preselected carries the player's years with that team,
 *    so the operator can choose.
 *
 * Nothing is written until Save (`updateCard`, which sets the teams on the card
 * through the one writer) or "No team on this card" (`confirmCardNoTeam`).
 */
export default function TeamFillChips({
  row,
  sportId,
  leafId,
  players,
  write,
}: {
  row: TidyRow;
  sportId: Id<"selectorOptions"> | undefined;
  leafId: Id<"selectorOptions">;
  players: readonly ContextPlayer[];
  write: TidyWrite;
}) {
  const suggestions = useQuery(api.cardChecklist.suggestedTeamsForCard, { cardId: row._id });
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
  useInlinePart(searchOpen, () => {
    setSearchOpen(false);
    requestAnimationFrame(() => otherRef.current?.focus({ preventScroll: true }));
  });

  const careerByTeam = useMemo(() => {
    const byTeam = new Map<string, TeamChip>();
    for (const s of suggestions ?? []) {
      const existing = byTeam.get(s.teamId as string);
      if (existing) {
        if (!existing.playerNames.includes(s.playerName)) existing.playerNames.push(s.playerName);
        existing.inSetYear = existing.inSetYear || s.inSetYear;
      } else {
        byTeam.set(s.teamId as string, {
          teamId: s.teamId,
          label: s.label,
          playerNames: [s.playerName],
          inSetYear: s.inSetYear,
        });
      }
    }
    return byTeam;
  }, [suggestions]);
  const uncoveredSetYear = (suggestions ?? []).find((s) => s.uncoveredSetYear !== undefined)
    ?.uncoveredSetYear;

  const marketplaceChips = useMemo<TeamChip[]>(
    () =>
      (bscLookedUp ? (bscEras ?? []) : []).map((era) => {
        const career = careerByTeam.get(era._id as string);
        return {
          teamId: era._id,
          label: era.label,
          playerNames: career?.playerNames ?? [],
          inSetYear: career?.inSetYear ?? false,
        };
      }),
    [bscLookedUp, bscEras, careerByTeam],
  );
  const marketplaceIds = useMemo(
    () => new Set<string>(marketplaceChips.map((c) => c.teamId as string)),
    [marketplaceChips],
  );
  const careerChips = useMemo(
    () => [...careerByTeam.values()].filter((c) => !marketplaceIds.has(c.teamId as string)),
    [careerByTeam, marketplaceIds],
  );

  // The pre-fill rule. Only a stint covering the set's year, never against a
  // team the listing named.
  const setYearTeamIds = useMemo(
    () => [...careerByTeam.values()].filter((c) => c.inSetYear).map((c) => c.teamId),
    [careerByTeam],
  );
  const bscDisagrees =
    bscName !== "" && setYearTeamIds.some((id) => !marketplaceIds.has(id as string));
  const preselect = useMemo(
    () => (bscDisagrees ? [] : setYearTeamIds.slice(0, MAX_CARD_TEAMS)),
    [bscDisagrees, setYearTeamIds],
  );
  const ready = suggestions !== undefined && bscSettled;

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

  const yearsWith = (teamId: Id<"teams">): string => {
    for (const p of players) {
      const stint = p.stints.find((s) => s.teamId === teamId && s.fromYear !== undefined);
      if (stint) return `${p.name} ${stintYears(stint)}`;
    }
    return "";
  };

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

  const save = () =>
    write.run(
      () => updateCard({ id: row._id, teamOnCardIds: chosen }),
      "Couldn't save those teams. Try again.",
    );

  const recordNoTeam = () =>
    write.run(async () => {
      const result = await confirmCardNoTeam({ cardId: row._id });
      if (!result.confirmed) {
        throw new Error(
          "This card has teams now, or it is no longer on this checklist, so there's nothing to confirm.",
        );
      }
    }, "Couldn't record that. Try again.");

  const caseLine = outcomeHeading(row.teamCheckOutcome, bscName !== "");

  const renderChip = (chip: TeamChip, opts: { suffix?: string }) => {
    const on = chosenSet.has(chip.teamId as string);
    const blocked = !on && atCap;
    return (
      <li key={chip.teamId as string}>
        <button
          type="button"
          aria-pressed={on}
          aria-disabled={blocked || write.busy || undefined}
          onClick={() => {
            if (blocked || write.busy) return;
            toggle(chip.teamId);
          }}
          className={`rounded-full border px-2 py-0.5 text-xs focus-outline ${
            on
              ? "border-neon-green-text bg-neon-green/20 text-neon-green-text"
              : "border-control bg-raised text-ink-2 hover:border-neon-blue-text hover:text-neon-blue-text"
          } ${blocked ? "opacity-40" : ""}`}
        >
          {chip.label}
          {opts.suffix && <span className="text-neon-blue-text">{opts.suffix}</span>}
        </button>
      </li>
    );
  };

  /** "· Jimmie Foxx played here" when it is preselected; the player's years when it is not. */
  const chipSuffix = (chip: TeamChip): string | undefined => {
    const years = yearsWith(chip.teamId);
    if (preselect.includes(chip.teamId)) {
      return chip.playerNames.length > 0 ? ` · ${playedHere(chip.playerNames)}` : undefined;
    }
    if (years) return ` · ${years}`;
    return chip.playerNames.length > 0 ? ` · ${playedHere(chip.playerNames)}` : undefined;
  };

  return (
    <div className="grid gap-2" aria-busy={write.busy || undefined}>
      {caseLine && <p className="text-xs text-ink-2">{caseLine}</p>}

      {marketplaceChips.length > 0 && (
        <div className="grid gap-1">
          <p id={`fill-listing-${row._id}`} className="text-xs text-neon-blue-text">
            {marketplaceHeading(
              bscName,
              marketplaceChips.length,
              marketplaceChips.some((c) => preselect.includes(c.teamId)),
            )}
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
          <p id={`fill-career-${row._id}`} className="text-xs text-neon-blue-text">
            {careerHeading(
              careerChips.some((c) => c.inSetYear),
              bscDisagrees,
              uncoveredSetYear,
            )}
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
            return renderChip(
              {
                teamId: id,
                label: team ? teamFullName(team) : "Team",
                playerNames: [],
                inSetYear: false,
              },
              {},
            );
          })}
        </ul>
      )}

      {atCap && (
        <p role="status" className="text-xs text-neon-blue-text">
          That is the limit of {MAX_CARD_TEAMS} teams on one card. Remove one to add another.
        </p>
      )}

      {searchOpen && sportId ? (
        <EntityLinkSearch
          kind="team"
          sportId={sportId}
          contextOptionId={leafId}
          onSelect={(id) => {
            addChosen(id as Id<"teams">);
            setSearchOpen(false);
            requestAnimationFrame(() => otherRef.current?.focus({ preventScroll: true }));
          }}
          onCancel={() => {
            setSearchOpen(false);
            requestAnimationFrame(() => otherRef.current?.focus({ preventScroll: true }));
          }}
        />
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
          onCreated={(teamId) => addChosen(teamId)}
          onClose={() => {
            setNewOpen(false);
            requestAnimationFrame(() => newRef.current?.focus({ preventScroll: true }));
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <NeonButton
            size="1"
            aria-disabled={canSave ? undefined : true}
            onClick={() => {
              if (canSave) void save();
            }}
          >
            {write.busy ? "Saving…" : chosen.length > 1 ? "Save teams" : "Save team"}
          </NeonButton>
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
