import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import NeonButton from "../../../modules/NeonButton";
import {
  CardDetailFields,
  MORE_ABOUT_SECTIONS,
  useFieldToast,
  type CardDetailCard,
} from "../../CardDetailFields";
import TidyTile from "../TidyTile";
import type { TidyTileProps } from "../tile-types";

/**
 * NEO-645 callout 8 — "More about this card".
 *
 * Everything the side panel edits that the walk does not promote to a tile of
 * its own: the same field components, autosaving the same way, collapsed by
 * default. Players, teams and the listing title have tiles, and the photo is
 * on the drawn card, so those sections are not here (`MORE_ABOUT_SECTIONS`).
 *
 * The fields mount only while open, so a collapsed tile subscribes to nothing
 * and holds no second copy of a control the walk already shows.
 */
export default function MoreAboutTile({ row, leafId, sportId }: TidyTileProps) {
  const [open, setOpen] = useState(false);

  return (
    <TidyTile
      heading="More about this card"
      level="plain"
      aside={
        <NeonButton
          variant="secondary"
          outline
          size="1"
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide fields" : "Show fields"}
        </NeonButton>
      }
    >
      {open && <OpenFields row={row} leafId={leafId} sportId={sportId} />}
    </TidyTile>
  );
}

function OpenFields({
  row,
  leafId,
  sportId,
}: Pick<TidyTileProps, "row" | "leafId" | "sportId">) {
  const status = useFieldToast();
  // Same arguments as the checklist's own read, so Convex serves it once.
  const chain = useQuery(api.selectorOptions.getAncestorChain, { id: leafId });
  // The row is a `getCardChecklist` row, a superset of what the panel's card
  // type names; the walk's shared row type only declares the part it reads.
  const card = {
    ...(row as Partial<CardDetailCard>),
    _id: row._id,
    selectorOptionId: leafId,
    cardNumber: row.cardNumber,
    cardName: row.cardName,
    platformData: row.platformData ?? {},
  } as CardDetailCard;

  return (
    <div className="grid gap-2">
      <CardDetailFields
        card={card}
        ancestorChain={chain}
        ancestorSport={chain?.find((c) => c.level === "sport")?.value}
        ancestorSportId={sportId}
        contextOptionId={leafId}
        sections={MORE_ABOUT_SECTIONS}
        status={status}
      />
      <p role="status" aria-live="polite" className="text-xs text-neon-green-text empty:hidden">
        {status.toast}
      </p>
    </div>
  );
}
