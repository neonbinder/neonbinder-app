import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { userFacingMessage } from "@/lib/errors/user-facing-message";
import NeonButton from "../../../modules/NeonButton";
import {
  AUTOGRAPH_FORMATS,
  asAutographFormat,
  carriesAutograph,
  type AutographFormat,
} from "../../autograph-format";
import TidyTile, { ApplyToAllButton } from "../TidyTile";
import type { TidyTileProps } from "../tile-types";
import { rowFields } from "./row-fields";

/**
 * NEO-645 callout 6 — "Autograph".
 *
 * Pink while an AU card has no format: no marketplace says whether the ink is
 * on the card or on a sticker, so it is NB data the operator supplies and the
 * card cannot be listed without it. There is deliberately no "Not sure yet":
 * go find the card.
 *
 * The answer is written to THIS card (`setCardFeature`, key `autographed`).
 * Once it is made, "Apply to all N autographed cards" offers it to the whole
 * checklist through the leaf's own door (`setAutographFormat`), whose cascade
 * skips cards the operator set by hand.
 */

/** The two answers' words on this tile (the stored values are NB's own vocabulary). */
const CHOICE_LABEL: Readonly<Record<AutographFormat, string>> = {
  "On Card": "On-card auto",
  "Sticker/Label": "Sticker auto",
};

export default function AutographTile({ row, leafId, leafCards }: TidyTileProps) {
  const setCardFeature = useMutation(api.selectorOptions.setCardFeature);
  const setAutographFormat = useMutation(api.autographFormat.setAutographFormat);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!carriesAutograph(row.attributes)) return null;

  const format = asAutographFormat(rowFields(row).features?.autographed);
  const signed = leafCards.filter((c) => carriesAutograph(c.attributes)).length;

  const choose = async (value: AutographFormat) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setCardFeature({ cardChecklistId: row._id, key: "autographed", value });
    } catch (e) {
      setError(userFacingMessage(e, "Didn't save, try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TidyTile
      heading="Autograph"
      level={format ? "plain" : "fix"}
      aside={format ? "Answered" : undefined}
    >
      {!format && (
        <p className="text-sm text-ink-2">How is this card signed? It can't be listed until you know.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {AUTOGRAPH_FORMATS.map((value) => (
          <NeonButton
            key={value}
            variant={format === value ? "primary" : "secondary"}
            outline={format !== value}
            size="1"
            type="button"
            aria-pressed={format === value}
            aria-disabled={busy || undefined}
            onClick={() => void choose(value)}
          >
            {CHOICE_LABEL[value]}
          </NeonButton>
        ))}
        {format && signed > 1 && (
          <ApplyToAllButton
            count={signed}
            label={`Apply to all ${signed} autographed cards`}
            onApply={async () => {
              await setAutographFormat({ selectorOptionId: leafId, value: format });
            }}
          />
        )}
      </div>
      <p role="alert" className="text-xs text-neon-pink-text empty:hidden">
        {error}
      </p>
    </TidyTile>
  );
}
