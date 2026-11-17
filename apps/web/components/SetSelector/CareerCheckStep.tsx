import { useId, useRef, useState, type KeyboardEvent, type Ref } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import NeonButton from "../modules/NeonButton";
import { Input } from "../primitives/Input";
import { MIN_CAREER_YEAR, maxCareerYear } from "../../lib/players/career-years";
import EntityLinkSearch from "./EntityLinkSearch";
import { cardNumbersSummary } from "./teams-on-cards";
import { useRelinkCandidates } from "./career-reads";
import {
  CAREER_CHECKING,
  CAREER_NEXT_BLOCKED,
  CAREER_READ_FAILED,
  CAREER_RETRY_LABEL,
  careerFollowUpFailed,
  CAREER_STEP_HEADING,
  LEAVE_FOLLOW_UP,
  careerStepLead,
  coverageAskOf,
  followUpPair,
  freshStint,
  noStintText,
  parseStintDraft,
  type CareerAnswer,
  type CareerAnswers,
  type CareerFollowUp,
  type CareerLine,
  type CoverageAsk,
  type StintDraft,
} from "./career-check";

/**
 * NEO-574 — the wizard's "Career check" step.
 *
 * Each line is one player and one team the player's career does not show for
 * the set's year, with the cards behind it:
 *
 *   Fernando Tatis Jr.
 *   No San Diego Padres stint by 2022.            Cards #12, #45
 *   (●) Leave it   ( ) Add the stint   ( ) Different player   ( ) Different team
 *
 * Every line opens on "Leave it", so one Next passes the screen; nothing is
 * written until Confirm & Save. The other three answers open one small panel
 * under the line:
 *
 *  - **Add the stint**: From year (the set's year) and an optional To year.
 *  - **Different player**: the same-name players on file, those whose career
 *    covers the team first, and "Someone else…" for a search of existing
 *    players. Existing players only.
 *  - **Different team**: a search of existing teams.
 *
 * A different player or team asks the coverage read about the NEW pair; if
 * that is uncovered too, one more choice appears right there: add the stint
 * for it, or leave it. (Picking again is just picking again.) One level deep.
 *
 * ## Keyboard (the house radio-group pattern)
 *
 * Each line is ONE radio group and ONE Tab stop, on its picked radio. Arrows
 * move and pick, wrapping. Space or a click picks. Enter picks AND moves on:
 * to the panel it opens, or from "Leave it" to the next line, and from the
 * last line to Next. A held (repeating) Enter is refused.
 *
 * The heading and the status line are fixed names the wizard's Next is
 * described by.
 */

const KINDS = ["leave", "add", "player", "team"] as const;
type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Readonly<Record<Kind, string>> = {
  leave: "Leave it",
  add: "Add the stint",
  player: "Different player",
  team: "Different team",
};

/** "Fernando Tatis Jr. on the San Diego Padres" — each line's radio group name. */
export function careerLineLabel(player: string, team: string): string {
  return `${player} on ${team}`;
}

export type CareerCheckStepProps = {
  lines: readonly CareerLine[];
  /** The set's year. */
  setYear: number;
  selectorOptionId: Id<"selectorOptions">;
  /** The sport-level row the player search is scoped to. */
  sportId: Id<"selectorOptions">;
  answers: CareerAnswers;
  onAnswer: (key: string, answer: CareerAnswer) => void;
  /** `coverageForPreview` answers by pair key (true = covered). */
  coverage: Readonly<Record<string, boolean>>;
  /** Pair keys whose read failed: not an answer, never "covered". */
  failed: Readonly<Record<string, boolean>>;
  requestCoverage: (asks: readonly CoverageAsk[]) => void;
  /** Canonical names, when the wizard has them; the printed text otherwise. */
  playerNameOf: (line: CareerLine) => string;
  teamNameOf: (line: CareerLine) => string;
  /** The coverage read is still on its way for some pairs: nothing to list yet. */
  checking?: boolean;
  /** The career check could not run for something on screen: say so, offer Retry. */
  readFailed?: boolean;
  onRetry?: () => void;
  /** Enter on the last line: the host moves focus on (to Next). */
  onAllDone?: () => void;
  disabled?: boolean;
  headingId: string;
  /** The first line's first radio, which the host focuses on arrival. */
  firstRef?: Ref<HTMLButtonElement>;
  hintId: string;
  /** Next was pressed while an add form holds years that are not a stint. */
  showBlockedHint?: boolean | number;
};

