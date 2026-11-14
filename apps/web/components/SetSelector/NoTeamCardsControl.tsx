import { useEffect, useId, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { NoTeamKeepReason } from "../../convex/lib/selectorTeams";
import NeonButton from "@/components/modules/NeonButton";
import { ConfirmDialog } from "../modules/confirm-dialog";
import { userFacingMessage } from "@/lib/errors/user-facing-message";
import {
  LiveLine,
  RunGlyph,
  SleeveStrip,
  pulseText,
  type RunLineKind,
} from "../modules/RunLedger";

/**
 * NEO-556 — "Mark N teamless cards No Team", the Attributes panel's follow-up
 * to a row whose Team is No Team.
 *
 * A No Team row reaches NEW cards on its own (each is born "No Team" when
 * nothing on it names a team). The cards already there never move by
 * themselves; this control is how the operator brings them along, with the
 * same shape as NEO-528's "Player on every card" run (`EveryCardPlayerControl`):
 *
 *   1. While the panel is open on a No Team row, `cardNoTeamBulk.noTeamTargets`
 *      is read ONCE (it counts up to 2,000 cards, so never subscribed) and, when
 *      any card would be marked, a button offers it with the count.
 *   2. Pressing it confirms first, saying how many get marked and, by reason,
 *      which are left alone and why (product invariant 8: a listing that
 *      names a team, or a team check still out, holds the stamp back).
 *   3. Confirm → `applyNoTeamPage`, page by page, shown as the NEO-312 run
 *      ledger (`modules/RunLedger`): one line per checklist, the sleeve strip,
 *      one polite live line. Idempotent, so a stopped or failed run is
 *      finished by pressing again.
 *
 * The ledger stays on screen until dismissed, panel open or not (the control
 * sits outside the panel's expanded branch for that reason, as NEO-528's does).
 */

type ReasonCounts = Record<NoTeamKeepReason, number>;

/** `noTeamTargets`, as this control reads it. */
export type NoTeamTargetsView = {
  targets: Array<{ _id: Id<"selectorOptions">; name: string; toStamp: number }>;
  toStamp: number;
  kept: ReasonCounts;
  rowsWithOtherDefault: number;
  /**
   * The walk stopped at `MAX_NO_TEAM_WALK` checklists: the ones past it are
   * NOT in `targets`, and the run never visits them.
   */
  walkTruncated: boolean;
  /** The count stopped at its cap: every count here is a floor ("at least"). */
  countTruncated: boolean;
};

/** One `applyNoTeamPage` answer. */
export type NoTeamPageView = {
  targetId: Id<"selectorOptions"> | null;
  targetIndex: number;
  targetCount: number;
  scanned: number;
  stamped: number;
  kept: ReasonCounts;
  cursor: string | null;
};

export type NoTeamLineCounts = { scanned: number; stamped: number; kept: ReasonCounts };

export type NoTeamLine = {
  id: string;
  name: string;
  kind: RunLineKind;
  counts: NoTeamLineCounts;
  error?: string;
};

export type NoTeamRun = {
  lines: NoTeamLine[];
  phase: "running" | "done" | "stopped" | "failed";
  /** The run covers only the first `MAX_NO_TEAM_WALK` checklists. */
  walkTruncated: boolean;
  announcement: string;
};

const ZERO_KEPT: ReasonCounts = {
  alreadyNoTeam: 0,
  hasTeam: 0,
  pendingName: 0,
  listingNamesTeam: 0,
  awaitingLookup: 0,
  lookupGaveUp: 0,
};
const ZERO: NoTeamLineCounts = { scanned: 0, stamped: 0, kept: ZERO_KEPT };

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const count = (n: number) => n.toLocaleString();
const cards = (n: number) => `${count(n)} card${n === 1 ? "" : "s"}`;
const checklists = (n: number) => `${count(n)} checklist${n === 1 ? "" : "s"}`;

/**
 * The offer's visible text, which is also its accessible name. `floor`: the
 * count stopped at its cap, so it says "at least".
 */
export function offerLabel(toStamp: number, floor = false): string {
  return `Mark ${floor ? "at least " : ""}${count(toStamp)} teamless card${toStamp === 1 ? "" : "s"} No Team`;
}
/**
 * The offer's status line once the count is in, said where "Counting cards…"
 * was so the wait ends in an answer rather than silence.
 */
export function noTeamCountResultText(view: Pick<NoTeamTargetsView, "toStamp" | "countTruncated">): string {
  const n = view.toStamp;
  if (n === 0) return "No teamless cards here.";
  const floor = view.countTruncated ? "At least " : "";
  return `${floor}${count(n)} teamless card${n === 1 ? "" : "s"} can be marked No Team.`;
}
/** Says what the offer does, and that nothing moves until it is pressed. */
export const NO_TEAM_OFFER_HINT =
  "Teamless new cards get No Team on their own. Cards already here change only when you mark them.";
export const NO_TEAM_CONFIRM_LABEL = "Yes, mark them No Team";
export const NO_TEAM_COUNTING_TEXT = "Counting cards…";
/** The count could not be read (the server's sentence shows beside it); asks once more. */
export const NO_TEAM_RECOUNT_LABEL = "Count teamless cards again";
/** A refused or failed count that the server did not word for a person. */
export const NO_TEAM_COUNT_FAILED_TEXT = "Couldn't count the cards here.";
/**
 * The ledger's Stop. Worded apart from NEO-528's "Stop after these cards",
 * whose ledger can be on screen at the same time.
 */
export const NO_TEAM_STOP_LABEL = "Stop marking cards";
export const NO_TEAM_STOPPING_LABEL = "Stopping…";
/** The finished ledger's close: visible "Dismiss", named apart from NEO-528's "Dismiss this run". */
export const NO_TEAM_DISMISS_LABEL = "Dismiss the No Team run";
/** The walk cap: checklists past the first 500 are not in this run at all. */
export const NO_TEAM_WALK_TRUNCATED_TEXT =
  "Over 500 checklists here. This run covers only the first 500; mark the rest from their own set or insert.";
/** The count cap (and no walk cap): the run still reaches every card. */
export const NO_TEAM_COUNT_TRUNCATED_TEXT =
  "NB stopped counting at 2,000 cards, so each count here is at least what it says. The run checks every card.";
/** Anything the server didn't word for a person. */
export const NO_TEAM_SIDEWAYS_TEXT = "Something went sideways. Give it another go.";

/**
 * The confirm's list of cards left alone, one line per reason with any cards,
 * in the order the verdict checks them. Each says why in a collector's words
 * and, where the operator can act, what happens next.
 */
export function keptReasonLines(view: Pick<NoTeamTargetsView, "kept" | "rowsWithOtherDefault">): string[] {
  const k = view.kept;
  const lines: string[] = [];
  const are = (n: number) => (n === 1 ? "is" : "are");
  const have = (n: number) => (n === 1 ? "has" : "have");
  if (k.alreadyNoTeam > 0) lines.push(`${cards(k.alreadyNoTeam)} ${are(k.alreadyNoTeam)} already No Team.`);
  if (k.hasTeam > 0) lines.push(`${cards(k.hasTeam)} ${have(k.hasTeam)} a team, and keep${k.hasTeam === 1 ? "s" : ""} it.`);
  // Where to act, by the checklist's own visible words: its "Attention" row
  // holds the "N need you" button that walks these cards.
  const those = (n: number) => (n === 1 ? "it" : "those");
  const their = (n: number) => (n === 1 ? "its" : "their");
  if (k.pendingName > 0) {
    const n = k.pendingName;
    lines.push(
      `${cards(n)} ${have(n)} a team name waiting for review. Link ${those(n)} under Attention on ${their(n)} checklist.`,
    );
  }
  if (k.listingNamesTeam > 0) {
    const n = k.listingNamesTeam;
    lines.push(
      `${cards(n)} come${n === 1 ? "s" : ""} with a team name NB hasn't matched yet. Pick those yourself.`,
    );
  }
  if (k.awaitingLookup > 0) {
    lines.push(
      `${cards(k.awaitingLookup)} ${are(k.awaitingLookup)} still waiting on a team check. Each gets No Team if the check finds none.`,
    );
  }
  if (k.lookupGaveUp > 0) {
    const n = k.lookupGaveUp;
    lines.push(
      `${cards(n)} never got an answer from the team check. Pick ${those(n)} yourself under Attention on ${their(n)} checklist.`,
    );
  }
  if (view.rowsWithOtherDefault > 0) {
    const n = view.rowsWithOtherDefault;
    lines.push(`${checklists(n)} under this one ${have(n)} a team of ${n === 1 ? "its" : "their"} own and ${are(n)} left out.`);
  }
  return lines;
}

/** The confirm's title and body. */
export function noTeamConfirmCopy(view: NoTeamTargetsView): { title: string; description: string } {
  const n = view.toStamp;
  const floor = view.countTruncated ? "at least " : "";
  const body =
    n === 1
      ? "Nothing on this card names a team, so it reads No Team from here on."
      : "Nothing on these cards names a team, so they read No Team from here on.";
  // The walk cap says more than the count cap (checklists left out entirely),
  // so it is the one said when both hit.
  const cap = view.walkTruncated
    ? ` ${NO_TEAM_WALK_TRUNCATED_TEXT}`
    : view.countTruncated
      ? ` ${NO_TEAM_COUNT_TRUNCATED_TEXT}`
      : "";
  return {
    title: `Mark ${floor}${cards(n)} No Team?`,
    description: `${body} No card gains or loses a team.${cap}`,
  };
}

function keptTotal(k: ReasonCounts): number {
  return k.hasTeam + k.pendingName + k.listingNamesTeam + k.awaitingLookup + k.lookupGaveUp;
}

/** What a finished line says after its name. */
export function noTeamLineResult(c: NoTeamLineCounts): string {
  if (c.scanned === 0) return "no cards yet";
  const parts = [c.stamped > 0 ? `marked ${cards(c.stamped)} No Team` : "nothing to mark"];
  if (c.kept.alreadyNoTeam > 0) parts.push(`${count(c.kept.alreadyNoTeam)} already No Team`);
  const left = keptTotal(c.kept);
  if (left > 0) parts.push(`left ${count(left)} as ${left === 1 ? "it is" : "they are"}`);
  return parts.join(", ");
}

/** One ledger line as a single text node: "{checklist} — {state}". */
export function noTeamLineText(line: NoTeamLine): string {
  switch (line.kind) {
    case "waiting":
      return `${line.name} — waiting`;
    case "building":
      return line.counts.scanned > 0
        ? `${line.name} — working, ${cards(line.counts.scanned)} checked`
        : `${line.name} — working…`;
    case "built":
    case "skipped":
      return `${line.name} — ${noTeamLineResult(line.counts)}`;
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

function stampedTotal(run: NoTeamRun): { stamped: number; scanned: number } {
  return run.lines.reduce(
    (sum, l) => ({ stamped: sum.stamped + l.counts.stamped, scanned: sum.scanned + l.counts.scanned }),
    { stamped: 0, scanned: 0 },
  );
}

/** The ledger's heading: where the run is, then how it ended. */
export function noTeamHeading(run: NoTeamRun): string {
  const { stamped, scanned } = stampedTotal(run);
  const n = run.lines.length;
  const done = run.lines.filter((l) => l.kind === "built" || l.kind === "skipped").length;
  if (run.phase === "running") {
    return `Marking teamless cards No Team: checklist ${count(Math.min(done + 1, n))} of ${count(n)}`;
  }
  if (run.phase === "done") {
    if (stamped > 0) return `Marked ${cards(stamped)} No Team`;
    if (scanned === 0) return "No cards here yet; new cards get No Team";
    return "Nothing to mark this time. The cards left are listed below.";
  }
  const soFar = `marked ${cards(stamped)} No Team`;
  const again = "Run it again to finish; cards already done are skipped.";
  if (run.phase === "stopped") return `Stopped, like you asked. So far: ${soFar}. ${again}`;
  const where = run.lines.find((l) => l.kind === "failed");
  if (scanned === 0 && where) return `Stopped before any card changed. ${again}`;
  return `Stopped at ${where?.name ?? "a checklist"}. So far: ${soFar}. ${again}`;
}

/** A refusal in the operator's words: the server's own sentence, else the fallback. */
export function noTeamErrorText(error: unknown): string {
  return userFacingMessage(error, "") || NO_TEAM_SIDEWAYS_TEXT;
}

// ---------------------------------------------------------------------------
// The run, as pure steps (tested directly)
// ---------------------------------------------------------------------------

export function startNoTeamRun(view: Pick<NoTeamTargetsView, "targets" | "walkTruncated">): NoTeamRun {
  return {
    lines: view.targets.map((t, i) => ({
      id: t._id as string,
      name: t.name,
      kind: i === 0 ? "building" : "waiting",
      counts: ZERO,
    })),
    phase: "running",
    walkTruncated: view.walkTruncated,
    announcement: "Marking teamless cards No Team.",
  };
}

const finished = (c: NoTeamLineCounts): RunLineKind => (c.scanned === 0 ? "skipped" : "built");

function addCounts(a: NoTeamLineCounts, page: NoTeamPageView): NoTeamLineCounts {
  const kept = { ...a.kept };
  for (const key of Object.keys(kept) as NoTeamKeepReason[]) {
    kept[key] += page.kept[key] ?? 0;
  }
  return { scanned: a.scanned + page.scanned, stamped: a.stamped + page.stamped, kept };
}

/**
 * Fold one page in. Lines before the page's target are finished (the server
 * moved past them); the page's own line takes its counts and finishes when
 * the page was the last one, or once a later page starts on the next target.
 */
export function applyNoTeamPage(run: NoTeamRun, page: NoTeamPageView): NoTeamRun {
  const last = page.cursor === null;
  const lines = run.lines.map((line, i): NoTeamLine => {
    if (i < page.targetIndex) {
      return line.kind === "building" || line.kind === "waiting"
        ? { ...line, kind: finished(line.counts) }
        : line;
    }
    if (i === page.targetIndex && page.targetId !== null) {
      const counts = addCounts(line.counts, page);
      return { ...line, counts, kind: last ? finished(counts) : "building" };
    }
    return last && (line.kind === "waiting" || line.kind === "building")
      ? { ...line, kind: finished(line.counts) }
      : line;
  });
  const next: NoTeamRun = { ...run, lines, phase: last ? "done" : "running" };
  const isDone = (l: NoTeamLine) => l.kind === "built" || l.kind === "skipped";
  const doneCount = lines.filter(isDone).length;
  const before = run.lines.filter(isDone).length;
  if (last) next.announcement = noTeamHeading(next);
  else if (doneCount !== before) next.announcement = pulseText(doneCount, lines.length);
  return next;
}

/** Stop was pressed and the page in flight has landed. */
export function stopNoTeamRun(run: NoTeamRun): NoTeamRun {
  const lines = run.lines.map((line): NoTeamLine => {
    if (line.kind === "building") {
      return { ...line, kind: line.counts.scanned > 0 ? "unfinished" : "stopped" };
    }
    if (line.kind === "waiting") return { ...line, kind: "stopped" };
    return line;
  });
  const next: NoTeamRun = { ...run, lines, phase: "stopped" };
  next.announcement = noTeamHeading(next);
  return next;
}

/** A page was refused: the line it was on fails, the rest are not reached. */
export function failNoTeamRun(run: NoTeamRun, message: string): NoTeamRun {
  let marked = false;
  const lines = run.lines.map((line): NoTeamLine => {
    if (!marked && (line.kind === "building" || line.kind === "waiting")) {
      marked = true;
      return { ...line, kind: "failed", error: message };
    }
    if (line.kind === "building" || line.kind === "waiting") return { ...line, kind: "stopped" };
    return line;
  });
  const next: NoTeamRun = { ...run, lines, phase: "failed" };
  next.announcement = noTeamHeading(next);
  return next;
}

// ---------------------------------------------------------------------------
// The control
// ---------------------------------------------------------------------------

/** Past this many lines the ledger scrolls inside itself (NEO-321's cap). */
const SCROLL_AFTER = 40;
/** A runaway guard: no run needs more pages than this. */
const MAX_PAGES = 5000;
/** How long a team change is believed to still be cascading (selectorOptions' 10 minutes). */
const CASCADE_IN_FLIGHT_MS = 10 * 60 * 1000;
/** Full size on a phone, the panel's compact size from `sm` up (NEO-528's choice). */
const BUTTON_SIZE = { initial: "2", sm: "1" } as const;

export default function NoTeamCardsControl({
  selectorOptionId,
  isNoTeam,
  teamCascadeStartedAt,
  expanded,
  onDismissed,
}: {
  /** The row the Attributes panel is on (a set, variant type, insert or parallel). */
  selectorOptionId: Id<"selectorOptions">;
  /** The row's stored Team is No Team. */
  isNoTeam: boolean;
  /** Set while the row's last team change is still cascading; the count waits for it. */
  teamCascadeStartedAt: number | undefined;
  /** The panel is open: the offer shows only then, a run's ledger always. */
  expanded: boolean;
  /**
   * Dismiss pressed: the ledger, and the focus in it, are about to go. The
   * panel puts focus somewhere of its own (the Team row's No Team toggle, or
   * the expand toggle when collapsed) rather than let it fall to <body>.
   */
  onDismissed: () => void;
}) {
  const convex = useConvex();
  const uid = useId();
  const hintId = `${uid}-hint`;
  const runHeadingId = `${uid}-run-heading`;

  const [view, setView] = useState<NoTeamTargetsView | null>(null);
  const [counting, setCounting] = useState(false);
  const [readTick, setReadTick] = useState(0);
  /**
   * The count was refused or failed: the server's sentence (most often
   * "Still applying the last team change…" in the moments after the save,
   * while its cascade runs). Shown with a retry the operator presses; never
   * retried on a timer.
   */
  const [readError, setReadError] = useState<string | null>(null);
  const [asking, setAsking] = useState<NoTeamTargetsView | null>(null);
  const [run, setRun] = useState<NoTeamRun | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopRef = useRef(false);
  const ledgerRef = useRef<HTMLElement | null>(null);
  const offerRef = useRef<HTMLDivElement | null>(null);
  /** Where focus goes once the confirm closes: the ledger, or back to the offer. */
  const parkRef = useRef<"ledger" | "offer" | null>(null);
  const running = run?.phase === "running";

  // The count, read once per (row, No Team, settled) and again after a run.
  // Never while the row's team change is still cascading: the server refuses
  // then (the rows beneath are moving), and the count would be a guess.
  useEffect(() => {
    if (!expanded || !isNoTeam) return;
    if (teamCascadeStartedAt !== undefined && Date.now() - teamCascadeStartedAt < CASCADE_IN_FLIGHT_MS) {
      return;
    }
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the one-shot read's own busy flag, raised as the read starts
    setCounting(true);
    setReadError(null);
    convex
      .query(api.cardNoTeamBulk.noTeamTargets, { selectorOptionId })
      .then(
        (answer) => {
          if (live) setView(answer as NoTeamTargetsView);
        },
        (e: unknown) => {
          // No offer rather than a wrong one, and the reason beside a retry.
          if (!live) return;
          setView(null);
          setReadError(userFacingMessage(e, NO_TEAM_COUNT_FAILED_TEXT));
        },
      )
      .finally(() => {
        if (live) setCounting(false);
      });
    return () => {
      live = false;
    };
  }, [convex, selectorOptionId, isNoTeam, teamCascadeStartedAt, expanded, readTick]);

  // a11y — the confirm took focus; once it is gone, land focus where the
  // operator's next step is (the ledger after Yes, the offer after Cancel).
  useEffect(() => {
    if (asking !== null || parkRef.current === null) return;
    const target = parkRef.current;
    parkRef.current = null;
    if (target === "ledger") ledgerRef.current?.focus({ preventScroll: true });
    else offerRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [asking, run]);

  // a11y — when a run stops running its Stop button unmounts; if focus went
  // with it, land it on the ledger so the outcome heading is read next. In a
  // frame, after the browser has moved focus off the removed node.
  const wasRunning = useRef(false);
  const phase = run?.phase ?? null;
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
      const inside = active !== ledger && active !== null && ledger.contains(active);
      if (stranded || inside) ledger.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const go = async (plan: NoTeamTargetsView) => {
    stopRef.current = false;
    setStopping(false);
    let state = startNoTeamRun(plan);
    setRun(state);
    try {
      let cursor: string | null = null;
      for (let pages = 0; pages < MAX_PAGES; pages++) {
        const page: NoTeamPageView = await convex.mutation(api.cardNoTeamBulk.applyNoTeamPage, {
          selectorOptionId,
          cursor,
        });
        state = applyNoTeamPage(state, page);
        cursor = page.cursor;
        if (cursor === null) break;
        if (stopRef.current) {
          state = stopNoTeamRun(state);
          break;
        }
        setRun(state);
      }
      if (state.phase === "running") state = stopNoTeamRun(state);
    } catch (e) {
      state = failNoTeamRun(state, noTeamErrorText(e));
    }
    setRun(state);
    setStopping(false);
    // What is left to mark changed; ask again for the offer.
    setReadTick((n) => n + 1);
  };

  const dismiss = () => {
    setRun(null);
    onDismissed();
  };

  const showOffer =
    expanded && isNoTeam && !running && asking === null && view !== null && view.toStamp > 0;

  const ledgerList = run && (
    <ul className="space-y-0.5">
      {run.lines.map((line) => (
        <li key={line.id} className="leading-5">
          <div className="flex items-start gap-1.5 py-0.5">
            <RunGlyph kind={line.kind} />
            <span className="min-w-0 break-words">{noTeamLineText(line)}</span>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      {/* The offer. Drawn under the Team row it follows from, in the panel's
          own quiet weight: one outlined green action (it applies, it does
          not take away) and its hint. Always mounted while the row is No
          Team, so the "Counting cards…" status is read when it appears. */}
      {expanded && isNoTeam && (
        <div ref={offerRef} className="flex flex-col gap-1">
          {showOffer && (
            <div className="flex flex-wrap items-center gap-2">
              <NeonButton
                type="button"
                size={BUTTON_SIZE}
                outline
                aria-describedby={hintId}
                onClick={() => setAsking(view)}
              >
                {offerLabel(view.toStamp, view.countTruncated)}
              </NeonButton>
              <p id={hintId} className="min-w-0 text-xs text-ink-3">
                {NO_TEAM_OFFER_HINT}
              </p>
            </div>
          )}
          {/* a11y — mounted for as long as the offer area is, so a change is
              read: "Counting cards…", then the answer in its place (never
              cleared to silence). Quiet while a run's ledger is up, whose
              own live line is speaking. */}
          <span
            role="status"
            // The offer button already shows the count; the answer is then
            // for the screen reader only, not said twice on screen.
            className={showOffer ? "sr-only" : "text-xs text-ink-2 empty:hidden"}
          >
            {run ? "" : counting ? NO_TEAM_COUNTING_TEXT : view ? noTeamCountResultText(view) : ""}
          </span>
          {readError && !counting && !run && (
            <div className="flex flex-wrap items-center gap-2">
              <p role="alert" className="min-w-0 text-xs text-notice-danger-ink">
                {readError}
              </p>
              <NeonButton
                type="button"
                size={BUTTON_SIZE}
                variant="secondary"
                outline
                onClick={() => setReadTick((n) => n + 1)}
              >
                {NO_TEAM_RECOUNT_LABEL}
              </NeonButton>
            </div>
          )}
        </div>
      )}

      {asking && (
        <ConfirmDialog
          title={noTeamConfirmCopy(asking).title}
          description={noTeamConfirmCopy(asking).description}
          confirmLabel={NO_TEAM_CONFIRM_LABEL}
          // Applying, not taking away: the green yes beside a pink Cancel.
          confirmVariant="primary"
          busyLabel="Starting…"
          busy={false}
          childrenLabel="Cards left as they are"
          onConfirm={() => {
            const plan = asking;
            parkRef.current = "ledger";
            setAsking(null);
            void go(plan);
          }}
          onCancel={() => {
            parkRef.current = "offer";
            setAsking(null);
          }}
        >
          {keptReasonLines(asking).length > 0 ? (
            <ul className="list-disc space-y-0.5 py-2 pr-2 pl-6 text-xs text-ink-2">
              {keptReasonLines(asking).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </ConfirmDialog>
      )}

      {run && (
        // a11y — a labelled region, not a live one (the heading ticks on every
        // page); the live line below speaks the start, the pulses and the end.
        // `tabIndex={-1}` is where focus parks as a run starts and ends.
        <section
          ref={ledgerRef}
          tabIndex={-1}
          aria-labelledby={runHeadingId}
          className="p-3 bg-notice-info-bg border border-notice-info-rule shadow-offset rounded-md text-notice-info-ink text-sm focus-outline"
        >
          <div className="flex items-start justify-between gap-3">
            <h5 id={runHeadingId} className="min-w-0 wrap-anywhere font-semibold tabular-nums">
              {noTeamHeading(run)}
            </h5>
            {running ? (
              <button
                type="button"
                onClick={() => {
                  if (stopping) return;
                  stopRef.current = true;
                  setStopping(true);
                  // a11y — the button's own relabel is not announced; the
                  // ledger's live line says it. The run's next state (the
                  // stopped heading) replaces it when the page in flight lands.
                  setRun((r) => (r ? { ...r, announcement: NO_TEAM_STOPPING_LABEL } : r));
                }}
                aria-disabled={stopping || undefined}
                className="shrink-0 rounded-sm font-semibold underline decoration-dotted hover:decoration-solid py-1.5 -my-1.5 aria-disabled:no-underline aria-disabled:cursor-not-allowed aria-disabled:opacity-75"
              >
                {stopping ? NO_TEAM_STOPPING_LABEL : NO_TEAM_STOP_LABEL}
              </button>
            ) : (
              <button
                type="button"
                onClick={dismiss}
                aria-label={NO_TEAM_DISMISS_LABEL}
                className="shrink-0 rounded-sm font-semibold underline decoration-dotted hover:decoration-solid py-1.5 -my-1.5"
              >
                Dismiss
              </button>
            )}
          </div>
          <SleeveStrip
            items={run.lines.map((line) => ({ key: line.id, kind: line.kind, title: noTeamLineText(line) }))}
          />
          <div className="mt-2 text-xs">
            {run.lines.length > SCROLL_AFTER ? (
              <div
                role="group"
                aria-label="Checklists in the No Team run"
                tabIndex={0}
                className="max-h-[70vh] overflow-y-auto pr-1 rounded-sm focus-outline"
              >
                {ledgerList}
              </div>
            ) : (
              ledgerList
            )}
          </div>
          {run.walkTruncated && <p className="mt-2 text-xs">{NO_TEAM_WALK_TRUNCATED_TEXT}</p>}
        </section>
      )}
      {/* a11y — mounted with the offer, before any run (never with the
          ledger), so the start announcement is read (see `LiveLine`). A run
          can only start from the offer, so a row that is not No Team carries
          no extra live region. */}
      {((expanded && isNoTeam) || run !== null) && <LiveLine text={run?.announcement ?? ""} />}
    </>
  );
}
