import { useEffect, useId, useRef, useState } from "react";
import { useConvex, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_CARD_PLAYERS } from "../../convex/features/cardAttention";
import { userFacingMessage } from "@/lib/errors/user-facing-message";
import NeonButton from "@/components/modules/NeonButton";
import { ConfirmDialog } from "../modules/confirm-dialog";
import {
  LiveLine,
  RunGlyph,
  SleeveStrip,
  pulseText,
  type RunLineKind,
} from "../modules/RunLedger";
import PlayerPicker from "./PlayerPicker";
import {
  ALSO_ON_THIS_CARD_HEADING,
  EVERY_CARD_PLAYER_ACTION_LABELS,
  EVERY_CARD_PLAYER_PICKER_LABELS,
  PLAYER_ON_EVERY_CARD_HEADING,
} from "./player-picker-labels";

/**
 * NEO-528 — "Player on every card", in the Set Builder's Attributes panel,
 * directly under Team, at EVERY level the panel shows (sport down to
 * parallel).
 *
 * Two stored values on the row the panel is on (`convex/cardPlayersBulk.ts`):
 *
 *   - the player: every new card beneath that has no player of its own is
 *     born with them ("Player: Ken Griffey Jr. ×");
 *   - the cameos: every new card beneath is born with them ("Cameos: A × B ×").
 *
 * Nearest row wins, so a value stored above shows here muted, with no ×
 * ("Player: Ken Griffey Jr. (from 2024 Topps)"), until this row stores its own.
 *
 * One picker, two actions: green "Add to every card" stores the pick as the
 * player, blue-outline "Add as cameo" as a cameo. The pick shows as an
 * outlined "Picked:" chip until it is stored (a stored one is filled). With
 * no cards beneath, that is the whole job: saved, a note beside the actions,
 * done. With cards beneath, a confirm first,
 * then the store, then the whole-checklist run that brings the cards already
 * there along (`addPlayerToVariant` / `addCameoToVariant`), shown as the
 * NEO-312 run ledger (`modules/RunLedger`, Jason's spinner → check pattern):
 * one line per checklist, the sleeve strip, one polite live line. The run is
 * idempotent, so a stopped or failed run is finished by pressing again.
 *
 * A chip's × clears the stored value, asks nothing (cards keep what they
 * have), says so in the note beside the actions, and hands focus to the
 * picker's trigger.
 *
 * The note is the section's own status line, right where the action was
 * pressed: the panel's toast is pinned to the top of the viewport, which on
 * a phone covers the heading and sits a screen away from this control.
 *
 * Reads. `cardPlayerDefaults` walks every row beneath the one asked about (up
 * to ~500 at a sport or year), so it is SUBSCRIBED only from the set down; at
 * the sport, year and manufacturer it is asked once when the section opens and
 * again after each save or clear (CLAUDE.md "A subscribed query stays small").
 * Every other Convex call goes through `useConvex()` at call time.
 *
 * The picker is the third PlayerPicker the Set Builder can show at once (the
 * quick-add form's, the card drawer's two), so it takes its own label set;
 * see `player-picker-labels.ts`.
 */

/** Which stored value: the card's player, or a cameo. */
export type BulkKind = "player" | "cameo";

export type BulkTarget = {
  _id: Id<"selectorOptions">;
  name: string;
  role: "home" | "parallel";
};

export type BulkCounts = {
  scanned: number;
  changed: number;
  unchanged: number;
  promoted: number;
  skippedPrimary: number;
  skippedFull: number;
  skippedOther: number;
  skippedPending: number;
  /** Cards of another sport than the player's: never given them. */
  skippedSport: number;
  titlesRefreshed: number;
  titlesKept: number;
};

/** Counts as a page carries them: `skippedSport` is absent from an older server. */
type PageCounts = Omit<BulkCounts, "skippedSport"> & { skippedSport?: number };

/** One page as the server returns it. */
export type BulkPage = PageCounts & {
  targetId: Id<"selectorOptions">;
  targetIndex: number;
  targetCount: number;
  cursor: string | null;
};

export type BulkLine = {
  id: string;
  name: string;
  kind: RunLineKind;
  counts: BulkCounts;
  /** Why this line failed, in the operator's words. */
  error?: string;
};

export type BulkRun = {
  kind: BulkKind;
  playerName: string;
  lines: BulkLine[];
  phase: "running" | "done" | "stopped" | "failed";
  /** The server capped the checklists it would walk. */
  truncated: boolean;
  /** What the live line says now. */
  announcement: string;
};

type NamedPlayer = { _id: Id<"players">; name: string };

/** `cardPlayersBulk.cardPlayerDefaults`, as this control reads it. */
export type CardPlayerDefaultsView = {
  own: { player?: NamedPlayer; cameos: NamedPlayer[] };
  inherited?: {
    player?: NamedPlayer & { fromId: Id<"selectorOptions">; fromName: string };
    cameos?: { fromId: Id<"selectorOptions">; fromName: string; list: NamedPlayer[] };
  };
  cardCount?: number;
  cardsToWalk?: { player: number; cameo: number };
  truncated: boolean;
};

const ZERO: BulkCounts = {
  scanned: 0,
  changed: 0,
  unchanged: 0,
  promoted: 0,
  skippedPrimary: 0,
  skippedFull: 0,
  skippedOther: 0,
  skippedPending: 0,
  skippedSport: 0,
  titlesRefreshed: 0,
  titlesKept: 0,
};

