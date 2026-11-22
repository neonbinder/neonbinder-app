import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MAX_CARD_TEAMS, teamFillOf } from "../../../../convex/features/cardAttention";
import NeonButton from "../../../modules/NeonButton";
import EntityLinkSearch from "../../EntityLinkSearch";
import { useInlinePart } from "../inline-stack";
import { linkedForText, teamFillText } from "../parts/copy";
import TeamFillChips from "../parts/TeamFillChips";
import TeamNameRow from "../parts/TeamNameRow";
import { useTidyWrite } from "../parts/tidy-write";
import TidyTile, { ApplyToAllButton, TidyNote } from "../TidyTile";
import type { TidyRow, TidyTileProps } from "../tile-types";

/**
 * Cards "Apply to all" proposes in one call. Keep in step with
 * `MAX_APPLY_CARDS` in `convex/tidyCards.ts` (importing it would pull the
 * server graph into the bundle); the server refuses more, and checks every card
 * it is sent regardless.
 */
const APPLY_PROPOSE_MAX = 100;

/**
 * NEO-645 — tile 5, Team.
 *
 * Three questions can live here, each a stop of its own:
 *
 *  - a printed team name that is not linked to a team yet (pink): its rows,
 *    a search with "Remember … as a name", New team, "Not a team";
 *  - a card with no team and no "No team on this card" answer (pink): career
 *    and listing chips, Other team…, New team, "No team on this card";
 *  - nothing to ask: the card's team, a purple note when the commit filled it
 *    in, Change and "+ Another team".
 *
 * Waits (`level="waiting"`) while a TEAMS disagreement is unsettled: the
 * spelling decides which name this tile asks about.
 *
 * "Apply to all" (answer, then offer it to the player's other teamless cards)
 * is guarded twice. The client only PROPOSES the cards that look alike from the
 * checklist it holds; `tidyCards.applyTeamToPlayerCards` re-checks every one
 * (same single player, no team claim from any source, the career names exactly
 * this team for that card's year) and skips the rest. Rule 8: a data claim
 * holds back a guess, so a card a source named a team for is never proposed.
 */
