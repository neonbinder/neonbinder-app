import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MAX_CARD_PLAYERS } from "../../../../convex/features/cardAttention";
import NeonButton from "../../../modules/NeonButton";
import EntityLinkSearch from "../../EntityLinkSearch";
import { ALREADY_A_PLAYER_MESSAGE } from "../../player-picker-labels";
import { useAnswered } from "../answered";
import { useInlinePart } from "../inline-stack";
import EditLine from "../parts/EditLine";
import PlayerNameRow, { PlayerSummary, type ContextPlayer } from "../parts/PlayerNameRow";
import { linkedForText, noteworthyReason } from "../parts/copy";
import { useTidyWrite } from "../parts/tidy-write";
import TidyTile, { TidyNote } from "../TidyTile";
import type { TidyTileProps } from "../tile-types";

/**
 * NEO-645 — tile 3, Player.
 *
 * One row per name the card printed (a multi-player card is answered when
 * every row is). A row that is still a question is pink and carries every way
 * to answer it inline; a name NeonBinder linked for you reads as a purple note
 * on its row, never as a stop (it happens on nearly every card of a veteran
 * set).
 *
 * Waits (`level="waiting"`) while a PLAYERS disagreement is unsettled: the
 * spelling decides which name this tile asks about, so nothing runs until it
 * is picked.
 *
 * Per-card edits (Edit on a link NeonBinder made without a name row,
 * "+ Another player") go through `updateCard`, which marks the card as set by
 * hand so an answer elsewhere never overwrites it. An answer to a printed name
 * goes through `tidyNames.answerName` and reaches every card that prints it.
 *
 * Cameos (T5) are the card's "Also on this card" list (NEO-528
 * `secondaryPlayerIds`), the same data as the attributes panel's cameo option and
 * written by the same mutation (`cardSecondaryPlayers.setSecondaryPlayers`),
 * through the same player search. Each is a row with its own Edit, which
 * changes or removes it; "+ Cameo" sits beside "+ Another player".
 */
