import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MAX_CARD_PLAYERS } from "../../../../convex/features/cardAttention";
import { normalizeEntityName } from "@/lib/entities/normalize-name";
import NeonButton from "../../../modules/NeonButton";
import EntityLinkSearch from "../../EntityLinkSearch";
import { ALREADY_A_PLAYER_MESSAGE } from "../../player-picker-labels";
import { useAnswered } from "../answered";
import { useInlinePart } from "../inline-stack";
import EditLine from "../parts/EditLine";
import PlayerNameRow, {
  PlayerSummary,
  RuledOutPlayerRow,
  type ContextPlayer,
} from "../parts/PlayerNameRow";
import { useTidyWrite } from "../parts/tidy-write";
import TidyTile from "../TidyTile";
import type { TidyTileProps } from "../tile-types";
import { useWalkMemory } from "../walk-memory";

/**
 * NEO-645 — tile 3, Player.
 *
 * One row per name the card printed (a multi-player card is answered when
 * every row is), read from the card itself: a player linked
 * (`playerLinks.nameOnCard`) or a name still waiting (`pendingPlayerNames`). A
 * row that is still a question is pink and carries every way to answer it
 * inline. An answer links THIS card; "Apply to all" offers it to the cards of
 * the checklist still waiting on the name.
 *
 * Waits (`level="waiting"`) while a PLAYERS disagreement is unsettled: the
 * spelling decides which name this tile asks about, so nothing runs until it
 * is picked.
 *
 * Per-card edits (Edit on a link NeonBinder made without a name row,
 * "+ Another player") go through `updateCard`, which marks the card as set by
 * hand so an answer elsewhere never overwrites it. An answer to a printed name
 * goes through `tidyNames.answerName` and links this card (NEO-656).
 *
 * Cameos (T5) are the card's "Also on this card" list (NEO-528
 * `secondaryPlayerIds`), the same data as the attributes panel's cameo option and
 * written by the same mutation (`cardSecondaryPlayers.setSecondaryPlayers`),
 * through the same player search. Each is a row with its own Edit, which
 * changes or removes it; "+ Cameo" sits beside "+ Another player".
 */
export default function PlayerTile({ row, context, attention, sportId, leafCards }: TidyTileProps) {
  const write = useTidyWrite();
  const memory = useWalkMemory();
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
  // Focus owed to the tile once it has re-rendered. Set by `closeSearch`, settled by
  // the effect below, which runs after the commit that closed the search and, for a
  // removal, after the query dropped the cameo. `goneCameo` is the removed cameo's
  // player: its Edit stays in the DOM until the query catches up.
  const pendingFocus = useRef<{ tile: HTMLElement | null; goneCameo: string | null } | null>(null);
  const cameoKey = (context?.cameos ?? []).map((c) => c.playerId).join("|");
  const closeSearch = (goneCameo: string | null = null) => {
    // Read before the search unmounts: the tile is the last place focus can land.
    const tile = searchScopeRef.current?.closest<HTMLElement>("section") ?? null;
    pendingFocus.current = { tile, goneCameo };
    setSearchFor(null);
  };
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || searchFor !== null) return;
    // A removed cameo's Edit is still on screen until the query re-renders the tile.
    if (pending.goneCameo !== null && cameoKey.split("|").includes(pending.goneCameo)) return;
    pendingFocus.current = null;
    const opener = openerRef.current;
    // An Edit that swapped the player is a different row: its old button is gone.
    const target = opener?.isConnected
      ? opener
      : (fallbackRef.current.current ?? addRef.current ?? cameoRef.current);
    if (target) {
      target.focus({ preventScroll: true });
      return;
    }
    // Both add buttons are gone (each list is at its cap): park focus on the tile.
    if (pending.tile?.isConnected) {
      pending.tile.tabIndex = -1;
      pending.tile.focus({ preventScroll: true });
    }
  }, [searchFor, cameoKey]);
  useInlinePart(searchFor !== null, () => closeSearch(), searchScopeRef);

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
    playerNames.flatMap((n) => (n.playerId ? [n.playerId as string] : [])),
  );
  const playerById = new Map<string, ContextPlayer>(context.players.map((p) => [p.playerId, p]));
  // A linked player the card keeps no printed name for (a link older than the
  // card's own record of it).
  const unrowed = context.players.filter((p) => !answeredPlayerIds.has(p.playerId));
  // Names ruled out ("Not a player") while this card is open: off the card, so
  // the walk's memory is what lets Edit take it back. One that is waiting again
  // is already a row above.
  const waitingKeys = new Set(playerNames.filter((n) => n.pending).map((n) => n.nameNormalized));
  const ruledOut = memory
    .answersOn(row._id, "player")
    .flatMap((a) => (a.kind === "notEntity" ? [a] : []))
    .filter((a) => !waitingKeys.has(normalizeEntityName(a.printed.trim())));

  // An older server sends no cameos: none to list.
  const cameos = context.cameos ?? [];
  // The ids come from the same read as the names, so a cameo whose player is
  // gone is not written back (the server would refuse the whole list).
  const cameoIds = cameos.map((c) => c.playerId);
  const rowCount = playerNames.length + unrowed.length + ruledOut.length;
  if (rowCount === 0 && !hasPeople) return null;

  const open = attention.items.some((i) => i.kind === "playerName");
  // The tile's one filled button belongs to its first unanswered name.
  const leadName = playerNames.find((n) => n.pending);
  const multi = rowCount > 1;
  const sportForSearch = context.players[0]?.sportId ?? sportId;
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
  const saveCameos = (next: Array<Id<"players">>, fallback: string, goneCameo: string | null = null) =>
    write.run(async () => {
      await setSecondaryPlayers({ cardId: row._id, playerIds: next, regenerateListing: true });
      // Only on success: a refused removal keeps the search open and Cancel still
      // returns to the Edit. A removed cameo's focus waits for the tile to re-render.
      closeSearch(goneCameo);
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
      playerId,
    );

  return (
    <TidyTile heading="Player" level={open ? "fix" : "plain"}>
      {write.error && (
        <p role="alert" className="text-xs text-neon-pink-text">
          {write.error}
        </p>
      )}

      {playerNames.map((name) => (
        <PlayerNameRow
          key={`${name.kind}|${name.nameNormalized}`}
          row={row}
          name={name}
          linked={name.playerId ? playerById.get(name.playerId) : undefined}
          setSportId={sportId}
          multi={multi}
          lead={name === leadName}
          write={write}
          leafCards={leafCards}
        />
      ))}

      {ruledOut.map((a) => (
        <RuledOutPlayerRow
          key={`ruled:${a.printed}`}
          row={row}
          printed={a.printed}
          setSportId={sportId}
          write={write}
          leafCards={leafCards}
        />
      ))}

      {unrowed.map((player) => (
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
        </div>
      ))}

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
            onCancel={() => closeSearch()}
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