function kindOf(answer: CareerAnswer | undefined): Kind {
  return answer?.kind ?? "leave";
}

export default function CareerCheckStep({
  lines,
  setYear,
  selectorOptionId,
  sportId,
  answers,
  onAnswer,
  coverage,
  failed,
  requestCoverage,
  playerNameOf,
  teamNameOf,
  checking = false,
  readFailed = false,
  onRetry,
  onAllDone,
  disabled = false,
  headingId,
  firstRef,
  hintId,
  showBlockedHint = false,
}: CareerCheckStepProps) {
  const leadId = useId();
  const rowRef = (key: string) =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-career-line]")).find(
      (el) => el.dataset.careerLine === key,
    ) ?? null;

  /** Enter walks on: the next line's tab-stop radio, or out to Next. */
  const walkFrom = (key: string) => {
    const at = lines.findIndex((l) => l.key === key);
    const next = lines[at + 1];
    if (!next) {
      onAllDone?.();
      return;
    }
    rowRef(next.key)?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
  };

  if (lines.length === 0) {
    // Nothing to list yet: waiting on the reads, or the reads failed.
    return (
      <div className="space-y-3">
        <h3 id={headingId} className="text-sm font-semibold text-ink">
          {CAREER_STEP_HEADING}
        </h3>
        <p id={hintId} role="status" className="text-sm text-ink-2">
          {readFailed ? CAREER_READ_FAILED : checking ? CAREER_CHECKING : ""}
        </p>
        {readFailed && <RetryButton onRetry={onRetry} disabled={disabled} />}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 id={headingId} className="text-sm font-semibold text-ink">
          {CAREER_STEP_HEADING}
        </h3>
        <p id={leadId} className="mt-0.5 text-sm text-ink-2">
          {careerStepLead(lines.length)}
        </p>
      </div>
      <ul className="space-y-3" aria-describedby={leadId}>
        {lines.map((line, i) => (
          <li key={line.key} data-career-line={line.key}>
            <CareerLineRow
              line={line}
              setYear={setYear}
              selectorOptionId={selectorOptionId}
              sportId={sportId}
              answer={answers[line.key]}
              onAnswer={(answer) => onAnswer(line.key, answer)}
              coverage={coverage}
              failed={failed}
              requestCoverage={requestCoverage}
              playerName={playerNameOf(line)}
              teamName={teamNameOf(line)}
              disabled={disabled}
              firstRef={i === 0 ? firstRef : undefined}
              onWalk={() => walkFrom(line.key)}
            />
          </li>
        ))}
      </ul>
      {/* Always mounted: a live region must exist before it speaks. A failed
          read and held years are both news worth saying here. */}
      <p id={hintId} role="status" className="text-xs text-ink-2">
        {showBlockedHint ? CAREER_NEXT_BLOCKED : readFailed ? CAREER_READ_FAILED : ""}
      </p>
      {readFailed && <RetryButton onRetry={onRetry} disabled={disabled} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One line
// ---------------------------------------------------------------------------

function CareerLineRow({
  line,
  setYear,
  selectorOptionId,
  sportId,
  answer,
  onAnswer,
  coverage,
  failed,
  requestCoverage,
  playerName,
  teamName,
  disabled,
  firstRef,
  onWalk,
}: {
  line: CareerLine;
  setYear: number;
  selectorOptionId: Id<"selectorOptions">;
  sportId: Id<"selectorOptions">;
  answer: CareerAnswer | undefined;
  onAnswer: (answer: CareerAnswer) => void;
  coverage: Readonly<Record<string, boolean>>;
  failed: Readonly<Record<string, boolean>>;
  requestCoverage: (asks: readonly CoverageAsk[]) => void;
  playerName: string;
  teamName: string;
  disabled: boolean;
  firstRef?: Ref<HTMLButtonElement>;
  onWalk: () => void;
}) {
  const groupLabel = careerLineLabel(playerName, teamName);
  const current = kindOf(answer);
  const panelRef = useRef<HTMLDivElement>(null);
  /** The player/team search opens on an Enter-walk, and on its own button. */
  const [searchOpen, setSearchOpen] = useState(false);

  const choose = (kind: Kind, walk: boolean) => {
    if (disabled) return;
    if (kind !== current) {
      if (kind === "leave") onAnswer({ kind: "leave" });
      else if (kind === "add") onAnswer({ kind: "add", ...freshStint(setYear) });
      else onAnswer({ kind, then: LEAVE_FOLLOW_UP });
      setSearchOpen(false);
    }
    if (!walk) return;
    if (kind === "leave") {
      onWalk();
      return;
    }
    if (kind === "team") setSearchOpen(true);
    // Let the panel render, then step into it.
    setTimeout(() => {
      panelRef.current
        ?.querySelector<HTMLElement>("input, button")
        ?.focus();
    }, 0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, kind: Kind) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step !== 0) {
      event.preventDefault();
      if (disabled) return;
      const to = KINDS[(KINDS.indexOf(kind) + step + KINDS.length) % KINDS.length];
      choose(to, false);
      event.currentTarget.parentElement
        ?.querySelector<HTMLElement>(`[data-career-kind="${to}"]`)
        ?.focus();
      return;
    }
    if (event.key !== "Enter") return;
    // Never the button's default click (it would pick twice), never the
    // wizard's own Enter.
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    choose(kind, true);
  };

  return (
    <div className="rounded-lg border border-rule-strong bg-raised">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-rule px-3 py-2">
        <div>
          <h4 className="text-sm font-semibold text-ink">{playerName}</h4>
          <p className="text-sm text-ink-2">{noStintText(teamName, setYear)}</p>
        </div>
        <p className="text-xs text-ink-3">
          Cards {cardNumbersSummary(line.cardNumbers.map((cardNumber) => ({ cardNumber })))}
        </p>
      </div>
      <div className="space-y-3 p-3">
        <div role="radiogroup" aria-label={groupLabel} className="flex flex-wrap gap-2">
          {KINDS.map((kind) => {
            const picked = kind === current;
            return (
              <button
                key={kind}
                ref={kind === current ? firstRef : undefined}
                type="button"
                role="radio"
                aria-checked={picked}
                aria-disabled={disabled || undefined}
                tabIndex={picked ? 0 : -1}
                data-career-kind={kind}
                onClick={() => choose(kind, false)}
                onKeyDown={(event) => onKeyDown(event, kind)}
                className={`rounded-md border-2 px-3 py-1.5 text-sm font-semibold transition-colors focus-outline max-sm:min-h-11 ${
                  picked
                    ? "border-neon-green-text text-neon-green-text"
                    : "border-control text-ink-2 hover:border-ink-2"
                } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
              >
                {picked && (
                  <span aria-hidden="true" className="mr-1.5">
                    ✓
                  </span>
                )}
                {KIND_LABEL[kind]}
              </button>
            );
          })}
        </div>

        {answer && answer.kind !== "leave" && (
          <div ref={panelRef}>
            {answer.kind === "add" && (
              <StintFields
                label={`${playerName}, ${teamName}`}
                draft={answer}
                onChange={(draft) => onAnswer({ kind: "add", ...draft })}
                onEnter={onWalk}
                disabled={disabled}
              />
            )}
            {answer.kind === "player" && (
              <PlayerPanel
                line={line}
                setYear={setYear}
                selectorOptionId={selectorOptionId}
                sportId={sportId}
                answer={answer}
                onAnswer={onAnswer}
                coverage={coverage}
              failed={failed}
                requestCoverage={requestCoverage}
                playerName={playerName}
                teamName={teamName}
                disabled={disabled}
                searchOpen={searchOpen}
                setSearchOpen={setSearchOpen}
                onWalk={onWalk}
              />
            )}
            {answer.kind === "team" && (
              <TeamPanel
                line={line}
                setYear={setYear}
                selectorOptionId={selectorOptionId}
                sportId={sportId}
                answer={answer}
                onAnswer={onAnswer}
                coverage={coverage}
              failed={failed}
                requestCoverage={requestCoverage}
                playerName={playerName}
                disabled={disabled}
                searchOpen={searchOpen}
                setSearchOpen={setSearchOpen}
                onWalk={onWalk}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The add form
// ---------------------------------------------------------------------------

function StintFields({
  label,
  draft,
  onChange,
  onEnter,
  disabled,
}: {
  /** "Player, Team": makes each field's name distinct among the lines. */
  label: string;
  draft: StintDraft;
  onChange: (draft: StintDraft) => void;
  onEnter?: () => void;
  disabled: boolean;
}) {
  const valid = parseStintDraft(draft) !== null;
  const max = maxCareerYear();
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    // Enter in a year is "done with this line": on to the next, never the
    // wizard's own Enter. An invalid stint stays put (Next says why).
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || !valid) return;
    onEnter?.();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        bare
        type="number"
        value={draft.fromYear}
        placeholder="From year"
        aria-label={`From year for ${label}`}
        aria-invalid={!valid && draft.fromYear.trim() !== "" ? true : undefined}
        min={MIN_CAREER_YEAR}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange({ ...draft, fromYear: e.target.value })}
        onKeyDown={onKeyDown}
        className="w-24 p-1.5 text-sm"
      />
      <Input
        bare
        type="number"
        value={draft.toYear}
        placeholder="To year (opt)"
        aria-label={`To year (optional) for ${label}`}
        aria-invalid={!valid && draft.toYear.trim() !== "" ? true : undefined}
        min={MIN_CAREER_YEAR}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange({ ...draft, toYear: e.target.value })}
        onKeyDown={onKeyDown}
        className="w-28 p-1.5 text-sm"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// After a pick: is the NEW pair covered?
// ---------------------------------------------------------------------------

function FollowUp({
  line,
  setYear,
  answer,
  onAnswer,
  coverage,
  failed,
  subject,
  team,
  disabled,
  onWalk,
}: {
  line: CareerLine;
  setYear: number;
  answer: Extract<CareerAnswer, { kind: "player" | "team" }>;
  onAnswer: (answer: CareerAnswer) => void;
  coverage: Readonly<Record<string, boolean>>;
  failed: Readonly<Record<string, boolean>>;
  /** Whose career, and which team, the re-check is about. */
  subject: string;
  team: string;
  disabled: boolean;
  onWalk: () => void;
}) {
  const pair = followUpPair(line, answer);
  const groupId = useId();
  if (!pair) return null;
  const covered = coverage[pair.key];
  if (covered === undefined && failed[pair.key]) {
    return (
      <p role="status" className="text-sm text-ink-2">
        {careerFollowUpFailed(subject)}
      </p>
    );
  }
  if (covered === undefined) {
    return (
      <p role="status" className="text-sm text-ink-2">
        Checking {subject}’s career…
      </p>
    );
  }
  if (covered) {
    return (
      <p role="status" className="text-sm text-ink-2">
        {subject} has {team} on file.
      </p>
    );
  }
  const then: CareerFollowUp = answer.then;
  const setThen = (next: CareerFollowUp) => onAnswer({ ...answer, then: next });
  return (
    <div className="space-y-2">
      <p role="status" className="text-sm text-ink-2">
        {subject} has no {team} stint by {setYear} either.
      </p>
      <div
        role="radiogroup"
        aria-label={`Career for ${subject}`}
        id={groupId}
        className="flex flex-wrap gap-2"
      >
        {(["leave", "add"] as const).map((kind) => {
          const picked = then.kind === kind;
          return (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={picked}
              aria-disabled={disabled || undefined}
              tabIndex={picked ? 0 : -1}
              data-career-follow={kind}
              onClick={() => {
                if (disabled || picked) return;
                setThen(kind === "leave" ? LEAVE_FOLLOW_UP : { kind: "add", ...freshStint(setYear) });
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  if (disabled) return;
                  const to = kind === "leave" ? "add" : "leave";
                  setThen(to === "leave" ? LEAVE_FOLLOW_UP : { kind: "add", ...freshStint(setYear) });
                  event.currentTarget.parentElement
                    ?.querySelector<HTMLElement>(`[data-career-follow="${to}"]`)
                    ?.focus();
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.repeat) return;
                  if (kind === "leave") onWalk();
                  else if (!picked) setThen({ kind: "add", ...freshStint(setYear) });
                }
              }}
              className={`rounded-md border-2 px-3 py-1.5 text-sm font-semibold transition-colors focus-outline max-sm:min-h-11 ${
                picked
                  ? "border-neon-green-text text-neon-green-text"
                  : "border-control text-ink-2 hover:border-ink-2"
              }`}
            >
              {picked && (
                <span aria-hidden="true" className="mr-1.5">
                  ✓
                </span>
              )}
              {KIND_LABEL[kind]}
            </button>
          );
        })}
      </div>
      {then.kind === "add" && (
        <StintFields
          label={`${subject}, ${team}`}
          draft={then}
          onChange={(draft) => setThen({ kind: "add", ...draft })}
          onEnter={onWalk}
          disabled={disabled}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Different player
// ---------------------------------------------------------------------------

function PlayerPanel({
  line,
  setYear,
  selectorOptionId,
  sportId,
  answer,
  onAnswer,
  coverage,
  failed,
  requestCoverage,
  playerName,
  teamName,
  disabled,
  searchOpen,
  setSearchOpen,
  onWalk,
}: {
  line: CareerLine;
  setYear: number;
  selectorOptionId: Id<"selectorOptions">;
  sportId: Id<"selectorOptions">;
  answer: Extract<CareerAnswer, { kind: "player" }>;
  onAnswer: (answer: CareerAnswer) => void;
  coverage: Readonly<Record<string, boolean>>;
  failed: Readonly<Record<string, boolean>>;
  requestCoverage: (asks: readonly CoverageAsk[]) => void;
  playerName: string;
  teamName: string;
  disabled: boolean;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  onWalk: () => void;
}) {
  const read = useRelinkCandidates(selectorOptionId, {
    printedName: line.printedPlayer,
    ...(line.teamId ? { teamId: line.teamId as Id<"teams"> } : {}),
    ...(line.teamName ? { teamName: line.teamName } : {}),
    excludePlayerId: line.playerId as Id<"players">,
  });
  const pick = (playerId: Id<"players">, name: string) => {
    const next: CareerAnswer = { kind: "player", pick: { playerId, name }, then: LEAVE_FOLLOW_UP };
    onAnswer(next);
    const pair = followUpPair(line, next);
    if (pair) requestCoverage([coverageAskOf(pair.ask)]);
    if (searchOpen) {
      setSearchOpen(false);
      // The search is about to unmount with focus in it.
      setTimeout(() => elseRef.current?.focus(), 0);
    }
  };
  const elseRef = useRef<HTMLButtonElement>(null);
  const picked = answer.pick;
  // A pick made with "Someone else…" is not among the candidates: it joins
  // the list so the choice stays visible.
  const extra =
    picked && !read.candidates.some((c) => c.playerId === picked.playerId) ? picked : null;

  return (
    <div className="space-y-2">
      {read.state === "loading" && (
        <p role="status" className="text-sm text-ink-2">
          Looking for players…
        </p>
      )}
      {(read.candidates.length > 0 || extra) && (
        <div role="group" aria-label="Which player is this?" className="space-y-1">
          {extra && (
            <PlayerChoice
              name={extra.name}
              detail=""
              picked
              disabled={disabled}
              onPick={() => undefined}
            />
          )}
          {read.candidates.map((c) => (
            <PlayerChoice
              key={c.playerId}
              name={c.name}
              detail={c.careerSummary}
              covers={c.covers}
              team={teamName}
              picked={picked?.playerId === c.playerId}
              disabled={disabled}
              onPick={() => pick(c.playerId, c.name)}
            />
          ))}
        </div>
      )}
      {searchOpen ? (
        <EntityLinkSearch
          kind="player"
          sportId={sportId}
          contextOptionId={selectorOptionId}
          onSelect={(id, name) => pick(id as Id<"players">, name)}
          onCancel={() => setSearchOpen(false)}
        />
      ) : (
        <NeonButton
          ref={elseRef}
          size="1"
          variant="secondary"
          outline
          onClick={() => setSearchOpen(true)}
          aria-disabled={disabled || undefined}
          aria-label={`Someone else for ${playerName}`}
          className="max-sm:min-h-11"
        >
          Someone else…
        </NeonButton>
      )}
      {picked && (
        <FollowUp
          line={line}
          setYear={setYear}
          answer={answer}
          onAnswer={onAnswer}
          coverage={coverage}
              failed={failed}
          subject={picked.name}
          team={teamName}
          disabled={disabled}
          onWalk={onWalk}
        />
      )}
    </div>
  );
}

function PlayerChoice({
  name,
  detail,
  covers,
  team,
  picked,
  disabled,
  onPick,
}: {
  name: string;
  detail: string;
  covers?: boolean;
  team?: string;
  picked: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={picked}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onPick();
      }}
      className={`flex w-full flex-col rounded-md border px-3 py-1.5 text-left text-sm focus-outline max-sm:min-h-11 ${
        picked
          ? "border-neon-green-text bg-list-hover-raised"
          : "border-control hover:border-ink-2"
      }`}
    >
      <span className="font-semibold text-ink">
        {picked && (
          <span aria-hidden="true" className="mr-1.5 text-neon-green-text">
            ✓
          </span>
        )}
        {name}
      </span>
      {detail && <span className="text-xs text-ink-3">{detail}</span>}
      {covers && team && <span className="text-xs text-ink-2">Has {team} on file</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Different team
// ---------------------------------------------------------------------------

function TeamPanel({
  line,
  setYear,
  selectorOptionId,
  sportId,
  answer,
  onAnswer,
  coverage,
  failed,
  requestCoverage,
  playerName,
  disabled,
  searchOpen,
  setSearchOpen,
  onWalk,
}: {
  line: CareerLine;
  setYear: number;
  selectorOptionId: Id<"selectorOptions">;
  sportId: Id<"selectorOptions">;
  answer: Extract<CareerAnswer, { kind: "team" }>;
  onAnswer: (answer: CareerAnswer) => void;
  coverage: Readonly<Record<string, boolean>>;
  failed: Readonly<Record<string, boolean>>;
  requestCoverage: (asks: readonly CoverageAsk[]) => void;
  playerName: string;
  disabled: boolean;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  onWalk: () => void;
}) {
  const picked = answer.pick;
  const pick = (teamId: Id<"teams">, name: string) => {
    const next: CareerAnswer = { kind: "team", pick: { teamId, name }, then: LEAVE_FOLLOW_UP };
    onAnswer(next);
    const pair = followUpPair(line, next);
    if (pair) requestCoverage([coverageAskOf(pair.ask)]);
    setSearchOpen(false);
    // The search is about to unmount with focus in it.
    setTimeout(() => buttonRef.current?.focus(), 0);
  };
  const open = searchOpen;
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="space-y-2">
      {open ? (
        <EntityLinkSearch
          kind="team"
          sportId={sportId}
          contextOptionId={selectorOptionId}
          onSelect={(id, name) => pick(id as Id<"teams">, name)}
          onCancel={() => setSearchOpen(false)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {picked && <p className="text-sm text-ink">{picked.name}</p>}
          <NeonButton
            ref={buttonRef}
            size="1"
            variant="secondary"
            outline
            onClick={() => setSearchOpen(true)}
            aria-disabled={disabled || undefined}
            aria-label={
              picked
                ? `Pick another team for ${playerName}`
                : `Pick a team for ${playerName}`
            }
            className="max-sm:min-h-11"
          >
            {picked ? "Pick another" : "Pick a team…"}
          </NeonButton>
        </div>
      )}
      {picked && !open && (
        <FollowUp
          line={line}
          setYear={setYear}
          answer={answer}
          onAnswer={onAnswer}
          coverage={coverage}
              failed={failed}
          subject={playerName}
          team={picked.name}
          disabled={disabled}
          onWalk={onWalk}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Retry, when the coverage read failed
// ---------------------------------------------------------------------------

function RetryButton({ onRetry, disabled }: { onRetry?: () => void; disabled: boolean }) {
  return (
    <div>
      <NeonButton
        variant="secondary"
        type="button"
        aria-label={CAREER_RETRY_LABEL}
        disabled={disabled}
        onClick={() => onRetry?.()}
      >
        Retry
      </NeonButton>
    </div>
  );
}