const L = EVERY_CARD_PLAYER_ACTION_LABELS;

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const count = (n: number) => n.toLocaleString();
const cards = (n: number) => `${count(n)} card${n === 1 ? "" : "s"}`;
const checklists = (n: number) => `${count(n)} checklist${n === 1 ? "" : "s"}`;

function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/**
 * The run's reach, named from the row the panel is on: the row alone, "Diamond
 * Kings and its 3 parallels", or "2024 Topps (38 checklists)" when it holds
 * several checklists of its own (a set, a year, a sport).
 */
export function scopeText(rowName: string, targets: readonly BulkTarget[]): string {
  if (targets.length <= 1) return rowName;
  const homes = targets.filter((t) => t.role === "home").length;
  const parallels = targets.length - homes;
  if (homes <= 1 && parallels > 0) {
    return `${rowName} and its ${count(parallels)} parallel${parallels === 1 ? "" : "s"}`;
  }
  return `${rowName} (${checklists(targets.length)})`;
}

const cardTitles = (n: number) => `${count(n)} card title${n === 1 ? "" : "s"}`;

/**
 * "skipped 2 from a sport Ken Griffey Jr. doesn't play": the card's sport is
 * not one the player plays (a cross-sport set, or a set moved under another
 * sport), so the card is left alone.
 */
function skippedSportText(n: number, playerName: string): string {
  return `skipped ${count(n)} from a sport ${playerName} doesn't play`;
}

/** What a finished line says after its name. */
export function lineResultText(kind: BulkKind, c: BulkCounts, playerName: string): string {
  if (c.scanned === 0) return "no cards yet";
  const parts: string[] = [c.changed > 0 ? `added to ${cards(c.changed)}` : "nothing new"];
  if (kind === "player") {
    if (c.promoted > 0) parts.push(`${count(c.promoted)} moved up from cameo`);
    if (c.unchanged > 0) parts.push(`${count(c.unchanged)} already ${possessive(playerName)}`);
    if (c.skippedOther > 0) {
      parts.push(`skipped ${count(c.skippedOther)} that ${c.skippedOther === 1 ? "has" : "have"} a player`);
    }
    if (c.skippedPending > 0) {
      parts.push(`skipped ${count(c.skippedPending)} still waiting on a new name`);
    }
    if (c.skippedSport > 0) parts.push(skippedSportText(c.skippedSport, playerName));
    if (c.titlesRefreshed > 0) parts.push(`${cardTitles(c.titlesRefreshed)} updated`);
    if (c.titlesKept > 0) {
      parts.push(
        c.titlesRefreshed > 0
          ? `${count(c.titlesKept)} kept as you typed them`
          : `${cardTitles(c.titlesKept)} kept as you typed them`,
      );
    }
  } else {
    if (c.unchanged > 0) parts.push(`${count(c.unchanged)} already listed`);
    if (c.skippedPrimary > 0) {
      parts.push(`skipped ${count(c.skippedPrimary)} of ${possessive(playerName)} own`);
    }
    if (c.skippedFull > 0) {
      parts.push(
        `skipped ${count(c.skippedFull)} that ${c.skippedFull === 1 ? "is" : "are"} full (${MAX_CARD_PLAYERS} players)`,
      );
    }
    if (c.skippedSport > 0) parts.push(skippedSportText(c.skippedSport, playerName));
  }
  return parts.join(", ");
}

/** One ledger line, as a single text node: "{checklist} — {state}". */
export function bulkLineText(line: BulkLine, run: Pick<BulkRun, "kind" | "playerName">): string {
  switch (line.kind) {
    case "waiting":
      return `${line.name} — waiting`;
    case "building":
      return line.counts.scanned > 0
        ? `${line.name} — working, ${cards(line.counts.scanned)} checked`
        : `${line.name} — working…`;
    case "built":
    case "skipped":
      return `${line.name} — ${lineResultText(run.kind, line.counts, run.playerName)}`;
    case "unfinished":
      return `${line.name} — stopped partway, ${cards(line.counts.scanned)} checked`;
    case "stopped":
      return `${line.name} — not reached`;
    case "failed":
      return `${line.name} — ${line.error ?? "didn't finish"}`;
    default:
      return line.name;
  }
}

function totals(run: BulkRun): { changed: number; scanned: number } {
  return run.lines.reduce(
    (sum, line) => ({
      changed: sum.changed + line.counts.changed,
      scanned: sum.scanned + line.counts.scanned,
    }),
    { changed: 0, scanned: 0 },
  );
}

/**
 * The ledger's heading: which checklist the run is on while it runs, the
 * outcome once it ends. The running count is CHECKLISTS ("checklist 2 of
 * 13"), said so, because the outcome after it counts cards.
 */
export function bulkHeading(run: BulkRun): string {
  const who = run.playerName;
  const { changed, scanned } = totals(run);
  const n = run.lines.length;
  const done = run.lines.filter((l) => l.kind === "built" || l.kind === "skipped").length;
  const player = run.kind === "player";
  if (run.phase === "running") {
    const at = `checklist ${count(Math.min(done + 1, n))} of ${count(n)}`;
    return player ? `Adding ${who} to every card: ${at}` : `Adding ${who} as a cameo: ${at}`;
  }
  if (run.phase === "done") {
    if (changed > 0) {
      return player ? `Added ${who} to ${cards(changed)}` : `Added ${who} as a cameo on ${cards(changed)}`;
    }
    if (scanned === 0) {
      return player
        ? `No cards here yet; new cards get ${who}`
        : `No cards here yet; new cards get ${who} as a cameo`;
    }
    return player
      ? "Nothing to add: every card here already has a player"
      : `Nothing to add: ${who} is already on every card that can take them`;
  }
  const soFar = player
    ? `added ${who} to ${cards(changed)}`
    : `added ${who} as a cameo on ${cards(changed)}`;
  const again = "Run it again to finish; cards already done are skipped.";
  if (run.phase === "stopped") return `Stopped, like you asked. So far: ${soFar}. ${again}`;
  const where = run.lines.find((l) => l.kind === "failed");
  if (scanned === 0 && where) return `Stopped before any card changed. ${again}`;
  return `Stopped at ${where?.name ?? "a checklist"}. So far: ${soFar}. ${again}`;
}

