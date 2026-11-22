import { useRef, useState, type KeyboardEvent } from "react";
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
import { useAnswered } from "../answered";
import TidyTile, { ApplyToAllButton } from "../TidyTile";
import type { TidyTileProps } from "../tile-types";

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
 *
 * The two answers are a required radio group (NEO-331's pattern): one Tab stop
 * (the checked one, else the first), arrows move AND choose and wrap, Home and
 * End jump. A click, Space or Enter is the operator's answer, so it also hands
 * focus on (`useAnswered`: Save & next, or the next pink tile); an arrow press
 * only moves between the two, so the operator can arrow back.
 */

/** The two answers' words on this tile (the stored values are NB's own vocabulary). */
const CHOICE_LABEL: Readonly<Record<AutographFormat, string>> = {
  "On Card": "On-card auto",
  "Sticker/Label": "Sticker auto",
};

export default function AutographTile({ row, leafId, leafCards }: TidyTileProps) {
  const setCardFeature = useMutation(api.selectorOptions.setCardFeature);
  const setAutographFormat = useMutation(api.autographFormat.setAutographFormat);
  const answered = useAnswered();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const radios = useRef<Array<HTMLButtonElement | null>>([]);

  if (!carriesAutograph(row.attributes)) return null;

  const format = asAutographFormat(row.features?.autographed);
  const signed = leafCards.filter((c) => carriesAutograph(c.attributes)).length;

  /** `advance`: the operator pressed the answer (not an arrow), so focus moves on once it is saved. */
  const choose = async (value: AutographFormat, advance: boolean) => {
    if (busy) return;
    if (value === format) {
      // Already the answer (arrowed to, then Enter): nothing to write, still move on.
      if (advance) answered();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setCardFeature({
        cardChecklistId: row._id,
        key: "autographed",
        value,
        regenerateListing: true,
      });
      if (advance) answered();
    } catch (e) {
      setError(userFacingMessage(e, "Didn't save, try again."));
    } finally {
      setBusy(false);
    }
  };

  const checkedIndex = Math.max(0, format ? AUTOGRAPH_FORMATS.indexOf(format) : 0);
  const onRadioKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = AUTOGRAPH_FORMATS.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = index === 0 ? last : index - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    radios.current[next]?.focus();
    void choose(AUTOGRAPH_FORMATS[next], false);
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
        <div role="radiogroup" aria-label="Autograph format" aria-required="true" className="flex flex-wrap gap-2">
          {AUTOGRAPH_FORMATS.map((value, index) => (
            <NeonButton
              key={value}
              ref={(el) => {
                radios.current[index] = el;
              }}
              variant={format === value ? "primary" : "secondary"}
              outline={format !== value}
              size="1"
              type="button"
              role="radio"
              aria-checked={format === value}
              tabIndex={index === checkedIndex ? 0 : -1}
              aria-disabled={busy || undefined}
              onKeyDown={(e) => onRadioKeyDown(e, index)}
              onClick={() => void choose(value, true)}
            >
              {CHOICE_LABEL[value]}
            </NeonButton>
          ))}
        </div>
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
