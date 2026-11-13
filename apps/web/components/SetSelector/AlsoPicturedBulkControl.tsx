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
  ALSO_ON_EVERY_CARD_HEADING,
  BULK_ALSO_PICTURED_PICKER_LABELS,
} from "./player-picker-labels";

/**
 * NEO-528 — one player added to, or taken off, the "Also on this card" list of
 * every card in a checklist and its parallels, from the Set Builder's
 * Attributes panel. The case it exists for: a manager's card set, a team
 * photo insert, a "Combo" checklist where the same second face is on every
 * card, which would otherwise be one drawer edit per card per parallel.
 *
 * The server owns the walk (`convex/cardSecondaryPlayers.ts`): which rows
 * are this checklist's parallels (by shape and variant-type kind, never a
 * name), and a page of cards per call. This control drives the pages and
 * shows them as the NEO-312 run ledger (`modules/RunLedger`, Jason's
 * spinner → check pattern): one line per checklist, the sleeve strip, one
 * polite live line. The run is idempotent — a card already as asked is
 * counted and left alone — so a stopped or failed run is finished by running
 * it again.
 *
 * Every Convex call goes through `useConvex()` at call time: the targets are
 * asked once per press (never subscribed — a checklist with hundreds of
 * parallels must not re-run under every write), and the tests that render
 * the Attributes panel hand-build an `api` mock without this module.
 *
 * The picker is the third PlayerPicker the Set Builder can show at once
 * (the quick-add form's, the card drawer's two), so it takes its own label
 * set; see `player-picker-labels.ts`.
 */

export type BulkOp = "add" | "remove";

export type BulkTarget = {
  _id: Id<"selectorOptions">;
  name: string;
  role: "home" | "parallel";
};

export type BulkCounts = {
  scanned: number;
  changed: number;
  unchanged: number;
  skippedPrimary: number;
  skippedFull: number;
};

/** One page as the server returns it. */
export type BulkPage = BulkCounts & {
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
  op: BulkOp;
  playerName: string;
  lines: BulkLine[];
  phase: "running" | "done" | "stopped" | "failed";
  /** The server capped the parallels it would walk. */
  truncated: boolean;
  /** What the live line says now. */
  announcement: string;
};

const ZERO: BulkCounts = {
  scanned: 0,
  changed: 0,
  unchanged: 0,
  skippedPrimary: 0,
  skippedFull: 0,
};

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const cards = (n: number) => `${n.toLocaleString()} card${n === 1 ? "" : "s"}`;

function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/** "Base and its 12 parallels", or the checklist alone. */
export function scopeText(targets: readonly BulkTarget[]): string {
  const home = targets[0]?.name ?? "this checklist";
  const parallels = targets.length - 1;
  if (parallels <= 0) return home;
  return `${home} and its ${parallels.toLocaleString()} parallel${parallels === 1 ? "" : "s"}`;
}

/** What a finished line says after its name. */
export function lineResultText(
  op: BulkOp,
  counts: BulkCounts,
  playerName: string,
): string {
  if (counts.scanned === 0) return "no cards yet";
  const parts: string[] = [];
  if (op === "add") {
    parts.push(
      counts.changed > 0 ? `added to ${cards(counts.changed)}` : "nothing new",
    );
    if (counts.unchanged > 0) parts.push(`${counts.unchanged.toLocaleString()} already listed`);
    if (counts.skippedPrimary > 0) {
      parts.push(
        `skipped ${counts.skippedPrimary.toLocaleString()} of ${possessive(playerName)} own`,
      );
    }
    if (counts.skippedFull > 0) {
      parts.push(
        `skipped ${counts.skippedFull.toLocaleString()} already listing ${MAX_CARD_PLAYERS}`,
      );
    }
  } else {
    parts.push(
      counts.changed > 0 ? `taken off ${cards(counts.changed)}` : "not on any card here",
    );
  }
  return parts.join(", ");
}