export const BULK_CHECKLIST_CHANGED_TEXT = "This checklist changed mid-way. Give it another go.";
export const BULK_PLAYER_GONE_TEXT = "Can't find that player anymore. Pick them again.";
/** Anything the server didn't word for a person (a dropped connection, a crash). */
export const BULK_SIDEWAYS_TEXT = "Something went sideways. Give it another go.";

/**
 * A refusal in the operator's words. The server's own sentences (a
 * ConvexError's string) are shown as they are (`cardPlayersBulk.
 * BULK_CHECKLIST_CHANGED` and `BULK_MISSING_PLAYER` already are these two),
 * and any older wording about the run's bookkeeping, or a player gone, is
 * mapped onto them. Anything else is `BULK_SIDEWAYS_TEXT`, never its raw text.
 */
export function bulkErrorText(error: unknown): string {
  const message = userFacingMessage(error, "");
  if (!message) return BULK_SIDEWAYS_TEXT;
  if (/progress marker|cursor|changed mid-way/i.test(message)) {
    return BULK_CHECKLIST_CHANGED_TEXT;
  }
  if (/no longer exists|can't find that player/i.test(message)) {
    return BULK_PLAYER_GONE_TEXT;
  }
  return message;
}

/** The note after a store with no cards to walk. */
export function savedToastText(kind: BulkKind, playerName: string): string {
  return kind === "player"
    ? `Saved, every new card gets ${playerName}`
    : `Saved, every new card gets ${playerName} as a cameo`;
}

/** The note after a chip's ×. */
export function clearedToastText(playerName: string): string {
  return `Cleared, new cards won't get ${playerName}; cards that have them keep them`;
}

/** The sentence the server refuses a cameo of the row's own player with. */
export function alreadyThePlayerText(playerName: string): string {
  return `${playerName} is already the player on every card.`;
}

/** The hint under the heading; a parallel has no parallels of its own. */
export function bulkHintText(level: PanelLevel): string {
  const lead =
    level === "parallel"
      ? "Same face on every card in this parallel? Pick them once."
      : "Same face on every card? Pick them once.";
  return `${lead} "${L.addPlayer}" makes them the player wherever nobody's there yet; "${L.addCameo}" tucks them under "${ALSO_ON_THIS_CARD_HEADING}". New cards get them too.`;
}

export type ConfirmCopy = { title: string; description: string; confirmLabel: string };

/**
 * The confirm before a store that walks cards. `replacing` is the player new
 * cards get today (this row's or one inherited) when it is someone else;
 * `overridden` the checklists beneath that store their own value of this kind
 * and are left alone.
 */
export function confirmCopy({
  kind,
  playerName,
  scope,
  replacing,
  overridden,
}: {
  kind: BulkKind;
  playerName: string;
  scope: string;
  replacing?: string | null;
  overridden: number;
}): ConfirmCopy {
  const q = playerName;
  const own = (one: string, many: string) =>
    overridden > 0
      ? ` ${checklists(overridden)} here ${overridden === 1 ? one : many} and ${overridden === 1 ? "is" : "are"} left alone.`
      : "";
  if (kind === "player") {
    return {
      title: `Add ${q} to every card in ${scope}?`,
      description:
        `${q} becomes the player on every card that doesn't have one yet. Cards with a player stay put; titles you haven't edited pick up ${possessive(q)} name. ` +
        (replacing ? `${q} replaces ${replacing} for new cards.` : `New cards get ${q} too.`) +
        own("has its own player", "have their own player"),
      // The title names the player; the label stays short enough for a
      // phone. Worded apart from the "Add to every card" action it answers
      // (never a substring of it, nor it of this).
      confirmLabel: "Yes, add them to every card",
    };
  }
  return {
    title: `Add ${q} as a cameo on every card in ${scope}?`,
    description:
      `Each card gets ${q} under "${ALSO_ON_THIS_CARD_HEADING}". Cards that are ${possessive(q)} own, or already have them, are left as they are. New cards get ${q} too.` +
      own("has its own cameos", "have their own cameos"),
    confirmLabel: "Yes, add them as a cameo",
  };
}

// ---------------------------------------------------------------------------
// The run, as pure steps (tested directly)
// ---------------------------------------------------------------------------

export function startRun(
  kind: BulkKind,
  playerName: string,
  scope: string,
  targets: readonly BulkTarget[],
  truncated: boolean,
): BulkRun {
  const lines: BulkLine[] = targets.map((t, i) => ({
    id: t._id as string,
    name: t.name,
    kind: i === 0 ? "building" : "waiting",
    counts: ZERO,
  }));
  return {
    kind,
    playerName,
    lines,
    phase: "running",
    truncated,
    announcement:
      kind === "player"
        ? `Adding ${playerName} to every card in ${scope}.`
        : `Adding ${playerName} as a cameo on every card in ${scope}.`,
  };
}

const finished = (c: BulkCounts): RunLineKind => (c.scanned === 0 ? "skipped" : "built");

