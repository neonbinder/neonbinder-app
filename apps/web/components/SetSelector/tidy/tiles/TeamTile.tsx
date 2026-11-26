import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MAX_CARD_TEAMS } from "../../../../convex/features/cardAttention";
import { normalizeEntityName } from "@/lib/entities/normalize-name";
import { hasTeamLine, isTeamlessOnLine, teamLineKey } from "../../../../convex/lib/teamLine";
import NeonButton from "../../../modules/NeonButton";
import { useFieldToast } from "../../CardDetailFields";
import EntityLinkSearch from "../../EntityLinkSearch";
import { useAnswered } from "../answered";
import { useInlinePart } from "../inline-stack";
import { careerSwapOptions } from "../parts/career-swap";
import EditLine from "../parts/EditLine";
import NameApplyToAll from "../parts/NameApplyToAll";
import TeamChip from "../parts/TeamChip";
import TeamFillChips from "../parts/TeamFillChips";
import TeamNameRow, { RuledOutTeamRow } from "../parts/TeamNameRow";
import { useTidyWrite } from "../parts/tidy-write";
import { useSetYear } from "../parts/use-set-year";
import TidyTile, { ApplyToAllButton } from "../TidyTile";
import type { TidyCardContext, TidyRow, TidyTileProps } from "../tile-types";
import { useWalkMemory } from "../walk-memory";

/**
 * Cards "Apply to all" proposes in one call. Keep in step with
 * `MAX_APPLY_CARDS` in `convex/tidyCards.ts` (importing it would pull the
 * server graph into the bundle); the server refuses more, and checks every card
 * it is sent regardless.
 */
const APPLY_PROPOSE_MAX = 100;

/** What the tile reads from the card's context before the context has loaded: nothing. */
const NO_CONTEXT_YET = {
  names: [],
  players: [],
  teams: [],
} as unknown as NonNullable<TidyCardContext>;

/**
 * NEO-645 — tile 5, Team.
 *
 * Three questions can live here, each a stop of its own:
 *
 *  - a printed team name that is not linked to a team yet (pink; it is in the
 *    card's `pendingTeamNames`): its rows, a search with "Remember … as a name",
 *    New team, "Not a team";
 *  - a card with no team and no "No team on this card" answer (pink): career
 *    and listing chips, Other team…, New team, "No team on this card";
 *  - nothing to ask: the card's team with Edit at the end of its line, and
 *    "+ Another team". A team on a card is the card's team, whoever wrote it
 *    (NEO-656): a linked team has no name of its own, so Change is the Edit here.
 *
 * A gap team offers the career's covering stints as swaps (NEO-672): under a
 * team the Career tile says the player's career lacks (`careerGap`), one pill per
 * career team the set's year covers; a click swaps the card's team for it, the
 * same write as Change. Nothing is written to the player.
 *
 * Waits (`level="waiting"`) while a TEAMS disagreement is unsettled: the
 * spelling decides which name this tile asks about.
 *
 * "Apply to all" (answer, then offer it to the card's LINE) is main's wizard
 * grouping: one line per player set plus claim key (`convex/lib/teamLine`), so
 * every teamless card under this checklist with the same players and the same
 * listing claim takes the answer, a multi-player card included, with no career
 * test (the operator's answer is the evidence). A card with no player gets no
 * button (Jason, 2026-11-23). The client PROPOSES the cards on
 * the line from the checklist it holds; `tidyCards.applyTeamToPlayerCards`
 * re-checks every one and skips the rest. A set's own "No Team" (`setNoTeam`,
 * NEO-639 decision A) holds back what NB guesses, never an answer the operator
 * gives, so the button is offered there too.
 */