/** One ledger line, as a single text node: "{checklist} — {state}". */
export function bulkLineText(line: BulkLine, run: Pick<BulkRun, "op" | "playerName">): string {
  switch (line.kind) {
    case "waiting":
      return `${line.name} — waiting`;
    case "building":
      return line.counts.scanned > 0
        ? `${line.name} — working, ${cards(line.counts.scanned)} checked`
        : `${line.name} — working…`;
    case "built":
    case "skipped":
      return `${line.name} — ${lineResultText(run.op, line.counts, run.playerName)}`;
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

function totalChanged(run: BulkRun): number {
  return run.lines.reduce((sum, line) => sum + line.counts.changed, 0);
}

/**
 * The ledger's heading: which checklist the run is on while it runs, the
 * outcome once it ends. The running count is CHECKLISTS ("checklist 2 of
 * 13"), said so, because the outcome after it counts cards; a bare "0 of 1"
 * read as cards and then the run said "Added Dan Marino to 19 cards".
 */
export function bulkHeading(run: BulkRun): string {
  const who = run.playerName;
  const changed = totalChanged(run);
  const n = run.lines.length;
  const done = run.lines.filter((l) => l.kind === "built" || l.kind === "skipped").length;
  if (run.phase === "running") {
    const at = `checklist ${Math.min(done + 1, n).toLocaleString()} of ${n.toLocaleString()}`;
    return run.op === "add"
      ? `Adding ${who} to every card: ${at}`
      : `Taking ${who} off every card: ${at}`;
  }
  if (run.phase === "done") {
    if (run.op === "add") {
      return changed > 0
        ? `Added ${who} to ${cards(changed)}`
        : `Nothing to add: ${who} is already on every card that can take them`;
    }
    return changed > 0
      ? `Took ${who} off ${cards(changed)}`
      : `${who} wasn't on any of these cards`;
  }
  const soFar =
    run.op === "add"
      ? `added ${who} to ${cards(changed)}`
      : `took ${who} off ${cards(changed)}`;
  if (run.phase === "stopped") {
    return `Stopped after you asked. So far: ${soFar}. Run it again to finish; cards already done are skipped.`;
  }
  const where = run.lines.find((l) => l.kind === "failed");
  return `Stopped at ${where?.name ?? "a checklist"}. So far: ${soFar}. Run it again to finish; cards already done are skipped.`;
}

export const BULK_CHECKLIST_CHANGED_TEXT = "This checklist changed mid-way. Give it another go.";
export const BULK_PLAYER_GONE_TEXT = "Can't find that player anymore. Pick them again.";

/**
 * A refusal in the operator's words. The server's own sentences are shown as
 * they are (`cardSecondaryPlayers.BULK_CHECKLIST_CHANGED` and
 * `BULK_MISSING_PLAYER` already are these two), and any older wording about
 * the run's bookkeeping, or a player gone, is mapped onto them.
 */
export function bulkErrorText(error: unknown): string {
  const message = userFacingMessage(error, "");
  if (!message) return "The connection dropped before these cards saved.";
  if (/progress marker|cursor|changed mid-way/i.test(message)) {
    return BULK_CHECKLIST_CHANGED_TEXT;
  }
  if (/no longer exists|can't find that player/i.test(message)) {
    return BULK_PLAYER_GONE_TEXT;
  }
  return message;
}

// ---------------------------------------------------------------------------
// The run, as pure steps (tested directly)
// ---------------------------------------------------------------------------

export function startRun(
  op: BulkOp,
  playerName: string,
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
    op,
    playerName,
    lines,
    phase: "running",
    truncated,
    announcement:
      op === "add"
        ? `Adding ${playerName} to every card in ${scopeText(targets)}.`
        : `Taking ${playerName} off every card in ${scopeText(targets)}.`,
  };
}

const finished = (counts: BulkCounts): RunLineKind =>
  counts.scanned === 0 ? "skipped" : "built";

const add = (a: BulkCounts, b: BulkCounts): BulkCounts => ({
  scanned: a.scanned + b.scanned,
  changed: a.changed + b.changed,
  unchanged: a.unchanged + b.unchanged,
  skippedPrimary: a.skippedPrimary + b.skippedPrimary,
  skippedFull: a.skippedFull + b.skippedFull,
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

/** Past this many lines the ledger scrolls inside itself (NEO-321's cap). */
const SCROLL_AFTER = 40;
/** A runaway guard: no checklist needs more pages than this in one run. */
const MAX_PAGES = 5000;

export const BULK_STOP_LABEL = "Stop after these cards";
export const BULK_STOPPING_LABEL = "Stopping after these cards…";
export const BULK_ADD_LABEL = "Add to every card";
export const BULK_REMOVE_LABEL = "Take off every card";
/** The finished ledger's close: visible "Dismiss", named apart from every notice's Dismiss. */
export const BULK_DISMISS_LABEL = "Dismiss this run";
const CHOOSE_FIRST = "Choose who first";
/**
 * Full size (32px) on a phone, the panel's compact 24px from Radix's `sm`
 * (768px) up: a thumb needs the bigger target, the desktop panel the
 * density. The picker's "+ Choose who" switches at the same width
 * (`roomyTriggerOnPhones`), so the row never mixes the two.
 */
const BULK_BUTTON_SIZE = { initial: "2", sm: "1" } as const;

type Asking = {
  op: BulkOp;
  playerId: Id<"players">;
  playerName: string;
  targets: BulkTarget[];
  truncated: boolean;
};

/** The hint under the heading; a parallel has no parallels of its own. */
export function bulkHintText(level: "variantType" | "insert" | "parallel"): string {
  return level === "parallel"
    ? "Same face on every card? Pick them once to add them to every card in this parallel, or take them off. Cards that already have them are skipped."
    : "Same face on every card? Pick them once to add them to every card here and its parallels, or take them off. Cards that already have them are skipped.";
}

export default function AlsoPicturedBulkControl({
  variantId,
  level,
  sportId,
  expanded,
  onDismissedCollapsed,
}: {
  /** Which kind of row it is, for the hint's "and its parallels". */
  level: "variantType" | "insert" | "parallel";
  /** The checklist the Attributes panel is on (a base variant type, an insert or a parallel). */
  variantId: Id<"selectorOptions">;
  /** The set's sport row, for the picker. */
  sportId?: Id<"selectorOptions">;
  /** The panel's own open state: the form shows only when it is open, a run's ledger always. */
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

  const [picked, setPicked] = useState<Id<"players"> | null>(null);
  const pickedRows = useQuery(
    api.players.getManyByIds,
    picked ? { ids: [picked] } : "skip",
  );
  const pickedName = picked
    ? (pickedRows?.find((p) => p._id === picked)?.name ?? null)
    : null;

  const [counting, setCounting] = useState<BulkOp | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [run, setRun] = useState<BulkRun | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopRef = useRef(false);
  const formRef = useRef<HTMLDivElement | null>(null);
  const ledgerRef = useRef<HTMLElement | null>(null);
  /** Where focus goes next: the ledger, or back to the action pressed. */
  const parkRef = useRef<"ledger" | BulkOp | null>(null);
  /** Bumped to run the park effect when nothing else it watches changed. */
  const [parkTick, setParkTick] = useState(0);

  const running = run?.phase === "running";
  const busy = running || counting !== null;
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
    const button = formRef.current?.querySelector<HTMLButtonElement>(
      `[data-bulk-op="${target}"]`,
    );
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

  const ask = async (op: BulkOp) => {
    if (!picked || !pickedName || busy) return;
    setPrepError(null);
    setCounting(op);
    try {
      const { targets, truncated } = await convex.query(
        api.cardSecondaryPlayers.secondaryPlayerBulkTargets,
        { variantId },
      );
      setAsking({ op, playerId: picked, playerName: pickedName, targets, truncated });
    } catch (e) {
      setPrepError(bulkErrorText(e));
      parkRef.current = op;
      setParkTick((n) => n + 1);
    } finally {
      setCounting(null);
    }
  };

  const go = async (plan: Asking) => {
    stopRef.current = false;
    setStopping(false);
    let state = startRun(plan.op, plan.playerName, plan.targets, plan.truncated);
    setRun(state);
    const call =
      plan.op === "add"
        ? api.cardSecondaryPlayers.addSecondaryPlayerToVariant
        : api.cardSecondaryPlayers.removeSecondaryPlayerFromVariant;
    let cursor: string | null = null;
    try {
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
    setRun(state);
    setStopping(false);
  };

  const dismiss = () => {
    setRun(null);
    // The ledger (and the focus in it) goes; the form's first action is
    // where the next run starts. Collapsed, there is no form to land on, so
    // the panel takes it (its expand toggle), before the ledger unmounts.
    if (expanded) {
      parkRef.current = "add";
      setParkTick((n) => n + 1);
    } else {
      onDismissedCollapsed?.();
    }
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
        <h5 id={runHeadingId} className="font-semibold tabular-nums">
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
        <p className="mt-2 text-xs">
          This checklist has more parallels than one run reaches; the ones past
          the first 500 need a run from their own row.
        </p>
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
  // pre-pick state stays reachable so its title can say why.
  const blocked = picked === null || pickedName === null || busy;
  const blockedTitle = picked ? undefined : CHOOSE_FIRST;

  return (
    <>
      {expanded && (
        <section aria-labelledby={headingId} className="space-y-2 rounded border border-rule-strong p-3">
          <h4 id={headingId} className="text-xs font-semibold text-ink">
            {ALSO_ON_EVERY_CARD_HEADING}
          </h4>
          <p id={hintId} className="text-[11px] text-ink-3">
            {bulkHintText(level)}
          </p>
          <div
            ref={formRef}
            inert={asking !== null}
            className="flex flex-wrap items-center gap-2"
          >
            <PlayerPicker
              value={picked ? [picked] : []}
              // One player at a time: a new pick replaces the last.
              onChange={(next) => {
                setPrepError(null);
                setPicked(next.length > 0 ? next[next.length - 1] : null);
              }}
              sportId={sportId}
              disabled={busy}
              labels={BULK_ALSO_PICTURED_PICKER_LABELS}
              ariaDescribedBy={hintId}
              roomyTriggerOnPhones
            />
            <NeonButton
              type="button"
              size={BULK_BUTTON_SIZE}
              data-bulk-op="add"
              aria-disabled={blocked || undefined}
              title={blockedTitle}
              onClick={() => {
                if (!blocked) void ask("add");
              }}
            >
              {counting === "add" ? "Counting cards…" : BULK_ADD_LABEL}
            </NeonButton>
            <NeonButton
              type="button"
              size={BULK_BUTTON_SIZE}
              variant="negative"
              outline
              data-bulk-op="remove"
              aria-disabled={blocked || undefined}
              title={blockedTitle}
              onClick={() => {
                if (!blocked) void ask("remove");
              }}
            >
              {counting === "remove" ? "Counting cards…" : BULK_REMOVE_LABEL}
            </NeonButton>
          </div>
          {prepError && (
            <p role="alert" className="text-[11px] text-notice-danger-ink">
              {prepError}
            </p>
          )}
          {asking && (
            <ConfirmDialog
              title={
                asking.op === "add"
                  ? `Add ${asking.playerName} to every card in ${scopeText(asking.targets)}?`
                  : `Take ${asking.playerName} off every card in ${scopeText(asking.targets)}?`
              }
              description={
                asking.op === "add"
                  ? `Each card gets ${asking.playerName} under Also on this card. Cards that are ${possessive(asking.playerName)} own, or already have them, are left as they are.`
                  : `${asking.playerName} comes off Also on this card on every card that has them. Nothing else on the cards changes.`
              }
              confirmLabel={
                asking.op === "add"
                  ? `Yes, add ${asking.playerName}`
                  : `Yes, take ${asking.playerName} off`
              }
              busyLabel="Starting…"
              busy={false}
              onConfirm={() => {
                const plan = asking;
                parkRef.current = "ledger";
                setAsking(null);
                void go(plan);
              }}
              onCancel={() => {
                parkRef.current = asking.op;
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