const add = (a: BulkCounts, b: PageCounts): BulkCounts => ({
  scanned: a.scanned + b.scanned,
  changed: a.changed + b.changed,
  unchanged: a.unchanged + b.unchanged,
  promoted: a.promoted + b.promoted,
  skippedPrimary: a.skippedPrimary + b.skippedPrimary,
  skippedFull: a.skippedFull + b.skippedFull,
  skippedOther: a.skippedOther + b.skippedOther,
  skippedPending: a.skippedPending + b.skippedPending,
  skippedSport: a.skippedSport + (b.skippedSport ?? 0),
  titlesRefreshed: a.titlesRefreshed + b.titlesRefreshed,
  titlesKept: a.titlesKept + b.titlesKept,
});

/**
 * Fold one page in. Every line before the page's target is finished (the
 * server has moved past it); the page's own line takes its counts and is
 * finished too when the page said it was the last (`cursor` null) or when
 * the next page starts on the next target — which `applyPage` learns only
 * from that next page, so until then the line stays "working".
 */
export function applyPage(run: BulkRun, page: BulkPage): BulkRun {
  const last = page.cursor === null;
  const lines = run.lines.map((line, i): BulkLine => {
    if (i < page.targetIndex) {
      return line.kind === "building" || line.kind === "waiting"
        ? { ...line, kind: finished(line.counts) }
        : line;
    }
    if (i === page.targetIndex) {
      const counts = add(line.counts, page);
      return { ...line, counts, kind: last ? finished(counts) : "building" };
    }
    return last && line.kind === "waiting" ? { ...line, kind: "skipped" } : line;
  });
  const next: BulkRun = { ...run, lines, phase: last ? "done" : "running" };
  const doneCount = lines.filter((l) => l.kind === "built" || l.kind === "skipped").length;
  const before = run.lines.filter((l) => l.kind === "built" || l.kind === "skipped").length;
  if (last) next.announcement = bulkHeading(next);
  else if (doneCount !== before) next.announcement = pulseText(doneCount, lines.length);
  return next;
}

/** The operator pressed Stop and the page in flight has landed. */
export function stopRun(run: BulkRun): BulkRun {
  const lines = run.lines.map((line): BulkLine => {
    if (line.kind === "building") {
      return { ...line, kind: line.counts.scanned > 0 ? "unfinished" : "stopped" };
    }
    if (line.kind === "waiting") return { ...line, kind: "stopped" };
    return line;
  });
  const next: BulkRun = { ...run, lines, phase: "stopped" };
  next.announcement = bulkHeading(next);
  return next;
}

/** A page was refused: the line it was working on fails, the rest are not reached. */
export function failRun(run: BulkRun, message: string): BulkRun {
  let marked = false;
  const lines = run.lines.map((line): BulkLine => {
    if (!marked && (line.kind === "building" || line.kind === "waiting")) {
      marked = true;
      return { ...line, kind: "failed", error: message };
    }
    if (line.kind === "building" || line.kind === "waiting") {
      return { ...line, kind: "stopped" };
    }
    return line;
  });
  const next: BulkRun = { ...run, lines, phase: "failed" };
  next.announcement = bulkHeading(next);
  return next;
}

// ---------------------------------------------------------------------------
// The control
// ---------------------------------------------------------------------------

export type PanelLevel =
  | "sport"
  | "year"
  | "manufacturer"
  | "setName"
  | "variantType"
  | "insert"
  | "parallel";

/**
 * Levels whose `cardPlayerDefaults` is small enough to subscribe to: the set
 * and below. Above it the walk down can reach hundreds of rows, so it is
 * asked once instead.
 */
const SUBSCRIBED_LEVELS: ReadonlySet<PanelLevel> = new Set([
  "setName",
  "variantType",
  "insert",
  "parallel",
]);

/** Past this many lines the ledger scrolls inside itself (NEO-321's cap). */
const SCROLL_AFTER = 40;
/** A runaway guard: no checklist needs more pages than this in one run. */
const MAX_PAGES = 5000;

export const BULK_STOP_LABEL = "Stop after these cards";
export const BULK_STOPPING_LABEL = "Stopping after these cards…";
export const BULK_ADD_PLAYER_LABEL = L.addPlayer;
export const BULK_ADD_CAMEO_LABEL = L.addCameo;
/** The finished ledger's close: visible "Dismiss", named apart from every notice's Dismiss. */
export const BULK_DISMISS_LABEL = "Dismiss this run";
/** The alert an Add pressed before anyone is picked raises. */
export const BULK_CHOOSE_FIRST_TEXT = "Choose who first";
/** The ledger's note when the server capped the checklists one run walks. */
export const BULK_TRUNCATED_TEXT =
  "Over 500 checklists here. This run covers the first 500; run the rest from their own set or insert.";
/** The busy line under the actions (their names stay put while it shows). */
export const BULK_COUNTING_TEXT = "Counting cards…";
export const BULK_SAVING_TEXT = "Saving…";
/** While the stored values (and the card count) are still loading: the actions wait. */
export const BULK_CHECKING_TEXT = "Checking…";
/** The visible label before a chosen, not yet stored, pick. */
export const BULK_PICKED_LABEL = "Picked:";
/** How long a "Saved…" / "Cleared…" note stays beside the actions. */
const NOTE_MS = 6000;
/**
 * Full size (32px) on a phone, the panel's compact 24px from Radix's `sm`
 * (768px) up: a thumb needs the bigger target, the desktop panel the
 * density. The picker's "+ Choose who" switches at the same width
 * (`roomyTriggerOnPhones`), so the row never mixes the two.
 */