export default function PlayerTile({ row, context, attention, sportId }: TidyTileProps) {
  const write = useTidyWrite();
  const answered = useAnswered();
  const updateCard = useMutation(api.selectorOptions.updateCard);
  const setSecondaryPlayers = useMutation(api.cardSecondaryPlayers.setSecondaryPlayers);
  const [searchFor, setSearchFor] = useState<
    | { kind: "add" }
    | { kind: "change"; playerId: Id<"players"> }
    | { kind: "addCameo" }
    | { kind: "changeCameo"; playerId: Id<"players"> }
    | null
  >(null);
  const addRef = useRef<HTMLButtonElement | null>(null);
  const cameoRef = useRef<HTMLButtonElement | null>(null);
  const searchScopeRef = useRef<HTMLDivElement | null>(null);
  // The control that opened the search, so Cancel and Esc hand focus back to it.
  // A pick is an ANSWER and does not: the walk moves focus on (`useAnswered`).
  const openerRef = useRef<HTMLElement | null>(null);
  // Where focus lands when the opener is gone: the add button of the same kind.
  const fallbackRef = useRef<typeof addRef>(addRef);
  const openSearch = (next: NonNullable<typeof searchFor>, opener: HTMLElement) => {
    openerRef.current = opener;
    fallbackRef.current = next.kind === "addCameo" || next.kind === "changeCameo" ? cameoRef : addRef;
    setSearchFor(next);
  };
  const closeSearch = () => {
    setSearchFor(null);
    requestAnimationFrame(() => {
      const opener = openerRef.current;
      // An Edit that swapped the player is a different row: its old button is gone.
      const target = opener?.isConnected
        ? opener
        : (fallbackRef.current.current ?? addRef.current ?? cameoRef.current);
      target?.focus({ preventScroll: true });
    });
  };
  useInlinePart(searchFor !== null, closeSearch, searchScopeRef);

  if (attention.items.some((i) => i.kind === "sourcesDisagree" && i.field === "players")) {
    return (
      <TidyTile
        heading="Player"
        level="waiting"
        waitingText="Looks up once the spelling is picked"
      />
    );
  }

  const hasPeople =
    (row.playerIds?.length ?? 0) > 0 ||
    (row.pendingPlayerNames?.length ?? 0) > 0 ||
    (row.secondaryPlayerIds?.length ?? 0) > 0;
  if (context === null) return null;
  if (context === undefined) {
    return hasPeople ? (
      <TidyTile heading="Player" level="waiting" waitingText="Looking at this card" />
    ) : null;
  }

  const playerNames = context.names.filter((n) => n.kind === "player");
  const answeredPlayerIds = new Set<string>(
    playerNames.flatMap((n) =>
      n.row?.answer?.kind === "linkPlayer" ? [n.row.answer.playerId as string] : [],
    ),
  );
  const playerById = new Map<string, ContextPlayer>(context.players.map((p) => [p.playerId, p]));
  // A linked player with no name row: an exact single match is linked without
  // one (D6), and its note is read live.
  const unrowed = context.players.filter((p) => !answeredPlayerIds.has(p.playerId));

  // An older server sends no cameos: none to list.
  const cameos = context.cameos ?? [];
  // The ids come from the same read as the names, so a cameo whose player is
  // gone is not written back (the server would refuse the whole list).
  const cameoIds = cameos.map((c) => c.playerId);
  const rowCount = playerNames.length + unrowed.length;
  if (rowCount === 0 && !hasPeople) return null;

  const reasonOf = (playerId: string) =>
    noteworthyReason(context.linkedFor.find((l) => l.kind === "player" && l.playerId === playerId)?.reason);

  const open = attention.items.some((i) => i.kind === "playerName");
  // The tile's one filled button belongs to its first unanswered name.
  const leadName = playerNames.find((n) => {
    const kind = n.row?.answer?.kind;
    return kind !== "notEntity" && kind !== "linkPlayer";
  });
  const multi = rowCount > 1;
  const sportForSearch =
    playerNames.find((n) => n.row)?.row?.sportId ?? context.players[0]?.sportId ?? sportId;
  const atCap = (row.playerIds?.length ?? 0) >= MAX_CARD_PLAYERS;
  const cameosAtCap = cameoIds.length >= MAX_CARD_PLAYERS;

  const savePlayers = (next: Array<Id<"players">>) =>
    write.run(async () => {
      await updateCard({ id: row._id, playerIds: next, regenerateListing: true });
      // Someone added as a player who was also a cameo is the card's subject
      // now, so they leave the cameos (the attributes panel does the same).
      const own = new Set<string>(next);
      const kept = cameoIds.filter((id) => !own.has(id));
      if (kept.length < cameoIds.length) {
        await setSecondaryPlayers({ cardId: row._id, playerIds: kept, regenerateListing: true });
      }
      setSearchFor(null);
      answered();
    }, "Couldn't save that player. Try again.");

  /**
   * Replace the card's cameos: the same mutation the attributes panel's cameo
   * option uses. `regenerateListing` is the walk's own flag (T4): the title and
   * description are rebuilt from the card as this write leaves it.
   */
  const saveCameos = (next: Array<Id<"players">>, fallback: string) =>
    write.run(async () => {
      await setSecondaryPlayers({ cardId: row._id, playerIds: next, regenerateListing: true });
      closeSearch();
    }, fallback);

  const onSelect = (picked: string) => {
    const id = picked as Id<"players">;
    const current = row.playerIds ?? [];
    if (searchFor?.kind === "addCameo" || searchFor?.kind === "changeCameo") {
      if (current.includes(id)) {
        // A cameo is never also the subject: said here, beside the pick.
        return write.run(async () => {
          throw new Error(ALREADY_A_PLAYER_MESSAGE);
        }, ALREADY_A_PLAYER_MESSAGE);
      }
      const next =
        searchFor.kind === "changeCameo"
          ? cameoIds.map((p) => (p === searchFor.playerId ? id : p))
          : [...cameoIds, id];
      return saveCameos([...new Set(next)], "Couldn't save that cameo. Try again.");
    }
    if (searchFor?.kind === "change") {
      const next = current.map((p) => (p === searchFor.playerId ? id : p));
      return savePlayers([...new Set(next)]);
    }
    return savePlayers([...new Set([...current, id])]);
  };

  const removeCameo = (playerId: Id<"players">) =>
    saveCameos(
      cameoIds.filter((p) => p !== playerId),
      "Couldn't remove that cameo. Try again.",
    );

  return (
    <TidyTile heading="Player" level={open ? "fix" : "plain"}>
      {write.error && (
        <p role="alert" className="text-xs text-neon-pink-text">
          {write.error}
        </p>
      )}

      {playerNames.map((name) => {
        const answer = name.row?.answer;
        const linkedId = answer?.kind === "linkPlayer" ? (answer.playerId as string) : undefined;
        return (
          <PlayerNameRow
            key={`${name.kind}|${name.nameNormalized}`}
            row={row}
            name={name}
            linked={linkedId ? playerById.get(linkedId) : undefined}
            reason={linkedId ? reasonOf(linkedId) : undefined}
            setSportId={sportId}
            multi={multi}
            lead={name === leadName}
            write={write}
          />
        );
      })}

      {unrowed.map((player) => {
        const reason = reasonOf(player.playerId);
        return (
          <div
            key={player.playerId}
            role="group"
            aria-label={`Player ${player.name}`}
            className="grid gap-1.5"
          >
            <EditLine
              editLabel={`Edit ${player.name}`}
              busy={write.busy}
              onEdit={(opener) => openSearch({ kind: "change", playerId: player.playerId }, opener)}
            >
              <PlayerSummary player={player} fallbackName={player.name} />
            </EditLine>
            {reason && <TidyNote>{linkedForText(reason)}</TidyNote>}
          </div>
        );
      })}

      {cameos.map((cameo) => (
        <div
          key={`cameo:${cameo.playerId}`}
          role="group"
          aria-label={`Cameo ${cameo.name}`}
          className="grid gap-1.5"
        >
          <EditLine
            editLabel={`Edit cameo ${cameo.name}`}
            busy={write.busy}
            onEdit={(opener) => openSearch({ kind: "changeCameo", playerId: cameo.playerId }, opener)}
          >
            <span className="font-medium text-ink">{cameo.name}</span>
            <span className="text-ink-3">{" · cameo"}</span>
          </EditLine>
        </div>
      ))}

      {searchFor && sportForSearch ? (
        <div ref={searchScopeRef} className="grid gap-2">
          <EntityLinkSearch
            kind="player"
            sportId={sportForSearch}
            onSelect={(id) => void onSelect(id)}
            onCancel={closeSearch}
          />
          {searchFor.kind === "changeCameo" && (
            <div className="flex flex-wrap gap-2">
              <NeonButton
                size="1"
                variant="negative"
                outline
                aria-label={`Remove cameo ${cameos.find((c) => c.playerId === searchFor.playerId)?.name ?? ""}`}
                aria-disabled={write.busy ? true : undefined}
                onClick={() => void removeCameo(searchFor.playerId)}
              >
                Remove cameo
              </NeonButton>
            </div>
          )}
        </div>
      ) : (
        !open &&
        (!atCap || !cameosAtCap) && (
          <div className="flex flex-wrap gap-2">
            {!atCap && (
              <NeonButton
                ref={addRef}
                size="1"
                variant="secondary"
                outline
                aria-disabled={write.busy ? true : undefined}
                onClick={(e) => openSearch({ kind: "add" }, e.currentTarget)}
              >
                + Another player
              </NeonButton>
            )}
            {!cameosAtCap && (
              <NeonButton
                ref={cameoRef}
                size="1"
                variant="secondary"
                outline
                aria-disabled={write.busy ? true : undefined}
                onClick={(e) => openSearch({ kind: "addCameo" }, e.currentTarget)}
              >
                + Cameo
              </NeonButton>
            )}
          </div>
        )
      )}
    </TidyTile>
  );
}
