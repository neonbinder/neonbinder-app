import { useId, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { userFacingMessage } from "@/lib/errors/user-facing-message";
import { Input } from "../../../primitives/Input";
import NeonButton from "../../../modules/NeonButton";
import { SOURCES_WITH_CHECKLIST, SOURCE_KEYS, type SourceKey } from "../../reconciliation-sources";
import { useInlinePart } from "../inline-stack";
import TidyTile, { ApplyToAllButton, type TidyTileLevel } from "../TidyTile";
import type { TidyTileProps } from "../tile-types";
import type { TidyDisagreement as RowDisagreement } from "../../../../convex/features/cardAttention";

/**
 * NEO-645 callout 2 — "Sources disagree".
 *
 * One column per source that named the field, labelled the way Match Cards
 * labels them (BSC, SportLots, Checklist: the marketplace names are fine here,
 * Jason). The values are NB-styled and already judged AFTER parsing by the
 * server: "Judge / Soto" against "Judge | Soto" never reaches this tile, so
 * every differing column is a real difference.
 *
 * Three states, one per entry on the card:
 *
 *   - unchosen          pink. A button per distinct value, and a typed one.
 *   - chosen by NB      blue. Exactly one value was already in NeonBinder, so
 *                       the server went with it; a button flips to another.
 *   - chosen by you     plain. "Using “X”", Change, and Apply-to-the-same.
 *
 * There is no "Not sure yet": a card cannot be listed without the answer.
 * Picks save as they are made (J1); the tile never navigates.
 */

/** `tidyCards.MAX_APPLY_CARDS`, hand-copied: the server graph cannot be imported here. Keep in step. */
const MAX_APPLY_CARDS = 100;

const FIELD_LABEL: Record<RowDisagreement["field"], string> = {
  players: "Player name",
  teams: "Team name",
};

const sourceLabel = (key: SourceKey): string =>
  SOURCES_WITH_CHECKLIST.find((s) => s.key === key)?.label ?? key;

/** One value, as the tile says it: several names read "A / B". */
const show = (value: readonly string[]): string => value.join(" / ");

const sameValue = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((n, i) => n === b[i]);

/** What identifies "the same disagreement" across cards: the field plus the set of values. */
function disagreementKey(d: RowDisagreement): string {
  return `${d.field}\u001e${d.values
    .map((v) => v.value.join("\u001f"))
    .sort()
    .join("\u001e")}`;
}

/**
 * What a typed value is split into: one name per `/` or `|`. The server
 * cleanses each name with the shared matcher, so this only separates them.
 */
function parseTyped(text: string): string[] {
  return text
    .split(/[/|]/)
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
}

/**
 * The part of `text` between the prefix and suffix it shares with `other`,
 * so the characters that really differ can be underlined. Only meaningful for
 * two single-name values.
 */
function diffParts(text: string, other: string): { head: string; mid: string; tail: string } {
  let start = 0;
  while (start < text.length && start < other.length && text[start] === other[start]) start++;
  let end = 0;
  while (
    end < text.length - start &&
    end < other.length - start &&
    text[text.length - 1 - end] === other[other.length - 1 - end]
  ) {
    end++;
  }
  return {
    head: text.slice(0, start),
    mid: text.slice(start, text.length - end),
    tail: text.slice(text.length - end),
  };
}

export default function SourcesDisagreeTile({ row, attention, leafCards }: TidyTileProps) {
  const entries = row.sourceDisagreements ?? [];
  if (entries.length === 0) return null;

  const unsettled = entries.some((d) => !d.chosen);
  const nbPicked = attention.items.some((i) => i.kind === "nbPicked");
  const level: TidyTileLevel = unsettled ? "fix" : nbPicked ? "check" : "plain";

  return (
    <TidyTile heading="Sources disagree" level={level}>
      <div className="grid gap-4">
        {entries.map((entry) => (
          <DisagreementEntry
            key={entry.field}
            entry={entry}
            row={row}
            leafCards={leafCards}
            heading={entries.length > 1}
          />
        ))}
      </div>
    </TidyTile>
  );
}

function DisagreementEntry({
  entry,
  row,
  leafCards,
  heading,
}: {
  entry: RowDisagreement;
  row: TidyTileProps["row"];
  leafCards: TidyTileProps["leafCards"];
  /** Name the field above its columns (a card can disagree on two). */
  heading: boolean;
}) {
  const pickSourceValue = useMutation(api.tidyCards.pickSourceValue);
  const uid = useId();
  const [changing, setChanging] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(0);
  const typedRef = useRef<HTMLInputElement | null>(null);
  const typeButtonRef = useRef<HTMLButtonElement | null>(null);

  const closeTyping = () => {
    setTyping(false);
    requestAnimationFrame(() => typeButtonRef.current?.focus());
  };
  useInlinePart(typing, closeTyping);

  const chosen = entry.chosen;
  const fieldLabel = FIELD_LABEL[entry.field];
  const sources = SOURCE_KEYS.filter((k) => entry.values.some((v) => (v.sources as readonly string[]).includes(k)));
  const single = entry.values.length === 2 && entry.values.every((v) => v.value.length === 1);

  const candidates = useMemo(() => {
    if (!chosen || chosen.by !== "operator") return [];
    const key = disagreementKey(entry);
    return leafCards
      .filter((c) => c._id !== row._id)
      .filter((c) =>
        (c.sourceDisagreements ?? []).some(
          (d) => d.field === entry.field && !d.chosen && disagreementKey(d) === key,
        ),
      )
      .slice(0, MAX_APPLY_CARDS);
  }, [chosen, entry, leafCards, row._id]);

  const pick = async (value: readonly string[], isTyped: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setRefused(0);
    try {
      await pickSourceValue({
        cardId: row._id,
        field: entry.field,
        value: [...value],
        ...(isTyped ? { typed: true as const } : {}),
      });
      setChanging(false);
      setTyping(false);
      setTyped("");
    } catch (e) {
      setError(userFacingMessage(e, "Didn't save, try again."));
    } finally {
      setBusy(false);
    }
  };

  const applyToSame = async () => {
    if (!chosen) return;
    const result: { refused: number } = await pickSourceValue({
      cardId: row._id,
      field: entry.field,
      value: [...chosen.value],
      ...(chosen.typed ? { typed: true as const } : {}),
      cardIds: candidates.map((c) => c._id),
    });
    setRefused(result.refused);
  };

  const submitTyped = () => {
    const names = parseTyped(typed);
    if (names.length === 0) return;
    void pick(names, true);
  };

  const choosing = !chosen || changing;
  const chosenFrom = chosen
    ? chosen.typed
      ? null
      : entry.values
          .find((v) => sameValue(v.value, chosen.value))
          ?.sources.map((k) => sourceLabel(k as SourceKey))
          .join(", ")
    : null;

  return (
    <div className="grid gap-2">
      {heading && <p className="text-xs font-medium text-ink-2">{fieldLabel}</p>}
      <ul
        aria-label={`What each source says: ${fieldLabel}`}
        className="grid list-none grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2 p-0"
      >
        {sources.map((source) => {
          const value = entry.values.find((v) => (v.sources as readonly string[]).includes(source))!;
          const inNb = chosen?.by === "nb" && sameValue(value.value, chosen.value);
          const other = single ? entry.values.find((v) => v !== value) : undefined;
          const parts = other ? diffParts(show(value.value), show(other.value)) : null;
          return (
            <li
              key={source}
              className="grid min-w-0 content-start gap-0.5 rounded-md border border-rule bg-raised-deep px-2 py-1.5 text-sm text-ink"
            >
              <span className="text-xs text-ink-3">{sourceLabel(source)}</span>
              <span className="min-w-0 wrap-anywhere">
                {parts ? (
                  <>
                    {parts.head}
                    <u className="decoration-neon-pink-text decoration-2 underline-offset-2">{parts.mid}</u>
                    {parts.tail}
                  </>
                ) : (
                  show(value.value)
                )}
              </span>
              {inNb && <span className="text-xs text-neon-green-text">In NeonBinder</span>}
            </li>
          );
        })}
      </ul>

      {chosen && !changing && (
        <p className="text-sm text-ink wrap-anywhere" role="status">
          {chosen.by === "nb"
            ? `Went with “${show(chosen.value)}”, they're already in your binder.`
            : chosenFrom
              ? `Using “${show(chosen.value)}” (${chosenFrom})`
              : `Using “${show(chosen.value)}”`}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {chosen && !changing && chosen.by === "operator" && (
          <NeonButton
            variant="secondary"
            outline
            size="1"
            type="button"
            onClick={() => setChanging(true)}
            aria-label={`Change the ${fieldLabel.toLowerCase()}`}
          >
            Change
          </NeonButton>
        )}
        {chosen && !changing && chosen.by === "nb" &&
          entry.values
            .filter((v) => !sameValue(v.value, chosen.value))
            .map((v) => (
              <NeonButton
                key={v.value.join("\u001f")}
                variant="secondary"
                outline
                size="1"
                type="button"
                aria-disabled={busy || undefined}
                onClick={() => void pick(v.value, false)}
              >
                {`Use “${show(v.value)}” instead`}
              </NeonButton>
            ))}
        {choosing &&
          entry.values.map((v) => (
            <NeonButton
              key={v.value.join("\u001f")}
              variant="secondary"
              outline
              size="1"
              type="button"
              aria-disabled={busy || undefined}
              onClick={() => void pick(v.value, false)}
            >
              {`Use “${show(v.value)}”`}
            </NeonButton>
          ))}
        {choosing && (
          <NeonButton
            ref={typeButtonRef}
            variant="tertiary"
            outline
            size="1"
            type="button"
            aria-expanded={typing}
            aria-controls={typing ? `${uid}-typed` : undefined}
            onClick={() => {
              if (typing) {
                closeTyping();
                return;
              }
              setTyped(chosen ? show(chosen.value) : "");
              setTyping(true);
              requestAnimationFrame(() => typedRef.current?.focus());
            }}
          >
            Type another…
          </NeonButton>
        )}
        {chosen?.by === "operator" && !changing && (
          <ApplyToAllButton
            count={candidates.length}
            label={`Apply to the ${candidates.length} ${candidates.length === 1 ? "card" : "cards"} with the same disagreement`}
            onApply={applyToSame}
          />
        )}
      </div>

      {typing && (
        <div id={`${uid}-typed`} className="flex flex-wrap items-center gap-2">
          <Input
            bare
            ref={typedRef}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitTyped();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeTyping();
              }
            }}
            readOnly={busy}
            aria-label={`Type the ${fieldLabel.toLowerCase()} yourself`}
            className="min-w-0 flex-1 p-1.5 text-sm"
            placeholder={entry.field === "players" ? "e.g. Aaron Judge / Juan Soto" : "e.g. San Diego Padres"}
          />
          <NeonButton
            variant="primary"
            size="1"
            type="button"
            aria-disabled={busy || parseTyped(typed).length === 0 || undefined}
            onClick={submitTyped}
          >
            Use this
          </NeonButton>
        </div>
      )}

      {refused > 0 && (
        <p role="status" className="text-xs text-ink-2">
          {`${refused} ${refused === 1 ? "card" : "cards"} no longer matched and ${refused === 1 ? "was" : "were"} left as ${refused === 1 ? "it was" : "they were"}.`}
        </p>
      )}
      <p role="alert" className="text-xs text-neon-pink-text empty:hidden">
        {error}
      </p>
    </div>
  );
}
