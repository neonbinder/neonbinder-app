import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import NeonButton from "../modules/NeonButton";
import { Input } from "../primitives/Input";
import { MIN_CAREER_YEAR, maxCareerYear } from "../../lib/players/career-years";
import { NOTHING_ON_FILE, formatPlayerDescription } from "../../lib/players/player-description";
import EntityLinkSearch from "./EntityLinkSearch";
import { cardNumbersSummary } from "./teams-on-cards";
import { useRelinkCandidates } from "./career-reads";
import {
  CAREER_RETRY_LABEL,
  LEAVE_FOLLOW_UP,
  NO_CAREER_TEXT,
  careerFollowUpFailed,
  careerHeading,
  coverageAskOf,
  coveredText,
  followUpPair,
  freshStint,
  sortCareerLines,
  noStintText,
  parseStintDraft,
  playedForText,
  uncoveredAgainText,
  yearsHintText,
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
  leave: "Keep as is",
  add: "Add to career",
  player: "Wrong player",
  team: "Fix card’s team",
};

/** "Fernando Tatis Jr. on the San Diego Padres" — each line's radio group name. */
export function careerLineLabel(player: string, team: string, cardNumber?: string): string {
  // With no team name to tell two lines of one player apart, the first card does.
  return cardNumber ? `${player} on ${team}, card ${cardNumber}` : `${player} on ${team}`;
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
  /** The full team name ("San Diego Padres"): names each line's radio group. */
  teamNameOf: (line: CareerLine) => string;
  /** The short name as the team's rows show it ("Padres"): the line's own text. */
  shortTeamNameOf?: (line: CareerLine) => string | undefined;
  /**
   * The short name ("Padres") of a team the operator picked from the search,
   * once it is known; the follow-up names the pick by it, as lines name teams.
   * Until then (or without it) the search result's own name is used.
   */
  shortTeamNameOfId?: (teamId: string) => string | undefined;
  /** The player has no stints at all: "No career on file yet." instead of the team. */
  hasNoCareer?: (line: CareerLine) => boolean;
  /**
   * The coverage read is still on its way for some pairs: nothing to list yet.
   * The words ("Checking careers…", the failure, the years hint) are said by
   * the wizard's own status line, so they are announced from one live region
   * that was there before they were.
   */
  checking?: boolean;
  /** The career check could not run for something on screen: offer Retry. */
  readFailed?: boolean;
  onRetry?: () => void;
  /** Enter on the last line: the host moves focus on (to Next). */
  onAllDone?: () => void;
  disabled?: boolean;
  headingId: string;
  /** The first line's first radio, which the host focuses on arrival. */
  firstRef?: Ref<HTMLButtonElement>;
};

function kindOf(answer: CareerAnswer | undefined): Kind {
  return answer?.kind ?? "leave";
}

