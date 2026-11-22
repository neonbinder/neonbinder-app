import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { userFacingMessage } from "@/lib/errors/user-facing-message";
import { Input } from "../../../primitives/Input";
import NeonButton from "../../../modules/NeonButton";
import { SOURCES_WITH_CHECKLIST, SOURCE_KEYS, type SourceKey } from "../../reconciliation-sources";
import { useAnswered } from "../answered";
import { useInlinePart } from "../inline-stack";
import TidyTile, { ApplyToAllButton, WRAP_LABEL_CLASS, type TidyTileLevel } from "../TidyTile";
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
 * Two states, one per entry on the card. NeonBinder never picks between the
 * sources for you, so every disagreement starts unsettled:
 *
 *   - unchosen          pink. A button per distinct value, and a typed one.
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

/** One value as typed text: several names read "A / B". Empty reads "". */
const joined = (value: readonly string[]): string => value.join(" / ");

/**
 * A source that answered with NO names (a listing with no team on it) is still
 * an answer, and it needs words: an empty column and a button named `Use “”`
 * say nothing to a person or a screen reader.
 */
const NONE_ON_CARD: Record<RowDisagreement["field"], { column: string; use: string }> = {
  players: { column: "No player on the card", use: "no player" },
  teams: { column: "No team on the card", use: "no team" },
};

/** One value, as the tile says it in a column. */
const show = (value: readonly string[], field: RowDisagreement["field"]): string =>
  value.length === 0 ? NONE_ON_CARD[field].column : joined(value);

/** One value inside a sentence or a button name: “Padres”, or `no team` for none. */
const quoted = (value: readonly string[], field: RowDisagreement["field"]): string =>
  value.length === 0 ? NONE_ON_CARD[field].use : `“${joined(value)}”`;

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

export default function SourcesDisagreeTile({ row, leafCards }: TidyTileProps) {
  const entries = row.sourceDisagreements ?? [];
  if (entries.length === 0) return null;

  const unsettled = entries.some((d) => !d.chosen);
  const level: TidyTileLevel = unsettled ? "fix" : "plain";

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
  const typedRef = useRef<HTMLInputElement | null>(null);
  const typeButtonRef = useRef<HTMLButtonElement | null>(null);
  const entryRef = useRef<HTMLDivElement | null>(null);
  const firstUseRef = useRef<HTMLButtonElement | null>(null);
  const answered = useAnswered();
  // Change unmounts itself and mounts the choices: focus is owed to the first
  // one once it exists. Read after every render, cleared once it lands. (A pick
  // is an answer: the walk moves focus on, not back to Change.)
  const focusFirstUse = useRef(false);
  useEffect(() => {
    if (!focusFirstUse.current || !firstUseRef.current) return;
    focusFirstUse.current = false;
    firstUseRef.current.focus({ preventScroll: true });
  });

  const closeTyping = () => {
    setTyping(false);
    requestAnimationFrame(() => typeButtonRef.current?.focus());
  };
  useInlinePart(typing, closeTyping, entryRef);

  const chosen = entry.chosen;
  const fieldLabel = FIELD_LABEL[entry.field];
  const sources = SOURCE_KEYS.filter((k) => entry.values.some((v) => (v.sources as readonly string[]).includes(k)));
  const single = entry.values.length === 2 && entry.values.every((v) => v.value.length === 1);

  const candidates = useMemo(() => {
    if (!chosen) return [];
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
      answered();
    } catch (e) {
      setError(userFacingMessage(e, "Didn't save, try again."));
    } finally {
      setBusy(false);
    }
  };

  const applyToSame = async () => {
    if (!chosen) return;
    const result = await pickSourceValue({
      cardId: row._id,
      field: entry.field,
      value: [...chosen.value],
      ...(chosen.typed ? { typed: true as const } : {}),
      cardIds: candidates.map((c) => c._id),
    });
    // The open card was written by the pick itself; the others are the cards
    // the server accepted (written by scheduled pages) and the ones it refused.
    return { applied: result.scheduled, skipped: result.refused };
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
    <div ref={entryRef} className="grid gap-2">
      {heading && <p className="text-xs font-medium text-ink-2">{fieldLabel}</p>}
      <ul
        aria-label={`What each source says: ${fieldLabel}`}
        className="grid list-none grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2 p-0"
      >
        {sources.map((source) => {
          const value = entry.values.find((v) => (v.sources as readonly string[]).includes(source))!;
          const other = single ? entry.values.find((v) => v !== value) : undefined;
          const parts =
            other && value.value.length > 0 && other.value.length > 0
              ? diffParts(joined(value.value), joined(other.value))
              : null;
          return (
            <li
              key={source}
              className="grid min-w-0 content-start gap-0.5 rounded-md border border-rule-strong bg-raised-deep px-2 py-1.5 text-sm text-ink"
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
                  show(value.value, entry.field)
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Mounted for the life of the entry: a pick is a change to a live region
          already in the page, and a card that opens already answered says nothing. */}
      <p className="text-sm text-ink wrap-anywhere empty:hidden" role="status">
        {chosen && !changing
          ? chosenFrom
            ? `Using ${quoted(chosen.value, entry.field)} (${chosenFrom})`
            : `Using ${quoted(chosen.value, entry.field)}`
          : ""}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {chosen && !changing && (
          <NeonButton
            variant="secondary"
            outline
            size="1"
            type="button"
            onClick={() => {
              focusFirstUse.current = true;
              setChanging(true);
            }}
            aria-label={`Change the ${fieldLabel.toLowerCase()}`}
          >
            Change
          </NeonButton>
        )}
        {choosing &&
          entry.values.map((v, i) => (
            <NeonButton
              key={v.value.join("\u001f")}
              ref={i === 0 ? firstUseRef : undefined}
              variant="secondary"
              outline
              size="1"
              type="button"
              className={WRAP_LABEL_CLASS}
              aria-disabled={busy || undefined}
              onClick={() => void pick(v.value, false)}
            >
              {`Use ${quoted(v.value, entry.field)}`}
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
            aria-label={`Type another… ${fieldLabel.toLowerCase()}`}
            onClick={() => {
              if (typing) {
                closeTyping();
                return;
              }
              setTyped(chosen ? joined(chosen.value) : "");
              setTyping(true);
              requestAnimationFrame(() => typedRef.current?.focus());
            }}
          >
            Type another…
          </NeonButton>
        )}
        {chosen && !changing && (
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
            aria-label={`Use this ${fieldLabel.toLowerCase()}`}
            aria-disabled={busy || parseTyped(typed).length === 0 || undefined}
            onClick={submitTyped}
          >
            Use this
          </NeonButton>
        </div>
      )}

      <p role="alert" className="text-xs text-neon-pink-text empty:hidden">
        {error}
      </p>
    </div>
  );
}