const BULK_BUTTON_SIZE = { initial: "2", sm: "1" } as const;
const TRIGGER_SELECTOR = `button[aria-label="${EVERY_CARD_PLAYER_PICKER_LABELS.trigger}"]`;

type Asking = {
  kind: BulkKind;
  playerId: Id<"players">;
  playerName: string;
  scope: string;
  targets: BulkTarget[];
  truncated: boolean;
  copy: ConfirmCopy;
};

export default function EveryCardPlayerControl({
  variantId,
  level,
  rowName,
  sportId,
  expanded,
  onDismissedCollapsed,
}: {
  /** The row the Attributes panel is on, at any level. */
  variantId: Id<"selectorOptions">;
  /** Its level: which reads it may subscribe to, and the hint's wording. */
  level: PanelLevel;
  /** Its own NB name, for the confirm's scope ("Diamond Kings and its 3 parallels"). */
  rowName: string;
  /** The set's sport row, for the picker. */
  sportId?: Id<"selectorOptions">;
  /** The panel's own open state: the section shows only when it is open, a run's ledger always. */
  expanded: boolean;
  /**
   * Dismiss pressed with the panel shut: the ledger was everything this
   * control drew, so the panel puts focus somewhere of its own (its expand
   * toggle) rather than let it fall to <body>.
   */
  onDismissedCollapsed?: () => void;
}) {
  const convex = useConvex();
  const uid = useId();
  const headingId = `${uid}-heading`;
  const hintId = `${uid}-hint`;
  const runHeadingId = `${uid}-run-heading`;

  // --- what is stored -------------------------------------------------------
  const subscribe = SUBSCRIBED_LEVELS.has(level);
  const subscribed = useQuery(
    api.cardPlayersBulk.cardPlayerDefaults,
    subscribe && expanded ? { selectorOptionId: variantId } : "skip",
  ) as CardPlayerDefaultsView | null | undefined;
  const [fetched, setFetched] = useState<CardPlayerDefaultsView | null | undefined>(undefined);
  const [fetchTick, setFetchTick] = useState(0);
  useEffect(() => {
    if (subscribe || !expanded) return;
    let live = true;
    convex
      .query(api.cardPlayersBulk.cardPlayerDefaults, { selectorOptionId: variantId })
      .then(
        (answer) => {
          if (live) setFetched(answer as CardPlayerDefaultsView | null);
        },
        () => {
          // Unknown, not empty: the actions still work (they ask first).
          if (live) setFetched(null);
        },
      );
    return () => {
      live = false;
    };
  }, [convex, subscribe, expanded, variantId, fetchTick]);
  const defaults = subscribe ? subscribed : fetched;
  /**
   * The first read is still in flight: who is stored here and how many cards
   * sit beneath are unknown, so neither action can pick its path (save, or
   * confirm then walk) yet. A failed one-shot read is null, not this.
   */
  const checking = expanded && defaults === undefined;
  /** After a store or clear: a subscription follows by itself; a one-shot read is asked again. */
  const refresh = () => {
    if (!subscribe) setFetchTick((n) => n + 1);
  };

  // --- the pick ---------------------------------------------------------------
  const [picked, setPicked] = useState<Id<"players"> | null>(null);
  const pickedRows = useQuery(api.players.getManyByIds, picked ? { ids: [picked] } : "skip");
  const pickedName = picked ? (pickedRows?.find((p) => p._id === picked)?.name ?? null) : null;

  const [counting, setCounting] = useState<BulkKind | null>(null);
  const [saving, setSaving] = useState<BulkKind | null>(null);
  const [clearing, setClearing] = useState(false);
  const [prepError, setPrepErrorText] = useState<string | null>(null);
  /** "Saved, …" / "Cleared, …": shown on the busy line for a while, then gone. */
  const [note, setNoteText] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setNote = (message: string | null) => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = null;
    setNoteText(message);
    if (message !== null) {
      noteTimer.current = setTimeout(() => {
        noteTimer.current = null;
        setNoteText(null);
      }, NOTE_MS);
    }
  };
  useEffect(
    () => () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
    },
    [],
  );
  /**
   * a11y — bumped with every failure and keyed onto the alert, so the same
   * sentence raised twice is a new alert node and is read again.
   */
  const [prepErrorSeq, setPrepErrorSeq] = useState(0);
  const setPrepError = (message: string | null) => {
    setPrepErrorText(message);
    if (message !== null) setPrepErrorSeq((n) => n + 1);
  };
  const [asking, setAsking] = useState<Asking | null>(null);
  const [run, setRun] = useState<BulkRun | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopRef = useRef(false);
  const formRef = useRef<HTMLDivElement | null>(null);
  const ledgerRef = useRef<HTMLElement | null>(null);
  /** Where focus goes next: the ledger, or back to the action pressed. */
  const parkRef = useRef<"ledger" | BulkKind | null>(null);
  /** Bumped to run the park effect when nothing else it watches changed. */
  const [parkTick, setParkTick] = useState(0);

  const running = run?.phase === "running";
  const busy = running || counting !== null || saving !== null;
  const phase = run?.phase ?? null;

  // a11y — two moments leave focus with nowhere to be. (1) The form is
  // `inert` while the confirm is up, which blurs the button that opened it,
  // so `ConfirmDialog`'s own restore captured <body>: park after the commit
  // that lifted `inert`. (2) A prep failure: the pressed action is
  // aria-disabled (never natively disabled), so it keeps focus, but a
  // re-render must not strand it; put it back when it is not already there.
  useEffect(() => {
    if (asking !== null || parkRef.current === null) return;
    const target = parkRef.current;
    parkRef.current = null;
    if (target === "ledger") {
      ledgerRef.current?.focus({ preventScroll: true });
      return;
    }
    const button = formRef.current?.querySelector<HTMLButtonElement>(`[data-bulk-op="${target}"]`);
    if (button && document.activeElement !== button) button.focus();
  }, [asking, parkTick]);

  // a11y — when a run stops running, the Stop button it carried unmounts.
  // If focus went with it (to <body>) or still sits inside the ledger, land
  // it on the ledger so its outcome heading is read next. Only then: a
  // keyboard user who moved on (Tab to another field) keeps their place. In
  // a frame, after the browser has finished moving focus off the removed
  // node, and only if it really is on <body> (raf-focus-park-race).
  const wasRunning = useRef(false);
  useEffect(() => {
    if (phase === "running") {
      wasRunning.current = true;
      return;
    }
    if (!wasRunning.current) return;
    wasRunning.current = false;
    const frame = requestAnimationFrame(() => {
      const ledger = ledgerRef.current;
      if (!ledger) return;
      const active = document.activeElement;
      const stranded = active === null || active === document.body;
      const insideLedger = active !== ledger && active !== null && ledger.contains(active);
      if (stranded || insideLedger) ledger.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const parkOn = (target: BulkKind) => {
    parkRef.current = target;
    setParkTick((n) => n + 1);
  };

  const store = async (kind: BulkKind, playerId: Id<"players">) => {
    await convex.mutation(api.cardPlayersBulk.setCardPlayerDefault, {
      selectorOptionId: variantId,
      kind,
      playerId,
    });
    refresh();
  };

  /** Who new cards get as their player today, when it is not `playerId`. */
  const replacingName = (playerId: Id<"players">): string | null => {
    const current = defaults?.own.player ?? defaults?.inherited?.player;
    return current && current._id !== playerId ? current.name : null;
  };

  const ask = async (kind: BulkKind) => {
    if (!picked || !pickedName || busy || clearing || checking) return;
    setPrepError(null);
    setNote(null);
    const playerId = picked;
    const playerName = pickedName;
    // The server refuses it with the same sentence; said before any count.
    if (kind === "cameo" && defaults?.own.player?._id === playerId) {
      setPrepError(alreadyThePlayerText(playerName));
      parkOn(kind);
      return;
    }
    // Nothing beneath to walk: the store is the whole job, and a question
    // with one honest answer is not asked.
    if (defaults?.cardsToWalk?.[kind] === 0) {
      setSaving(kind);
      try {
        await store(kind, playerId);
        setNote(savedToastText(kind, playerName));
        setPicked(null);
      } catch (e) {
        setPrepError(bulkErrorText(e));
        parkOn(kind);
      } finally {
        setSaving(null);
      }
      return;
    }
    // Cards beneath, or a count nobody knows: list the run's checklists, then ask.
    setCounting(kind);
    try {
      const { targets, truncated, overridden } = await convex.query(
        api.cardPlayersBulk.everyCardTargets,
        { variantId, kind },
      );
      if (targets.length === 0) {
        await store(kind, playerId);
        setNote(savedToastText(kind, playerName));
        setPicked(null);
        return;
      }
      const scope = scopeText(rowName, targets);
      setAsking({
        kind,
        playerId,
        playerName,
        scope,
        targets,
        truncated,
        copy: confirmCopy({
          kind,
          playerName,
          scope,
          replacing: kind === "player" ? replacingName(playerId) : null,
          overridden: overridden ?? 0,
        }),
      });
    } catch (e) {
      setPrepError(bulkErrorText(e));
      parkOn(kind);
    } finally {
      setCounting(null);
    }
  };

  const go = async (plan: Asking) => {
    stopRef.current = false;
    setStopping(false);
    let state = startRun(plan.kind, plan.playerName, plan.scope, plan.targets, plan.truncated);
    // The ledger mounts now, so focus has somewhere to land while the store
    // and the first page are in flight.
    setRun(state);
    try {
      await store(plan.kind, plan.playerId);
      const call =
        plan.kind === "player"
          ? api.cardPlayersBulk.addPlayerToVariant
          : api.cardPlayersBulk.addCameoToVariant;
      let cursor: string | null = null;
      for (let pages = 0; pages < MAX_PAGES; pages++) {
        const page: BulkPage = await convex.mutation(call, {
          variantId,
          playerId: plan.playerId,
          cursor,
        });
        state = applyPage(state, page);
        cursor = page.cursor;
        if (cursor === null) break;
        if (stopRef.current) {
          state = stopRun(state);
          break;
        }
        setRun(state);
      }
      if (state.phase === "running") state = stopRun(state);
    } catch (e) {
      state = failRun(state, bulkErrorText(e));
    }
    // Done: the stored chip says who it was. Stopped or failed: the pick
    // stays, so pressing again finishes the run.
    if (state.phase === "done") setPicked(null);
    setRun(state);
    setStopping(false);
  };

  const focusTrigger = () => {
    formRef.current?.querySelector<HTMLElement>(TRIGGER_SELECTOR)?.focus();
  };

  const clear = async (kind: BulkKind, player: NamedPlayer) => {
    if (busy || clearing) return;
    setPrepError(null);
    setNote(null);
    // Before the write: the × goes away with the stored value, and focus
    // must not go with it.
    focusTrigger();
    setClearing(true);
    try {
      await convex.mutation(api.cardPlayersBulk.clearCardPlayerDefault, {
        selectorOptionId: variantId,
        kind,
        playerId: player._id,
      });
      refresh();
      setNote(clearedToastText(player.name));
    } catch (e) {
      setPrepError(bulkErrorText(e));
    } finally {
      setClearing(false);
    }
  };

  const dismiss = () => {
    setRun(null);
    // The ledger (and the focus in it) goes; the form's first action is
    // where the next run starts. Collapsed, there is no form to land on, so
    // the panel takes it (its expand toggle), before the ledger unmounts.
    if (expanded) parkOn("player");
    else onDismissedCollapsed?.();
  };

  const scrolls = (run?.lines.length ?? 0) > SCROLL_AFTER;
  const ledgerList = run && (
    <ul className="space-y-0.5">
      {run.lines.map((line) => (
        <li key={line.id} className="leading-5">
          <div className="flex items-start gap-1.5 py-0.5">
            <RunGlyph kind={line.kind} />
            <span className="min-w-0 break-words">{bulkLineText(line, run)}</span>
          </div>
        </li>
      ))}
    </ul>
  );

  const ledger = run && (
    // a11y — a labelled region, not a live one (the heading ticks on every
    // page); the one live line below speaks the start, the pulses and the
    // end. `tabIndex={-1}` is where focus parks once a run starts and ends.
    // It stays on screen until dismissed, panel open or not: closing the
    // panel must neither hide work still writing cards nor throw away what a
    // finished run did.
    <section
      ref={ledgerRef}
      tabIndex={-1}
      aria-labelledby={runHeadingId}
      className="p-3 bg-notice-info-bg border border-notice-info-rule shadow-offset rounded-md text-notice-info-ink text-sm focus-outline"
    >
      <div className="flex items-start justify-between gap-3">
        <h5 id={runHeadingId} className="min-w-0 wrap-anywhere font-semibold tabular-nums">
          {bulkHeading(run)}
        </h5>
        {running ? (
          <button
            type="button"
            onClick={() => {
              if (stopping) return;
              stopRef.current = true;
              setStopping(true);
            }}
            aria-disabled={stopping || undefined}
            className="shrink-0 rounded-sm font-semibold underline decoration-dotted hover:decoration-solid py-1.5 -my-1.5 aria-disabled:no-underline aria-disabled:cursor-not-allowed aria-disabled:opacity-75"
          >
            {stopping ? BULK_STOPPING_LABEL : BULK_STOP_LABEL}
          </button>
        ) : (
          <button
            type="button"
            onClick={dismiss}
            aria-label={BULK_DISMISS_LABEL}
            className="shrink-0 rounded-sm font-semibold underline decoration-dotted hover:decoration-solid py-1.5 -my-1.5"
          >
            Dismiss
          </button>
        )}
      </div>
      <SleeveStrip
        items={run.lines.map((line) => ({
          key: line.id,
          kind: line.kind,
          title: bulkLineText(line, run),
        }))}
      />
      <div className="mt-2 text-xs">
        {scrolls ? (
          <div
            role="group"
            aria-label="Checklists in this run"
            tabIndex={0}
            className="max-h-[70vh] overflow-y-auto pr-1 rounded-sm focus-outline"
          >
            {ledgerList}
          </div>
        ) : (
          ledgerList
        )}
      </div>
      {run.truncated && (
        <p className="mt-2 text-xs">{BULK_TRUNCATED_TEXT}</p>
      )}
    </section>
  );

  /**
   * a11y — the run's one polite line, mounted before any run starts (with
   * the control, never with the ledger) so the start announcement is read:
   * a live region inserted already holding its text is often skipped.
   */
  const live = <LiveLine text={run?.announcement ?? ""} />;

  // aria-disabled, never native `disabled`: a press while counting keeps
  // focus on the button (native disabled would drop it to <body>), and the
  // pre-pick state stays reachable: pressing it then says why in the alert
  // and hands focus to the picker's trigger, where the fix is.
  const blocked = picked === null || pickedName === null || busy || clearing || checking;
  // The confirm makes the chips inert too, so they count as locked with it.
  const chipLocked = busy || clearing || asking !== null;
  const press = (kind: BulkKind) => {
    // Still reading what is stored: the "Checking…" line says so.
    if (checking) return;
    if (picked === null) {
      setPrepError(BULK_CHOOSE_FIRST_TEXT);
      focusTrigger();
      return;
    }
    if (!blocked) void ask(kind);
  };
  /**
   * The busy line: the actions keep their names, this says what they're
   * doing, then (as the section's status) what a save or clear did.
   */
  const busyText =
    counting !== null
      ? BULK_COUNTING_TEXT
      : saving !== null
        ? BULK_SAVING_TEXT
        : checking
          ? BULK_CHECKING_TEXT
          : "";
  const statusText = busyText || note || "";

  const ownPlayer = defaults?.own.player;
  const ownCameos = defaults?.own.cameos ?? [];
  const inheritedPlayer = ownPlayer ? undefined : defaults?.inherited?.player;
  const inheritedCameos = ownCameos.length > 0 ? undefined : defaults?.inherited?.cameos;
  const showPlayerLine = !!ownPlayer || !!inheritedPlayer;
  const showCameoLine = ownCameos.length > 0 || !!inheritedCameos;

  const chip = (kind: BulkKind, player: NamedPlayer) => (
    <span
      key={player._id}
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-chip px-2 py-0.5 text-xs text-ink"
    >
      <span className="min-w-0 wrap-anywhere">{player.name}</span>
      <button
        type="button"
        aria-label={kind === "player" ? L.stopPlayer(player.name) : L.stopCameo(player.name)}
        aria-disabled={chipLocked || undefined}
        onClick={() => {
          if (!chipLocked) void clear(kind, player);
        }}
        // PlayerPicker's ×, exactly: quiet ink-2 at rest, a pink fill with
        // black ink under the pointer or focus (6:1 both modes, NEO-356).
        // 24px box from the desktop panel up; a thumb gets 32px (WCAG 2.5.8
        // is the floor, a phone wants more). `!`: `.hit-area-24` is unlayered.
        className="hit-area-24 max-md:before:size-8! -mx-1 rounded-full px-1 text-ink-2 hover:bg-neon-pink hover:text-on-neon-pink focus:bg-neon-pink focus:text-on-neon-pink focus-outline aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
      >
        ×
      </button>
    </span>
  );

  const label = (text: string) => <span className="shrink-0 text-ink-3">{text}</span>;
  // "Ken Griffey Jr. (from 2024 Topps)": the value first, in the quiet ink
  // the panel's values wear, where it came from second, quieter still. One
  // element, so it reads (and is found) as one line.
  const inheritedLine = (fromName: string, names: string) => (
    <span className="min-w-0 wrap-anywhere">
      <span className="text-ink-2">{names}</span> <span className="text-ink-3">{`(from ${fromName})`}</span>
    </span>
  );

  return (
    <>
      {expanded && (
        // Drawn as the Team row's sibling (the same box and label weight):
        // the two are the attributes here that reach every card beneath.
        <section
          aria-labelledby={headingId}
          className="flex flex-col gap-1.5 p-2 rounded border text-xs border-rule-strong bg-raised-deep/30"
        >
          <h4 id={headingId} className="text-[11px] uppercase tracking-wide text-ink-3 font-normal">
            {PLAYER_ON_EVERY_CARD_HEADING}
          </h4>
          {/* a11y — one inert wrapper over the stored chips and the form while
              the confirm is up: nothing behind it (a chip's × included) can be
              reached or pressed until it is answered. */}
          <div inert={asking !== null} className="flex flex-col gap-1.5">
            {showPlayerLine && (
              <p className="flex flex-wrap items-center gap-1.5">
                {label("Player:")}
                {ownPlayer
                  ? chip("player", ownPlayer)
                  : inheritedPlayer && inheritedLine(inheritedPlayer.fromName, inheritedPlayer.name)}
              </p>
            )}
            {showCameoLine && (
              <p className="flex flex-wrap items-center gap-1.5">
                {label("Cameos:")}
                {ownCameos.length > 0
                  ? ownCameos.map((c) => chip("cameo", c))
                  : inheritedCameos &&
                    inheritedLine(inheritedCameos.fromName, inheritedCameos.list.map((c) => c.name).join(", "))}
              </p>
            )}
            <div ref={formRef} className="flex flex-wrap items-center gap-2">
              {/* Not stored yet: labelled, and its chip outlined rather than
                  filled, so it never reads as one of the stored chips above. */}
              {picked !== null && label(BULK_PICKED_LABEL)}
              <PlayerPicker
                value={picked ? [picked] : []}
                // One player at a time: a new pick replaces the last.
                onChange={(next) => {
                  setPrepError(null);
                  setPicked(next.length > 0 ? next[next.length - 1] : null);
                }}
                sportId={sportId}
                disabled={busy}
                labels={EVERY_CARD_PLAYER_PICKER_LABELS}
                ariaDescribedBy={hintId}
                roomyTriggerOnPhones
                chipLook="outline"
              />
              {/* a11y — the names never change while counting or saving
                  (a spec, and a screen reader, keeps finding the button it
                  pressed); `aria-busy` and the line below say what is going
                  on. The hint describes both: it says what each one does. */}
              <NeonButton
                type="button"
                size={BULK_BUTTON_SIZE}
                data-bulk-op="player"
                aria-disabled={blocked || undefined}
                aria-busy={checking || counting === "player" || saving === "player" || undefined}
                aria-describedby={hintId}
                onClick={() => press("player")}
              >
                {L.addPlayer}
              </NeonButton>
              <NeonButton
                type="button"
                size={BULK_BUTTON_SIZE}
                variant="secondary"
                outline
                data-bulk-op="cameo"
                aria-disabled={blocked || undefined}
                aria-busy={checking || counting === "cameo" || saving === "cameo" || undefined}
                aria-describedby={hintId}
                onClick={() => press("cameo")}
              >
                {L.addCameo}
              </NeonButton>
              {/* The section's status line. Always mounted (empty at rest, so
                  it takes no room), so the first "Checking…" or "Counting
                  cards…" is read; a save's or a clear's note follows in the
                  same place, in the green every confirmation wears. */}
              <span
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className={`min-w-0 wrap-anywhere text-xs ${busyText ? "text-ink-2" : "text-neon-green-text"}`}
              >
                {statusText}
              </span>
            </div>
          </div>
          {prepError && (
            <p key={prepErrorSeq} role="alert" className="text-[11px] text-notice-danger-ink">
              {prepError}
            </p>
          )}
          <p id={hintId} className="text-xs text-ink-3">
            {bulkHintText(level)}
          </p>
          {asking && (
            <ConfirmDialog
              title={asking.copy.title}
              description={asking.copy.description}
              confirmLabel={asking.copy.confirmLabel}
              // Adding, not taking away: the green yes, beside a pink Cancel.
              confirmVariant="primary"
              busyLabel="Starting…"
              busy={false}
              onConfirm={() => {
                const plan = asking;
                parkRef.current = "ledger";
                setAsking(null);
                void go(plan);
              }}
              onCancel={() => {
                parkRef.current = asking.kind;
                setAsking(null);
              }}
            />
          )}
        </section>
      )}
      {ledger}
      {live}
    </>
  );
}