export default function TeamTile({
  row,
  context,
  attention,
  leafId,
  sportId,
  leafCards,
  setNoTeam = false,
}: TidyTileProps) {
  const write = useTidyWrite();
  const answered = useAnswered();
  const memory = useWalkMemory();
  // The visible half of a swap's confirmation (the walk's live region is the spoken half).
  const swapped = useFieldToast();
  const updateCard = useMutation(api.selectorOptions.updateCard);
  const applyTeamToPlayerCards = useMutation(api.tidyCards.applyTeamToPlayerCards);
  const [searchFor, setSearchFor] = useState<
    { kind: "add" } | { kind: "change"; teamId: Id<"teams"> } | null
  >(null);
  const addRef = useRef<HTMLButtonElement | null>(null);
  const searchScopeRef = useRef<HTMLDivElement | null>(null);
  // The control that opened the search, so Cancel and Esc hand focus back to it.
  // A pick is an ANSWER and does not: the walk moves focus on (`useAnswered`).
  const openerRef = useRef<HTMLElement | null>(null);
  const openSearch = (next: NonNullable<typeof searchFor>, opener: HTMLElement) => {
    openerRef.current = opener;
    setSearchFor(next);
  };
  const closeSearch = () => {
    setSearchFor(null);
    requestAnimationFrame(() => {
      const opener = openerRef.current;
      // A Change that swapped the team is a different row: its old button is gone.
      const target = opener?.isConnected ? opener : addRef.current;
      target?.focus({ preventScroll: true });
    });
  };
  useInlinePart(searchFor !== null, closeSearch, searchScopeRef);
  const gaps = attention.items.flatMap((i) => (i.kind === "careerGap" ? [i] : []));
  const setYear = useSetYear(leafId, gaps.length > 0);

  if (attention.items.some((i) => i.kind === "sourcesDisagree" && i.field === "teams")) {
    return <TidyTile heading="Team" level="waiting" waitingText="Waiting on the spelling above" />;
  }

  const teamsOnCard = row.teamOnCardIds ?? [];
  const nameOpen = attention.items.some((i) => i.kind === "teamName");
  const noTeam = attention.items.some((i) => i.kind === "noTeam");
  const confirmedNone = teamsOnCard.length === 0 && row.teamNoneConfirmedAt !== undefined;

  if (context === null) return null;
  // While the card's context loads, a card whose NAME is open or that already
  // has a team only waits; a card with no team still shows its chips, which
  // need nothing from the context. Those go through the same tree as the loaded
  // tile (an empty context), not a tree of their own: a chips component that is
  // the lone child of the tile while loading, then one of several once the
  // context arrives, is mounted again, and the "Other team…" search that was
  // open closes with the teams already chosen dropped.
  if (context === undefined && (nameOpen || teamsOnCard.length > 0)) {
    return <TidyTile heading="Team" level="waiting" waitingText="Looking at this card" />;
  }
  if (context === undefined && !noTeam) return null;
  const ctx = context ?? NO_CONTEXT_YET;

  // The names still waiting. A linked team keeps no printed name on the card.
  const teamNames = ctx.names.filter((n) => n.kind === "team");
  // Answers given while this card is open, which the card no longer shows: a
  // name ruled out (Edit takes it back) and a team linked (Apply to all copies
  // it). One that is waiting again, or whose team has left the card, is not shown.
  const waitingKeys = new Set(teamNames.map((n) => n.nameNormalized));
  const answersHere = memory
    .answersOn(row._id, "team")
    .filter((a) => !waitingKeys.has(normalizeEntityName(a.printed.trim())));
  const ruledOut = answersHere.flatMap((a) => (a.kind === "notEntity" ? [a] : []));
  const linkedHere = answersHere.flatMap((a) =>
    a.kind === "linkTeam" && teamsOnCard.includes(a.teamId) ? [a] : [],
  );
  if (
    teamNames.length === 0 &&
    ruledOut.length === 0 &&
    teamsOnCard.length === 0 &&
    !noTeam &&
    !confirmedNone
  ) {
    return null;
  }

  // The teams the card carries.
  const unrowed = ctx.teams.filter((t) => t.onCard);
  const multi = teamNames.length > 1;
  const open = nameOpen || noTeam;
  const atCap = teamsOnCard.length >= MAX_CARD_TEAMS;

  const saveTeams = (next: Array<Id<"teams">>, announcement?: string) =>
    write.run(async () => {
      await updateCard({ id: row._id, teamOnCardIds: next, regenerateListing: true });
      setSearchFor(null);
      if (announcement) swapped.announce(announcement);
      answered(announcement);
    }, "Couldn't save that team. Try again.");

  /**
   * Replace one of the card's teams with another (Change, and a career swap).
   * The swap pill's group is gone once the card's teams update, so the walk is
   * told in words ("Swapped Padres for Pirates.") for a screen reader, and the
   * tile shows the same sentence for a few seconds (`useFieldToast`, the pattern
   * "More about this card" uses).
   */
  const swapTeam = (from: Id<"teams">, to: Id<"teams">, announcement?: string) =>
    saveTeams([...new Set(teamsOnCard.map((t) => (t === from ? to : t)))], announcement);

  const onSelect = (picked: string, pickedName?: string) => {
    const id = picked as Id<"teams">;
    if (searchFor?.kind === "change") {
      const fromName = ctx.teams.find((t) => t.teamId === searchFor.teamId)?.name;
      return swapTeam(
        searchFor.teamId,
        id,
        fromName && pickedName ? `Swapped ${fromName} for ${pickedName}.` : undefined,
      );
    }
    return saveTeams([...new Set([...teamsOnCard, id])]);
  };

  // "Apply to all": the client proposes the card's line, the server checks.
  // A card with no player is on no line to apply to (Jason, 2026-11-23).
  const lineKey = teamLineKey(row);
  const who = ctx.players.map((p) => p.name).join(" & ");
  const sourceTeamIds =
    teamsOnCard.length > 0 && !open && who !== "" && hasTeamLine(lineKey) ? teamsOnCard : [];
  const proposed =
    sourceTeamIds.length > 0
      ? leafCards.filter((c) => proposesTeam(c, row._id, lineKey)).slice(0, APPLY_PROPOSE_MAX)
      : [];

  return (
    <TidyTile heading="Team" level={open ? "fix" : "plain"}>
      {write.error && (
        <p role="alert" className="text-xs text-neon-pink-text">
          {write.error}
        </p>
      )}

      {teamNames.map((name) => (
        <TeamNameRow
          key={`${name.kind}|${name.nameNormalized}`}
          row={row}
          name={name}
          setSportId={sportId}
          leafId={leafId}
          multi={multi}
          write={write}
          leafCards={leafCards}
        />
      ))}

      {ruledOut.map((a) => (
        <RuledOutTeamRow
          key={`ruled:${a.printed}`}
          row={row}
          printed={a.printed}
          setSportId={sportId}
          write={write}
          leafCards={leafCards}
        />
      ))}

      {unrowed.map((team) => {
        const gap = gaps.find((g) => g.teamId === team.teamId);
        const stints = ctx.players.find((p) => p.playerId === gap?.playerId)?.stints ?? [];
        const swaps =
          gap && searchFor === null ? careerSwapOptions({ stints, teamsOnCard, setYear }) : [];
        const swapLabelId = `swap-for-${row._id}-${team.teamId}`;
        return (
          <div
            key={team.teamId}
            role="group"
            aria-label={`Team ${team.name}`}
            className="grid gap-1.5"
          >
            <EditLine
              editLabel={`Edit ${team.name}`}
              busy={write.busy}
              onEdit={(opener) => openSearch({ kind: "change", teamId: team.teamId }, opener)}
              textClass="text-sm font-medium text-ink"
            >
              {team.name}
            </EditLine>
            {swaps.length > 0 && (
              // Its own inset with a rule down the side, so on a two-team card the
              // pills belong to the team above and never head the next team's row.
              <div className="mb-1 ml-1 grid gap-1 border-l-2 border-neon-blue-text/40 pl-2.5">
                <p id={swapLabelId} className="text-xs text-ink-2 wrap-anywhere">
                  Swap {team.name} for
                </p>
                <ul role="list" className="flex flex-wrap gap-1.5" aria-labelledby={swapLabelId}>
                  {swaps.map((option) => (
                    <li key={option.teamId} className="max-w-full">
                      <TeamChip
                        label={option.teamName}
                        on={false}
                        variant="action"
                        suffix={option.years}
                        accessibleName={`Swap ${team.name} for ${option.teamName} · ${option.years}`}
                        busy={write.busy}
                        onClick={() =>
                          void swapTeam(
                            team.teamId,
                            option.teamId as Id<"teams">,
                            `Swapped ${team.name} for ${option.teamName}.`,
                          )
                        }
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}

      {/* Seen, not heard: the walk's live region already says it (aria-hidden, so it is not read twice). */}
      <p aria-hidden="true" className="text-xs text-neon-green-text empty:hidden">
        {swapped.toast}
      </p>

      {linkedHere.map((a) => (
        <NameApplyToAll
          key={`apply:${a.printed}`}
          cardId={row._id}
          kind="team"
          printed={a.printed}
          answer={{ kind: "linkTeam", teamId: a.teamId }}
          leafCards={leafCards}
        />
      ))}

      {confirmedNone && !noTeam && <p className="text-sm text-ink-2">No team on this card.</p>}

      {noTeam && (
        <TeamFillChips
          row={row}
          sportId={sportId}
          leafId={leafId}
          players={ctx.players}
          write={write}
          leafCards={leafCards}
          setNoTeam={setNoTeam}
        />
      )}

      {searchFor && sportId ? (
        <div ref={searchScopeRef}>
          <EntityLinkSearch
            kind="team"
            sportId={sportId}
            contextOptionId={leafId}
            onSelect={(id, name) => void onSelect(id, name)}
            onCancel={closeSearch}
          />
        </div>
      ) : (
        !open &&
        !atCap && (
          <div className="flex flex-wrap items-center gap-2">
            <NeonButton
              ref={addRef}
              size="1"
              variant="secondary"
              outline
              aria-disabled={write.busy ? true : undefined}
              onClick={(e) => openSearch({ kind: "add" }, e.currentTarget)}
            >
              {teamsOnCard.length === 0 ? "+ Add team" : "+ Another team"}
            </NeonButton>
            {sourceTeamIds.length > 0 && (
              <ApplyToAllButton
                count={proposed.length}
                label={applyLabel(proposed.length, who)}
                onApply={async () => {
                  return await applyTeamToPlayerCards({
                    sourceCardId: row._id,
                    teamIds: sourceTeamIds,
                    cardIds: proposed.map((c) => c._id),
                  });
                }}
              />
            )}
          </div>
        )
      )}
    </TidyTile>
  );
}

/** "Apply to the other Jimmie Foxx card" / "Apply to all 4 other Johnny Bench & Pete Rose cards". Never offered on a card with no player. */
function applyLabel(count: number, who: string): string {
  return count === 1 ? `Apply to the other ${who} card` : `Apply to all ${count} other ${who} cards`;
}

/**
 * Whether a checklist card is worth PROPOSING for "Apply to all": on the open
 * card's line (the same player set and claim key) and still waiting for a team.
 * The server decides again (`tidyCards.cardTakesLineTeams`, the same two reads);
 * this keeps the button's count honest about what could be written.
 */
function proposesTeam(card: TidyRow, openCardId: Id<"cardChecklist">, lineKey: string): boolean {
  return card._id !== openCardId && teamLineKey(card) === lineKey && isTeamlessOnLine(card);
}