export default function TeamTile({ row, context, attention, leafId, sportId, leafCards }: TidyTileProps) {
  const write = useTidyWrite();
  const updateCard = useMutation(api.selectorOptions.updateCard);
  const applyTeamToPlayerCards = useMutation(api.tidyCards.applyTeamToPlayerCards);
  const [searchFor, setSearchFor] = useState<
    { kind: "add" } | { kind: "change"; teamId: Id<"teams"> } | null
  >(null);
  const addRef = useRef<HTMLButtonElement | null>(null);
  useInlinePart(searchFor !== null, () => setSearchFor(null));

  if (attention.items.some((i) => i.kind === "sourcesDisagree" && i.field === "teams")) {
    return <TidyTile heading="Team" level="waiting" waitingText="Waiting on the spelling above" />;
  }

  const teamsOnCard = row.teamOnCardIds ?? [];
  const nameOpen = attention.items.some((i) => i.kind === "teamName");
  const noTeam = attention.items.some((i) => i.kind === "noTeam");
  const confirmedNone = teamsOnCard.length === 0 && row.teamNoneConfirmedAt !== undefined;

  if (context === null) return null;
  if (context === undefined) {
    return nameOpen || teamsOnCard.length > 0 ? (
      <TidyTile heading="Team" level="waiting" waitingText="Looking at this card" />
    ) : noTeam ? (
      <TidyTile heading="Team" level="fix">
        <TeamFillChips row={row} sportId={sportId} leafId={leafId} players={[]} write={write} />
      </TidyTile>
    ) : null;
  }

  const teamNames = context.names.filter((n) => n.kind === "team");
  if (teamNames.length === 0 && teamsOnCard.length === 0 && !noTeam && !confirmedNone) return null;

  const answeredTeamIds = new Set<string>(
    teamNames.flatMap((n) => (n.row?.answer?.kind === "linkTeam" ? [n.row.answer.teamId as string] : [])),
  );
  // Teams the card carries that no name row stands behind: the exact single
  // match (D6: no row) and teams picked by hand.
  const unrowed = context.teams.filter((t) => t.onCard && !answeredTeamIds.has(t.teamId));
  const reasonOf = (teamId: string) =>
    context.linkedFor.find((l) => l.kind === "team" && l.teamId === teamId)?.reason;
  const fill = teamFillOf(row);
  const multi = teamNames.length > 1;
  const open = nameOpen || noTeam;
  const atCap = teamsOnCard.length >= MAX_CARD_TEAMS;

  const saveTeams = (next: Array<Id<"teams">>) =>
    write.run(async () => {
      await updateCard({ id: row._id, teamOnCardIds: next });
      setSearchFor(null);
    }, "Couldn't save that team. Try again.");

  const onSelect = (picked: string) => {
    const id = picked as Id<"teams">;
    if (searchFor?.kind === "change") {
      const next = teamsOnCard.map((t) => (t === searchFor.teamId ? id : t));
      return saveTeams([...new Set(next)]);
    }
    return saveTeams([...new Set([...teamsOnCard, id])]);
  };

  // "Apply to all": the client proposes, the server checks.
  const playerId = row.playerIds?.length === 1 ? row.playerIds[0] : undefined;
  const sourceTeamId = teamsOnCard.length === 1 && !open ? teamsOnCard[0] : undefined;
  const proposed =
    playerId && sourceTeamId
      ? leafCards.filter((c) => proposesTeam(c, row._id, playerId)).slice(0, APPLY_PROPOSE_MAX)
      : [];
  const playerName = context.players.find((p) => p.playerId === playerId)?.name;

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
          context={context}
          setSportId={sportId}
          leafId={leafId}
          multi={multi}
          write={write}
        />
      ))}

      {unrowed.map((team) => {
        const reason = reasonOf(team.teamId);
        return (
          <div
            key={team.teamId}
            role="group"
            aria-label={`Team ${team.name}`}
            className="grid gap-1.5"
          >
            <p className="text-sm font-medium text-ink wrap-anywhere">{team.name}</p>
            {reason && <TidyNote>{linkedForText(reason)}</TidyNote>}
            <div className="flex flex-wrap gap-2">
              <NeonButton
                size="1"
                variant="secondary"
                outline
                aria-label={unrowed.length > 1 || multi ? `Change ${team.name}` : "Change"}
                aria-disabled={write.busy ? true : undefined}
                onClick={() => setSearchFor({ kind: "change", teamId: team.teamId })}
              >
                Change
              </NeonButton>
            </div>
          </div>
        );
      })}

      {fill && <TidyNote>{teamFillText(fill.reason)}</TidyNote>}

      {confirmedNone && !noTeam && <p className="text-sm text-ink-2">No team on this card.</p>}

      {noTeam && (
        <TeamFillChips
          row={row}
          sportId={sportId}
          leafId={leafId}
          players={context.players}
          write={write}
        />
      )}

      {searchFor && sportId ? (
        <EntityLinkSearch
          kind="team"
          sportId={sportId}
          contextOptionId={leafId}
          onSelect={(id) => void onSelect(id)}
          onCancel={() => {
            setSearchFor(null);
            requestAnimationFrame(() => addRef.current?.focus({ preventScroll: true }));
          }}
        />
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
              onClick={() => setSearchFor({ kind: "add" })}
            >
              {teamsOnCard.length === 0 ? "+ Add team" : "+ Another team"}
            </NeonButton>
            {sourceTeamId && playerName && (
              <ApplyToAllButton
                count={proposed.length}
                label={
                  proposed.length === 1
                    ? `Apply to the other ${playerName} card`
                    : `Apply to all ${proposed.length} other ${playerName} cards`
                }
                onApply={async () => {
                  await applyTeamToPlayerCards({
                    sourceCardId: row._id,
                    teamId: sourceTeamId,
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

/**
 * Whether a checklist card is worth PROPOSING for "Apply to all": the same one
 * player, no team on it and no source's claim about one. The server decides
 * (it also reads the player's stints against that card's year); this keeps the
 * button from offering cards the server is certain to refuse, and keeps its
 * count honest about what could be written.
 */
function proposesTeam(card: TidyRow, openCardId: Id<"cardChecklist">, playerId: Id<"players">): boolean {
  if (card._id === openCardId) return false;
  if ((card.playerIds?.length ?? 0) !== 1 || card.playerIds?.[0] !== playerId) return false;
  if ((card.teamOnCardIds?.length ?? 0) > 0) return false;
  if ((card.pendingTeamNames ?? []).some((n) => n.trim().length > 0)) return false;
  if ((card.bscTeamName ?? "").trim() !== "") return false;
  if (card.teamNoneConfirmedAt !== undefined) return false;
  if (card.teamCheckOutcome === "checklist") return false;
  if ((card.sourceDisagreements ?? []).some((d) => d.field === "teams")) return false;
  return true;
}
