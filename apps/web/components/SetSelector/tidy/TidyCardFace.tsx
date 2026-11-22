import { useMemo } from "react";
import CardFace from "../../../app/collection/prototypes/_shared/CardFace";
import { finishForVariant } from "../../../app/collection/final/data/finish";
import type {
  Card as ModelCard,
  CardFeature,
  VariantKind,
} from "../../../app/collection/final/data/types";
import type { TidyCardContext, TidyRow } from "./tile-types";
import { rowFields } from "./tiles/row-fields";

/**
 * NEO-645 callout 1 — the drawn card at the top of the walk.
 *
 * Adapts a checklist row plus `cardContext`'s names into the collection's view
 * model `Card` (the shape `toCard` builds in `app/collection/final/data/
 * convexStore.ts`) and draws it with `CardFace`. Display only: the photo it
 * shows is the one the card already has, and there is no upload here (NEO-646).
 *
 * `context` is undefined while it loads and null when the card is gone; either
 * way the face draws from the row alone (the checklist's own card name stands
 * in for the player), so it never blanks while a lookup runs.
 *
 * `setName`, `season` and `variantName` are optional: the row does not carry
 * them, and a host that has them (the walk header knows the set) passes them so
 * the face prints its set line and finish.
 */
export default function TidyCardFace({
  row,
  context,
  setName = "",
  season = "",
  variantName = null,
  variantKind = "other",
}: {
  row: TidyRow;
  context: TidyCardContext | undefined;
  setName?: string;
  season?: string;
  variantName?: string | null;
  variantKind?: VariantKind;
}) {
  const fields = rowFields(row);
  const model = useMemo<ModelCard>(() => {
    const players = (context?.players ?? []).map((p) => ({
      id: p.playerId as string,
      name: p.name,
      ...(p.nameOnCard ? { nameOnCard: p.nameOnCard } : {}),
    }));
    const teams = (context?.teams ?? [])
      .filter((t) => t.onCard)
      .map((t) => ({ id: t.teamId as string, name: t.name, location: "" }));
    const tokens = new Set((row.attributes ?? []).map((a) => a.trim().toUpperCase()));
    const features: CardFeature[] = [];
    if (tokens.has("RC")) features.push("RC");
    if (tokens.has("AU")) features.push("AU");
    if (tokens.has("RELIC")) features.push("Relic");
    if (tokens.has("SP") || tokens.has("SSP")) features.push("SP");
    const variant = {
      id: "",
      kind: variantKind,
      name: variantName,
      insertName: null,
      printRun: null,
      order: 0,
      path: { typeId: "", variantId: null, subVariantId: null },
      finish: finishForVariant({ kind: variantKind, name: variantName }),
    };
    return {
      id: row._id as string,
      set: {
        id: "",
        name: setName,
        season,
        year: Number.parseInt(season, 10) || 0,
        brand: { id: "", name: "" },
        sport: { id: "", name: "" },
      },
      variant,
      cardNumber: row.cardNumber,
      players,
      // Until the context lands the checklist's own card name leads the face.
      ...(players.length === 0 && row.cardName.trim() ? { cardName: row.cardName.trim() } : {}),
      teams,
      printRun: row.printRun ?? null,
      features,
      cardVariation: row.cardVariation?.trim() ? row.cardVariation.trim() : null,
      isVariation: false,
      sortOrder: 0,
      finish: variant.finish,
    };
  }, [row, context, setName, season, variantName, variantKind]);

  const front = fields.imageUrls?.front;
  const back = fields.imageUrls?.back;
  const photo =
    front || back
      ? {
          ...(front ? { front: { imageUrl: front, thumbUrl: front } } : {}),
          ...(back ? { back: { imageUrl: back, thumbUrl: back } } : {}),
        }
      : undefined;

  // Named from the row until the context lands, so it never reads as a blank card.
  const who = model.players.map((p) => p.nameOnCard ?? p.name).join(", ") || row.cardName.trim();
  const label = [`Card #${row.cardNumber}`, who, model.teams.map((t) => t.name).join(", ")]
    .filter(Boolean)
    .join(", ");

  return <CardFace model={model} size="md" photo={photo} label={label} />;
}