export default function CareerCheckStep({
  lines: given,
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
  shortTeamNameOf,
  shortTeamNameOfId,
  hasNoCareer,
  readFailed = false,
  onRetry,
  onAllDone,
  disabled = false,
  headingId,
  firstRef,
}: CareerCheckStepProps) {
  /** The team as the line shows it: the short name, once it is known. */
  const shortOf = (line: CareerLine): string | undefined =>
    shortTeamNameOf ? shortTeamNameOf(line) : teamNameOf(line);
  // By the team as it reads on the line, then card number; a line whose team
  // has no name yet sorts by the text its cards print.
  const sorted = sortCareerLines(given, shortOf);
  // Once lines are on screen their order is kept: a name that resolves later
  // can change the sort, never the places the operator is working in. A line
  // that arrives afterwards joins at the end, in sort order.
  const [shownOrder, setShownOrder] = useState<string[]>([]);
  const byKey = new Map(sorted.map((l) => [l.key, l]));
  const keptKeys = shownOrder.filter((k) => byKey.has(k));
  const orderKeys = [...keptKeys, ...sorted.map((l) => l.key).filter((k) => !keptKeys.includes(k))];
  const lines = orderKeys.map((k) => byKey.get(k)!);
  if (orderKeys.join("\u0000") !== shownOrder.join("\u0000")) setShownOrder(orderKeys);
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
    // Nothing to list yet: waiting on the reads, or the reads failed. The
    // words are the wizard's status line's.
    return (
      <div className="space-y-3">
        <h3 id={headingId} className="text-sm font-semibold text-ink">
          {careerHeading(0)}
        </h3>
        {readFailed && <RetryButton onRetry={onRetry} disabled={disabled} />}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 id={headingId} className="text-sm font-semibold text-ink">
        {careerHeading(lines.length)}
      </h3>
      <ul className="space-y-3" aria-labelledby={headingId}>
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
              shortTeamName={shortOf(line)}
              pickedTeamShortName={(() => {
                const a = answers[line.key];
                return a?.kind === "team" && a.pick ? shortTeamNameOfId?.(a.pick.teamId) : undefined;
              })()}
              noCareer={hasNoCareer ? hasNoCareer(line) : false}
              disabled={disabled}
              firstRef={i === 0 ? firstRef : undefined}
              onWalk={() => walkFrom(line.key)}
            />
          </li>
        ))}
      </ul>
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
  shortTeamName,
  pickedTeamShortName,
  noCareer,
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
  shortTeamName: string | undefined;
  pickedTeamShortName?: string;
  noCareer: boolean;
  disabled: boolean;
  firstRef?: Ref<HTMLButtonElement>;
  onWalk: () => void;
}) {
  const groupLabel = careerLineLabel(
    playerName,
    teamName,
    shortTeamName === undefined ? line.cardNumbers[0] : undefined,
  );
  const current = kindOf(answer);
  const panelRef = useRef<HTMLDivElement>(null);
  const noteId = useId();
  const cardsId = useId();
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
          <p id={noteId} className="text-sm text-ink-2">
            {noCareer ? NO_CAREER_TEXT : noStintText(shortTeamName, setYear)}
          </p>
        </div>
        <p id={cardsId} className="text-xs text-ink-3">
          Cards {cardNumbersSummary(line.cardNumbers.map((cardNumber) => ({ cardNumber })))}
        </p>
      </div>
      <div className="space-y-3 p-3">
        <div
          role="radiogroup"
          aria-label={groupLabel}
          aria-describedby={`${noteId} ${cardsId}`}
          className="flex flex-wrap gap-2"
        >
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
                teamName={shortTeamName ?? ""}
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
                pickedShortName={pickedTeamShortName}
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
  const errorId = useId();
  /** Enter was pressed on years that are not a stint: say why, even if a box is blank. */
  const [pressed, setPressed] = useState(false);
  const fromFilled = draft.fromYear.trim() !== "";
  const toFilled = draft.toYear.trim() !== "";
  const showError = !valid && (pressed || fromFilled || toFilled);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    // Enter in a year is "done with this line": on to the next, never the
    // wizard's own Enter. Years that are not a stint stay put, and say why.
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (!valid) {
      setPressed(true);
      return;
    }
    onEnter?.();
  };
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
      <label className="flex flex-col gap-0.5 text-xs text-ink-2">
        <span>From year</span>
        <Input
          bare
          type="number"
          value={draft.fromYear}
          placeholder="From year"
          aria-label={`From year for ${label}`}
          aria-invalid={showError && (pressed || fromFilled) ? true : undefined}
          aria-describedby={showError ? errorId : undefined}
          min={MIN_CAREER_YEAR}
          max={max}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, fromYear: e.target.value })}
          onKeyDown={onKeyDown}
          className="w-24 p-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col gap-0.5 text-xs text-ink-2">
        <span>To year (optional)</span>
        <Input
          bare
          type="number"
          value={draft.toYear}
          placeholder="To year"
          aria-label={`To year (optional) for ${label}`}
          aria-invalid={showError && toFilled ? true : undefined}
          aria-describedby={showError ? errorId : undefined}
          min={MIN_CAREER_YEAR}
          max={max}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, toYear: e.target.value })}
          onKeyDown={onKeyDown}
          className="w-28 p-1.5 text-sm"
        />
      </label>
      {/* Always mounted, text swapped in: a live region that exists before it
          speaks. */}
      <p id={errorId} role="status" className="basis-full text-xs text-neon-pink-text">
        {showError ? yearsHintText() : ""}
      </p>
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
  const boxRef = useRef<HTMLDivElement>(null);
  if (!pair) return null;
  const covered = coverage[pair.key];
  const read = covered === undefined && failed[pair.key] ? "failed" : covered === undefined ? "checking" : "done";
  // ONE status line for the whole follow-up, its words swapped in place, so
  // a screen reader hears each change rather than a region that is new.
  const statusText =
    read === "failed"
      ? careerFollowUpFailed(subject)
      : read === "checking"
        ? `Checking ${subject}’s career…`
        : covered
          ? coveredText(subject, team)
          : uncoveredAgainText(subject, team, setYear);
  const then: CareerFollowUp = answer.then;
  const setThen = (next: CareerFollowUp) => onAnswer({ ...answer, then: next });
  const addNow = () => setThen({ kind: "add", ...freshStint(setYear) });
  /** Into the years, as the line's own "Add to career" does. */
  const intoYears = () => {
    setTimeout(() => {
      boxRef.current?.querySelector<HTMLElement>("input")?.focus();
    }, 0);
  };
  return (
    <div ref={boxRef} className="space-y-2">
      <p role="status" className="text-sm text-ink-2">
        {statusText}
      </p>
      {read === "done" && !covered && (
        <>
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
                    if (kind === "leave") setThen(LEAVE_FOLLOW_UP);
                    else addNow();
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "ArrowRight" ||
                      event.key === "ArrowLeft" ||
                      event.key === "ArrowUp" ||
                      event.key === "ArrowDown"
                    ) {
                      event.preventDefault();
                      if (disabled) return;
                      const to = kind === "leave" ? "add" : "leave";
                      if (to === "leave") setThen(LEAVE_FOLLOW_UP);
                      else addNow();
                      event.currentTarget.parentElement
                        ?.querySelector<HTMLElement>(`[data-career-follow="${to}"]`)
                        ?.focus();
                    } else if (event.key === "Enter") {
                      // As the line's own radios: "Keep as is" moves on, "Add to
                      // career" picks and steps into the years.
                      event.preventDefault();
                      event.stopPropagation();
                      if (event.repeat || disabled) return;
                      if (kind === "leave") {
                        onWalk();
                        return;
                      }
                      if (!picked) addNow();
                      intoYears();
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
              label={`${subject}, ${team || "this team"}`}
              draft={then}
              onChange={(draft) => setThen({ kind: "add", ...draft })}
              onEnter={onWalk}
              disabled={disabled}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Different player
// ---------------------------------------------------------------------------

type Candidate = {
  playerId: Id<"players">;
  name: string;
  /** "b. 1971 · Reds 1973–90", or what is on file. */
  detail: string;
  covers?: boolean;
};

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
  /** The short team name, for "Played for …". */
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
  const elseRef = useRef<HTMLButtonElement>(null);
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
  /** Leaving the search without a pick: focus goes back to the button that opened it. */
  const cancelSearch = () => {
    setSearchOpen(false);
    setTimeout(() => elseRef.current?.focus(), 0);
  };
  const picked = answer.pick;
  // A pick made with "Someone else…" is not among the candidates: it joins
  // the list so the choice stays visible.
  const extra =
    picked && !read.candidates.some((c) => c.playerId === picked.playerId) ? picked : null;
  const choices: Candidate[] = [
    ...(extra ? [{ playerId: extra.playerId, name: extra.name, detail: "" }] : []),
    ...read.candidates.map((c) => ({
      playerId: c.playerId,
      name: c.name,
      // b. year and the career with its years; a bare row says so.
      detail:
        formatPlayerDescription({ birthYear: c.birthYear, career: c.careerSummary }) ||
        NOTHING_ON_FILE,
      covers: c.covers,
    })),
  ];

  return (
    <div className="space-y-2">
      {read.state === "loading" && (
        <p role="status" className="text-sm text-ink-2">
          Looking for players…
        </p>
      )}
      {choices.length > 0 && (
        <PlayerChoices
          label={`Which ${line.printedPlayer}?`}
          choices={choices}
          team={teamName}
          pickedId={picked?.playerId}
          disabled={disabled}
          onPick={pick}
        />
      )}
      {searchOpen ? (
        <EntityLinkSearch
          kind="player"
          sportId={sportId}
          contextOptionId={selectorOptionId}
          onSelect={(id, name) => pick(id as Id<"players">, name)}
          onCancel={cancelSearch}
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

/**
 * The namesakes, one radio group with one tab stop: arrows move and pick,
 * Space or a click picks, Enter picks. "Someone else…" is a button outside it.
 */
function PlayerChoices({
  label,
  choices,
  team,
  pickedId,
  disabled,
  onPick,
}: {
  label: string;
  choices: readonly Candidate[];
  team: string;
  pickedId?: Id<"players">;
  disabled: boolean;
  onPick: (playerId: Id<"players">, name: string) => void;
}) {
  const pickedAt = choices.findIndex((c) => c.playerId === pickedId);
  const stop = pickedAt >= 0 ? pickedAt : 0;
  // After an arrow pick the rows may be re-ordered by the re-render (a pick
  // joins the list as an extra row), so focus follows the player, by id,
  // once the new rows are in: never a position read before the render.
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterRender = useRef<string | null>(null);
  useEffect(() => {
    const id = focusAfterRender.current;
    if (id === null) return;
    focusAfterRender.current = null;
    optionRefs.current.get(id)?.focus();
  });
  return (
    <div role="radiogroup" aria-label={label} className="space-y-1">
      {choices.map((c, i) => {
        const picked = i === pickedAt;
        const choose = () => {
          if (disabled || picked) return;
          onPick(c.playerId, c.name);
        };
        return (
          <button
            key={c.playerId}
            ref={(el) => {
              if (el) optionRefs.current.set(c.playerId, el);
              else optionRefs.current.delete(c.playerId);
            }}
            type="button"
            role="radio"
            aria-checked={picked}
            aria-disabled={disabled || undefined}
            tabIndex={i === stop ? 0 : -1}
            onClick={choose}
            onKeyDown={(event) => {
              const step =
                event.key === "ArrowDown" || event.key === "ArrowRight"
                  ? 1
                  : event.key === "ArrowUp" || event.key === "ArrowLeft"
                    ? -1
                    : 0;
              if (step !== 0) {
                event.preventDefault();
                if (disabled) return;
                const to = (i + step + choices.length) % choices.length;
                if (to === pickedAt) {
                  // Already the pick: re-picking would reset what was typed under it.
                  optionRefs.current.get(choices[to].playerId)?.focus();
                  return;
                }
                focusAfterRender.current = choices[to].playerId;
                onPick(choices[to].playerId, choices[to].name);
              } else if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) choose();
              }
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
              {c.name}
            </span>
            {c.detail && <span className="text-xs text-ink-3">{c.detail}</span>}
            {c.covers && team && <span className="text-xs text-ink-2">{playedForText(team)}</span>}
          </button>
        );
      })}
    </div>
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
  pickedShortName,
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
  /** The picked team's short name, when known: what the follow-up calls it. */
  pickedShortName?: string;
  disabled: boolean;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  onWalk: () => void;
}) {
  const picked = answer.pick;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pick = (teamId: Id<"teams">, name: string) => {
    const next: CareerAnswer = { kind: "team", pick: { teamId, name }, then: LEAVE_FOLLOW_UP };
    onAnswer(next);
    const pair = followUpPair(line, next);
    if (pair) requestCoverage([coverageAskOf(pair.ask)]);
    setSearchOpen(false);
    // The search is about to unmount with focus in it.
    setTimeout(() => buttonRef.current?.focus(), 0);
  };
  /** Leaving the search without a pick: focus goes back to the button that opened it. */
  const cancelSearch = () => {
    setSearchOpen(false);
    setTimeout(() => buttonRef.current?.focus(), 0);
  };
  const open = searchOpen;

  return (
    <div className="space-y-2">
      {open ? (
        <EntityLinkSearch
          kind="team"
          sportId={sportId}
          contextOptionId={selectorOptionId}
          onSelect={(id, name) => pick(id as Id<"teams">, name)}
          onCancel={cancelSearch}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {picked && <p className="text-sm text-ink">{pickedShortName ?? picked.name}</p>}
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
          team={pickedShortName ?? picked.name}
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
