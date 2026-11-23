import { useRef, useState, type KeyboardEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { MAX_PLAYER_NAME_LENGTH } from "../../../../lib/players/name-limits";
import { hasCardName } from "../../../../lib/cards/unnamed-card";
import { Input } from "../../../primitives/Input";
import NeonButton from "../../../modules/NeonButton";
import { useAnswered } from "../answered";
import { useTidyWrite } from "../parts/tidy-write";
import TidyTile from "../TidyTile";
import type { TidyTileProps } from "../tile-types";

/**
 * NEO-645 (Jason, 2026-11-23: "A name for the card should be required, even if
 * not a player. So it could be Team Card or Checklist or something else but
 * there should always be a name associated with the card.") — "Card name".
 *
 * Shown only while the card has no player and no name of its own (the pink
 * `needsName` item): a checklist row that printed nothing, so NB called it
 * "Card #3". Type what it is and the card is done with this tile; the tile goes
 * away because the item does.
 *
 * The name is the card's own (`cardChecklist.cardName`, the field the card
 * panel's "Card name" edits). It is written through `updateCard` with
 * `regenerateListing`, so the listing title and description are rebuilt with
 * it (T4: the walk always rebuilds). Enter saves in place; the walk never reads
 * an Enter inside a field as Save & next.
 */
export default function CardNameTile({ row, attention }: TidyTileProps) {
  const updateCard = useMutation(api.selectorOptions.updateCard);
  const write = useTidyWrite();
  const answered = useAnswered();
  const [draft, setDraft] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  if (!attention.items.some((i) => i.kind === "needsName")) return null;

  const save = async () => {
    const name = draft.replace(/\s+/g, " ").trim();
    if (!hasCardName(name)) {
      setRefusal("Type what this card is, like Checklist or Team Card.");
      return;
    }
    setRefusal(null);
    const ok = await write.run(
      () => updateCard({ id: row._id, cardName: name, regenerateListing: true }),
      "Couldn't save that name. Try again.",
    );
    if (ok) answered();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void save();
  };

  const error = refusal ?? write.error;
  return (
    <TidyTile heading="Card name" level="fix">
      <p className="text-sm text-ink-2">No player on this card. What is it? Checklist, Team Card, a stadium…</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          bare
          ref={inputRef}
          type="text"
          value={draft}
          maxLength={MAX_PLAYER_NAME_LENGTH}
          onChange={(e) => {
            setDraft(e.target.value);
            setRefusal(null);
            write.clearError();
          }}
          onKeyDown={onKeyDown}
          readOnly={write.busy}
          aria-busy={write.busy || undefined}
          aria-invalid={error ? true : undefined}
          aria-label="Name for this card"
          placeholder="Checklist, Team Card…"
          className="min-w-0 flex-1 p-1.5 text-sm"
        />
        <NeonButton
          variant="primary"
          size="1"
          type="button"
          aria-disabled={write.busy || undefined}
          onClick={() => void save()}
        >
          {write.busy ? "Saving…" : "Save name"}
        </NeonButton>
      </div>
      <p role="alert" className="text-xs text-neon-pink-text empty:hidden">
        {error}
      </p>
    </TidyTile>
  );
}
