import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import type { Id } from "../../convex/_generated/dataModel";
import NeonButton from "../modules/NeonButton";
import { Input } from "../primitives/Input";
import { MAX_PLAYER_NAME_LENGTH } from "../../lib/players/name-limits";
import { nameSearchKey } from "../../lib/entities/name-search";
import { NOTHING_ON_FILE, formatPlayerDescription } from "../../lib/players/player-description";
import CareerTeamEntry, { type CareerTeamAdded } from "./CareerTeamEntry";
import EntityLinkSearch from "./EntityLinkSearch";
import { cardNumbersSummary } from "./teams-on-cards";
import { useRelinkCandidates } from "./career-reads";
import {
  CAREER_EDIT_REFUSED,
  CAREER_RETRY_LABEL,
  LEAVE_FOLLOW_UP,
  defaultCareerAnswer,
  lineStintTeam,
  NO_CAREER_TEXT,
  careerFollowUpFailed,
  careerHeading,
  cleanNewPlayerName,
  coverageAskOf,
  coveredText,
  followUpPair,
  isNewPlayerPick,
  newPlayerAnswer,
  newPlayerNameReady,
  preAddedStints,
  replaceStint,
  sameStint,
  sortCareerLines,
  noStintText,
  playedForText,
  stintChipText,
  uncoveredAgainText,
  withStint,
  type BatchTeam,
  type CareerAnswer,
  type CareerAnswers,
  type CareerFollowUp,
  type CareerLine,
  type CoverageAsk,
  type ExistingPlayerPick,
  type NewPlayerPick,
  type ExistingStint,
  type StagedStint,
  type StintTeamRef,
} from "./career-check";

/**
 * NEO-574 — the wizard's "Career check" step.
 *
 * Each line is one player and one team the player's career does not show for
 * the set's year, with the cards behind it:
 *
 *   Fernando Tatis Jr.
 *   No San Diego Padres stint by 2022.            Cards #12, #45
 *   (●) Add to career   ( ) Keep as is   ( ) Wrong player   ( ) Fix card’s team
 *
 * Every line opens on "Add to career" with the card's team already staged
 * (Jason 2026-11-19), so one Next passes the screen and Confirm & Save adds
 * those stints; "Keep as is" is the explicit way out. Nothing is written until
 * Confirm & Save. The panels open under the line:
 *
 *  - **Add to career**: the New Player step's stints widget
 *    (`CareerTeamEntry` and its chips). The player's stints on file are listed
 *    (none for a player with no career), the card's team from the set's year
 *    is already staged, and the operator can remove it, change it, or add any
 *    number more. Every stint staged here is sent at Confirm & Save.
 *  - **Wrong player**: the same-name players on file, those whose career
 *    covers the team first, and a search of existing players, open at once.
 *    The group ends with "New player named X" (always there, even with no
 *    namesake on file): the printed person is somebody NB has not got. It
 *    opens a name box (the printed name, editable) and the stints widget with
 *    the card's team staged. Nothing is written until Confirm & Save.
 *  - **Fix card's team**: a search of existing teams, open at once.
 *
 * A different player or team asks the coverage read about the NEW pair; if
 * that is uncovered too, one more choice appears right there: add the stint
 * for it (the same widget, the default, with the team staged), or keep as is.
 * (Picking again is just picking again.) One level deep.
 *
 * ## Keyboard (the house radio-group pattern)
 *
 * Each line is ONE radio group and ONE Tab stop, on its picked radio. Arrows
 * move and pick, wrapping, and NEVER open a picker or move focus off the
 * pills, so arrowing across "Wrong player" and "Fix card's team" is quiet.
 * Space or a click picks AND opens the picker that choice needs (the search
 * takes focus). Enter does the same, and from "Keep as is" moves on to the
 * next line (the last line: to Next), and from "Add to career" steps into the
 * team box. A held (repeating) Enter is refused. Escape in a search puts
 * focus back on the pill that opened it. In the stints widget, Enter on an
 * empty form is "done here": on to the next line.
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
  /** The stints a player has on file, for the "Add to career" widget to list. */
  existingStintsOf?: (playerId: string) => readonly ExistingStint[];
  /**
   * Teams the batch is creating that a card prints, which a stint can name
   * (they have no NB id until Confirm & Save).
   */
  batchTeams?: readonly BatchTeam[];
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
  /**
   * Some line's stints form holds a stint the operator started and has not
   * added (or a changed edit). The host holds Next while it is true, and says
   * why on its status line. Reported on the transitions; false when the step
   * goes away.
   */
  onStintDraftChange?: (open: boolean) => void;
  /**
   * The id of the host's status line, which says why Next is held. A new
   * player's name box with no name yet points at it (`aria-describedby`), so
   * the reason is read where the operator is.
   */
  blankNameReasonId?: string;
};

const NO_BATCH_TEAMS: readonly BatchTeam[] = [];

/** What every stints widget on the step needs besides its own stints. */
type StintEnv = {
  setYear: number;
  selectorOptionId: Id<"selectorOptions">;
  sportId: Id<"selectorOptions">;
  batchTeams: readonly BatchTeam[];
  existingStintsOf?: (playerId: string) => readonly ExistingStint[];
};

function kindOf(answer: CareerAnswer): Kind {
  return answer.kind;
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
  existingStintsOf,
  batchTeams = NO_BATCH_TEAMS,
  readFailed = false,
  onRetry,
  onAllDone,
  disabled = false,
  headingId,
  firstRef,
  onStintDraftChange,
  blankNameReasonId,
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
  /*
   * NEO-591 — which lines have a stint started in their form and not added.
   * Each stints form reports its own line; the host hears only "any".
   */
  const [draftKeys, setDraftKeys] = useState<ReadonlySet<string>>(() => new Set());
  const reportDraft = useCallback((key: string, dirty: boolean) => {
    setDraftKeys((prev) => {
      if (prev.has(key) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const draftOpen = draftKeys.size > 0;
  const draftHandlerRef = useRef(onStintDraftChange);
  useEffect(() => {
    draftHandlerRef.current = onStintDraftChange;
  }, [onStintDraftChange]);
  useEffect(() => {
    draftHandlerRef.current?.(draftOpen);
  }, [draftOpen]);
  // The step going away (Back, close) must not leave Next held for ever.
  useEffect(() => () => draftHandlerRef.current?.(false), []);
  /**
   * A player with two lines (one per team) has two of every control. Their
   * names then carry the line ("Player on Team"), where a player with one
   * line keeps the plain name.
   */
  const playersWithTwoLines = new Set<string>();
  {
    const seen = new Set<string>();
    for (const l of lines) {
      if (seen.has(l.playerId)) playersWithTwoLines.add(l.playerId);
      seen.add(l.playerId);
    }
  }
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
              stintEnv={{ setYear, selectorOptionId, sportId, batchTeams, existingStintsOf }}
              disabled={disabled}
              firstRef={i === 0 ? firstRef : undefined}
              onWalk={() => walkFrom(line.key)}
              sharedPlayer={playersWithTwoLines.has(line.playerId)}
              reportDraft={reportDraft}
              blankNameReasonId={blankNameReasonId}
            />
          </li>
        ))}
      </ul>
      {readFailed && <RetryButton onRetry={onRetry} disabled={disabled} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// What a line shares with its panels
// ---------------------------------------------------------------------------

type LineContextValue = {
  /** The line's always-mounted status region, once it is in the document. */
  statusEl: HTMLElement | null;
  /** The line's stints form holds something started and not added. */
  onDraft: (dirty: boolean) => void;
};
const LineContext = createContext<LineContextValue>({ statusEl: null, onDraft: () => {} });

/**
 * Words for the line's status region. The region exists before they do and
 * their text is swapped inside it, so a screen reader hears each one (a region
 * that mounts already holding its text is silent).
 */
function RowStatus({ children }: { children: ReactNode }) {
  const { statusEl } = useContext(LineContext);
  return statusEl ? createPortal(children, statusEl) : null;
}

// ---------------------------------------------------------------------------
// One line
// ---------------------------------------------------------------------------

function CareerLineRow({
  line,
  setYear,
  selectorOptionId,
  sportId,
  answer: storedAnswer,
  onAnswer,
  coverage,
  failed,
  requestCoverage,
  playerName,
  teamName,
  shortTeamName,
  pickedTeamShortName,
  noCareer,
  stintEnv,
  disabled,
  firstRef,
  onWalk,
  sharedPlayer,
  reportDraft,
  blankNameReasonId,
}: {
  line: CareerLine;
  setYear: number;
  selectorOptionId: Id<"selectorOptions">;
  sportId: Id<"selectorOptions">;
  /** The stored answer; absent = the default add (`defaultCareerAnswer`). */
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
  stintEnv: StintEnv;
  disabled: boolean;
  firstRef?: Ref<HTMLButtonElement>;
  onWalk: () => void;
  /** Another line on the step is this same player (on another team). */
  sharedPlayer: boolean;
  reportDraft: (lineKey: string, dirty: boolean) => void;
  blankNameReasonId?: string;
}) {
  const groupLabel = careerLineLabel(
    playerName,
    teamName,
    shortTeamName === undefined ? line.cardNumbers[0] : undefined,
  );
  /**
   * What names this line's controls ("Stints to add for …", "Someone else
   * for …"): the plain player, or, when that player has another line, the
   * line itself ("Player on Team"), so no two controls read alike.
   */
  const controlSubject = sharedPlayer ? groupLabel : playerName;
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /*
   * NEO-591 (a11y) — the line's one status region. It is mounted with the
   * line, empty, and the panels write their words into it, so a screen reader
   * hears each change rather than a region that arrives already saying it.
   */
  const [statusEl, setStatusEl] = useState<HTMLElement | null>(null);
  const lineKey = line.key;
  const lineContext = useMemo<LineContextValue>(
    () => ({ statusEl, onDraft: (dirty) => reportDraft(lineKey, dirty) }),
    [statusEl, reportDraft, lineKey],
  );
  /**
   * The last answer of each kind, kept while another kind is picked: arrowing
   * across the four pills must not destroy a typed name, edited stints or a
   * pick. Only the CURRENT kind's answer is ever the line's answer.
   */
  const remembered = useRef<Partial<Record<Kind, CareerAnswer>>>({});
  const noteId = useId();
  const cardsId = useId();
  /** The player/team search is open: it opens on its pill, and on the panel's own button. */
  const [searchOpen, setSearchOpen] = useState(false);
  /** The pill opened it (so Escape returns there), not the panel's button. */
  const [searchFromPill, setSearchFromPill] = useState(false);
  /** The card's team as a stint names it: the line's own, with the name its chip shows. */
  const lineTeam: StintTeamRef = lineStintTeam(line, teamName);
  // An untouched line is "Add to career" with the card's team staged; the
  // operator's first touch stores a real answer.
  const answer: CareerAnswer = storedAnswer ?? defaultCareerAnswer(line, setYear, teamName);
  const current = kindOf(answer);

  const focusIn = (selector: string) => {
    // Let the panel render, then step into it.
    setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>(selector)?.focus();
    }, 0);
  };
  const focusPill = () => {
    rootRef.current?.querySelector<HTMLElement>(`[data-career-kind="${current}"]`)?.focus();
  };

  /**
   * A radio is chosen. `arrow` only picks, and never opens anything or moves
   * focus (arrowing across the pills stays quiet); `press` (a click, Space) and
   * `enter` pick AND open what the choice needs, so a picker is never a second
   * click away. Pressing the radio that is already picked opens it again.
   */
  const choose = (kind: Kind, via: "arrow" | "press" | "enter") => {
    if (disabled) return;
    if (kind !== current) {
      remembered.current[current] = answer;
      const back = remembered.current[kind];
      if (back) onAnswer(back);
      else if (kind === "leave") onAnswer({ kind: "leave" });
      else if (kind === "add") {
        onAnswer({ kind: "add", stints: preAddedStints(lineTeam, setYear) });
      } else onAnswer({ kind, then: LEAVE_FOLLOW_UP });
      setSearchOpen(false);
    }
    if (via === "arrow") return;
    if (kind === "leave") {
      if (via === "enter") onWalk();
      return;
    }
    if (kind === "add") {
      if (via === "enter") focusIn("input");
      return;
    }
    setSearchFromPill(true);
    setSearchOpen(true);
    // The search takes focus as it mounts; one already open is refocused.
    focusIn("input");
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
      choose(to, "arrow");
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
    choose(kind, "enter");
  };

  return (
    <LineContext.Provider value={lineContext}>
      <div ref={rootRef} className="rounded-lg border border-rule-strong bg-raised">
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
                <NeonButton
                  key={kind}
                  ref={kind === current ? firstRef : undefined}
                  variant="secondary"
                  outline={!picked}
                  type="button"
                  role="radio"
                  aria-checked={picked}
                  aria-disabled={disabled || undefined}
                  tabIndex={picked ? 0 : -1}
                  data-career-kind={kind}
                  onClick={() => choose(kind, "press")}
                  onKeyDown={(event) => onKeyDown(event, kind)}
                  className="max-sm:min-h-11"
                >
                  {picked && (
                    <span aria-hidden="true" className="mr-1.5">
                      ✓
                    </span>
                  )}
                  {KIND_LABEL[kind]}
                </NeonButton>
              );
            })}
          </div>

          {/* Always here, empty until a panel has something to say. */}
          <p ref={setStatusEl} role="status" className="text-sm text-ink-2 empty:hidden" />

          {answer.kind !== "leave" && (
            <div ref={panelRef}>
              {answer.kind === "add" && (
                <StintsPanel
                  subject={controlSubject}
                  playerId={line.playerId}
                  stints={answer.stints}
                  onChange={(stints) => onAnswer({ kind: "add", stints })}
                  env={stintEnv}
                  onDone={onWalk}
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
                  controlSubject={controlSubject}
                  sharedPlayer={sharedPlayer}
                  blankNameReasonId={blankNameReasonId}
                  lineLabel={groupLabel}
                  teamName={shortTeamName ?? ""}
                  lineTeam={lineTeam}
                  stintEnv={stintEnv}
                  disabled={disabled}
                  searchOpen={searchOpen}
                  setSearchOpen={setSearchOpen}
                  onOpenSearch={() => {
                    setSearchFromPill(false);
                    setSearchOpen(true);
                  }}
                  searchFromPill={searchFromPill}
                  focusPill={focusPill}
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
                  controlSubject={controlSubject}
                  pickedShortName={pickedTeamShortName}
                  stintEnv={stintEnv}
                  disabled={disabled}
                  searchOpen={searchOpen}
                  setSearchOpen={setSearchOpen}
                  onOpenSearch={() => {
                    setSearchFromPill(false);
                    setSearchOpen(true);
                  }}
                  searchFromPill={searchFromPill}
                  focusPill={focusPill}
                  onWalk={onWalk}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </LineContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// The add widget: the New Player step's stints widget
// ---------------------------------------------------------------------------

/**
 * NEO-591 — "Add to career". It is the stints widget the New Player step
 * uses (its chips and `CareerTeamEntry`), not a copy of it:
 *
 *   On file:  [Padres (2019–2021)] [Reds (2022–present)]      (read-only)
 *   Adding:   [San Diego Padres (2022–2022) ×]
 *   [ team name … ] [ From year ] [ To year ] [ + Add ]
 *
 * The card's team is already staged, from the set's year: to the same year for
 * a past set, to "present" for this year's or later (`preAddedStints`). A chip's
 * label is a button: pressing it loads that stint's team and both years into
 * the form and marks the chip "editing"; + Add then puts the new years in the
 * chip's place. The stint stays in the list meanwhile, so nothing is lost if
 * the operator wanders off; × removes it (and, on the chip being edited,
 * empties the form). Pressing Edit while the form holds something the operator
 * typed is refused, and says so, rather than overwrite it. A form with a stint
 * started and not added holds the host's Next (`onDraft`). Stints are valid by
 * construction (the form holds the years) and name a team that exists
 * (`knownTeamsOnly`), so nothing staged can fail at Confirm & Save.
 */
const stintKey = (s: StagedStint): string => `${s.teamId ?? s.teamName}-${s.fromYear}`;

function StintsPanel({
  subject,
  playerId,
  stints,
  onChange,
  env,
  onDone,
  disabled,
}: {
  /** Whose career: names each control, so two lines never read alike. */
  subject: string;
  playerId: string;
  stints: readonly StagedStint[];
  onChange: (stints: StagedStint[]) => void;
  env: StintEnv;
  /** Enter on the empty form. */
  onDone: () => void;
  disabled: boolean;
}) {
  const existing = env.existingStintsOf?.(playerId) ?? [];
  const { onDraft } = useContext(LineContext);
  const rootRef = useRef<HTMLDivElement>(null);
  const editingBaseId = useId();
  /** The stint being edited, handed to the form; a new token each press. */
  const [edit, setEdit] = useState<ComponentProps<typeof CareerTeamEntry>["load"]>(undefined);
  /** The staged stint whose years the form holds: + Add replaces it. */
  const [editing, setEditing] = useState<StagedStint | null>(null);
  /** Bumped to empty the form (the stint it held is gone). */
  const [resetToken, setResetToken] = useState(0);
  /** The form holds something the operator typed (or changed) and has not added. */
  const [formDirty, setFormDirty] = useState(false);
  /** Edit was pressed on a dirty form this many times running (0 = no reason shown). */
  const [refusals, setRefusals] = useState(0);
  const onFormDirty = (dirty: boolean) => {
    setFormDirty(dirty);
    if (!dirty) setRefusals(0);
    onDraft(dirty);
  };
  // The panel going away (another answer, another line) must not leave the
  // step thinking a stint is half-typed.
  const onDraftRef = useRef(onDraft);
  useEffect(() => {
    onDraftRef.current = onDraft;
  }, [onDraft]);
  useEffect(() => () => onDraftRef.current(false), []);

  /*
   * Focus after × (only when × held it): the next chip's Edit, else the
   * previous chip's, else the team box. The pressed button is about to leave
   * the document, and focus would fall to the page.
   */
  const editRefs = useRef(new Map<string, HTMLButtonElement>());
  const parkRef = useRef<{ stintKey: string } | "box" | null>(null);
  useEffect(() => {
    const park = parkRef.current;
    if (park === null) return;
    parkRef.current = null;
    if (park === "box") rootRef.current?.querySelector<HTMLElement>("input")?.focus();
    else editRefs.current.get(park.stintKey)?.focus();
  });

  const onAdd = (entry: CareerTeamAdded) => {
    const years = {
      fromYear: entry.fromYear,
      ...(entry.toYear !== undefined ? { toYear: entry.toYear } : {}),
    };
    let added: StagedStint | undefined;
    if (entry.teamId) {
      added = { teamId: entry.teamId, label: entry.name, ...years };
    } else {
      const key = nameSearchKey(entry.name);
      const batch = env.batchTeams.find((t) => nameSearchKey(t.label) === key);
      if (batch) added = { teamName: batch.teamName, label: batch.label, ...years };
    }
    if (!added) return;
    onChange(editing ? replaceStint(stints, editing, added) : withStint(stints, added));
    setEditing(null);
  };
  return (
    <div ref={rootRef} className="space-y-1.5" data-career-stint-draft={formDirty ? "started" : undefined}>
      {existing.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span aria-hidden="true" className="text-xs text-ink-3">
            On file:
          </span>
          <ul className="flex flex-wrap gap-1.5" aria-label={`Career on file for ${subject}`}>
            {existing.map((stint) => (
              <li key={stint.key}>
                <span className="inline-flex items-center rounded-full border border-rule bg-raised px-2 py-0.5 text-xs text-ink-3">
                  {stintChipText(stint)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {stints.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span aria-hidden="true" className="text-xs text-ink-3">
            Adding:
          </span>
          <ul className="flex flex-wrap gap-1.5" aria-label={`Stints to add for ${subject}`}>
            {stints.map((stint, idx) => {
              const key = stintKey(stint);
              const isEditing = editing !== null && sameStint(editing, stint);
              const editingId = `${editingBaseId}-${idx}`;
              return (
                <li key={key}>
                  {/* Edit and × are real 24px boxes (SC 2.5.8, min-h-6), not
                      pseudo-element hit areas: a text-sized target 8px from a
                      neighbour fails the spacing exception. The chip stays
                      compact because the 24px is inside its own border. */}
                  <span
                    className={`inline-flex items-center gap-2 rounded-full border bg-raised pl-2 pr-1 text-xs text-ink-2 ${
                      isEditing ? "border-neon-blue-text" : "border-rule-strong"
                    }`}
                  >
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) editRefs.current.set(key, el);
                        else editRefs.current.delete(key);
                      }}
                      aria-label={`Edit ${stintChipText(stint)} for ${subject}`}
                      aria-current={isEditing ? "true" : undefined}
                      aria-describedby={isEditing ? editingId : undefined}
                      aria-disabled={disabled || undefined}
                      onClick={() => {
                        if (disabled) return;
                        if (formDirty) {
                          // Something typed would be overwritten: say so and stay put.
                          setRefusals((n) => n + 1);
                          return;
                        }
                        setRefusals(0);
                        setEditing(stint);
                        setEdit({
                          token: (edit?.token ?? 0) + 1,
                          name: stint.label,
                          ...(stint.teamId ? { teamId: stint.teamId } : {}),
                          fromYear: stint.fromYear,
                          ...(stint.toYear !== undefined ? { toYear: stint.toYear } : {}),
                        });
                      }}
                      className="inline-flex min-h-6 items-center rounded text-left hover:text-ink focus-outline"
                    >
                      {stintChipText(stint)}
                    </button>
                    {isEditing && (
                      <span id={editingId} className="text-neon-blue-text">
                        editing
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove ${stintChipText(stint)} for ${subject}`}
                      aria-disabled={disabled || undefined}
                      onClick={(event) => {
                        if (disabled) return;
                        if (document.activeElement === event.currentTarget) {
                          const neighbour = stints[idx + 1] ?? stints[idx - 1];
                          parkRef.current = neighbour ? { stintKey: stintKey(neighbour) } : "box";
                        }
                        if (isEditing) {
                          // Cancelling the edit: the form lets go of the years too.
                          setEditing(null);
                          setResetToken((n) => n + 1);
                        }
                        onChange(stints.filter((_, i) => i !== idx));
                      }}
                      className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full text-ink-3 hover:text-ink focus-outline"
                    >
                      ×
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {/* Always here, so the reason is heard when it appears. */}
      <p role="status" className="text-xs text-neon-pink-text empty:hidden">
        {refusals > 0 ? `${CAREER_EDIT_REFUSED}${refusals % 2 === 0 ? "\u00A0" : ""}` : ""}
      </p>
      <CareerTeamEntry
        sportId={env.sportId}
        contextOptionId={env.selectorOptionId}
        stagedNames={env.batchTeams.map((t) => t.label)}
        label={subject}
        knownTeamsOnly
        disabled={disabled}
        onAdd={onAdd}
        onDone={onDone}
        onDirtyChange={onFormDirty}
        load={edit}
        resetToken={resetToken}
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
  stintEnv,
  stintTeam,
  subjectId,
  answer,
  onAnswer,
  coverage,
  failed,
  subject,
  controlSubject = subject,
  team,
  disabled,
  onWalk,
}: {
  line: CareerLine;
  setYear: number;
  stintEnv: StintEnv;
  /** The team a stint for the NEW pair names, and the name its chip shows. */
  stintTeam: StintTeamRef;
  /** The player the NEW pair is about. */
  subjectId: string;
  answer: Extract<CareerAnswer, { kind: "player" | "team" }>;
  onAnswer: (answer: CareerAnswer) => void;
  coverage: Readonly<Record<string, boolean>>;
  failed: Readonly<Record<string, boolean>>;
  /** Whose career, and which team, the re-check is about. */
  subject: string;
  /**
   * What names this follow-up's controls: the subject, made distinct when
   * another line would give the same controls the same names.
   */
  controlSubject?: string;
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
  // Untouched = add, with the NEW pair's team staged (the default).
  const then: CareerFollowUp = answer.then ?? {
    kind: "add",
    stints: preAddedStints(stintTeam, setYear),
  };
  const setThen = (next: CareerFollowUp) => onAnswer({ ...answer, then: next });
  const addNow = () => setThen({ kind: "add", stints: preAddedStints(stintTeam, setYear) });
  /** Into the team box, as the line's own "Add to career" does. */
  const intoYears = () => {
    setTimeout(() => {
      boxRef.current?.querySelector<HTMLElement>("input")?.focus();
    }, 0);
  };
  return (
    <div ref={boxRef} className="space-y-2">
      {/* The line's own status region says it (see `RowStatus`). */}
      <RowStatus>{statusText}</RowStatus>
      {read === "done" && !covered && (
        <>
          <div
            role="radiogroup"
            aria-label={`Career for ${controlSubject}`}
            id={groupId}
            className="flex flex-wrap gap-2"
          >
            {(["leave", "add"] as const).map((kind) => {
              const picked = then.kind === kind;
              return (
                <NeonButton
                  key={kind}
                  variant="secondary"
                  outline={!picked}
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
                  className="max-sm:min-h-11"
                >
                  {picked && (
                    <span aria-hidden="true" className="mr-1.5">
                      ✓
                    </span>
                  )}
                  {KIND_LABEL[kind]}
                </NeonButton>
              );
            })}
          </div>
          {then.kind === "add" && (
            <StintsPanel
              subject={controlSubject}
              playerId={subjectId}
              stints={then.stints}
              onChange={(stints) => setThen({ kind: "add", stints })}
              env={stintEnv}
              onDone={onWalk}
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
  controlSubject,
  sharedPlayer,
  blankNameReasonId,
  lineLabel,
  teamName,
  lineTeam,
  stintEnv,
  disabled,
  searchOpen,
  setSearchOpen,
  onOpenSearch,
  searchFromPill,
  focusPill,
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
  /** What names this line's controls: the player, or the line when the player has two. */
  controlSubject: string;
  /** This player has another line on the step. */
  sharedPlayer: boolean;
  /** The host's status line, which says why Next is held while the name is blank. */
  blankNameReasonId?: string;
  /** The line's radio group name: tells this line's name box from another's. */
  lineLabel: string;
  /** The short team name, for "Played for …". */
  teamName: string;
  /** The card's team as a stint for the picked player names it. */
  lineTeam: StintTeamRef;
  stintEnv: StintEnv;
  disabled: boolean;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  /** Open the search from the panel's own button. */
  onOpenSearch: () => void;
  /** The pill opened the search: Escape returns there. */
  searchFromPill: boolean;
  focusPill: () => void;
  onWalk: () => void;
}) {
  const read = useRelinkCandidates(selectorOptionId, {
    printedName: line.printedPlayer,
    ...(line.teamId ? { teamId: line.teamId as Id<"teams"> } : {}),
    ...(line.teamName ? { teamName: line.teamName } : {}),
    excludePlayerId: line.playerId as Id<"players">,
  });
  const elseRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const stintsRef = useRef<HTMLDivElement>(null);
  /** The search, to know whether focus is in it when a namesake is picked. */
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const picked = answer.pick;
  const pickedNew: NewPlayerPick | undefined = isNewPlayerPick(picked) ? picked : undefined;
  const pickedExisting: ExistingPlayerPick | undefined =
    picked && !isNewPlayerPick(picked) ? picked : undefined;
  const pick = (playerId: Id<"players">, name: string) => {
    const next: CareerAnswer = { kind: "player", pick: { playerId, name } };
    onAnswer(next);
    const pair = followUpPair(line, next);
    if (pair) requestCoverage([coverageAskOf(pair.ask)]);
    if (searchOpen) {
      // Focus in the search (a result was taken) is about to be lost with it;
      // focus on a namesake (an arrow pick) is not the search's to take.
      const focusInSearch = searchWrapRef.current?.contains(document.activeElement) ?? false;
      setSearchOpen(false);
      if (focusInSearch) setTimeout(() => elseRef.current?.focus(), 0);
    }
  };
  /**
   * "New player named X". The ref is minted here, once, and lives in the answer;
   * picking the option again keeps the answer (and so the ref) as it is. An
   * arrow only picks; a click, Space or Enter also steps into the name box.
   */
  const pickNew = (via: "arrow" | "press") => {
    if (disabled) return;
    if (!pickedNew) {
      onAnswer(newPlayerAnswer({ printedName: line.printedPlayer, team: lineTeam, setYear }));
    }
    if (searchOpen) setSearchOpen(false);
    if (via === "arrow") return;
    setTimeout(() => nameRef.current?.focus(), 0);
  };
  /** Leaving the search without a pick: focus goes back to what opened it. */
  const cancelSearch = () => {
    setSearchOpen(false);
    setTimeout(() => (searchFromPill ? focusPill() : elseRef.current?.focus()), 0);
  };
  // A pick made with "Someone else…" is not among the candidates: it joins
  // the list so the choice stays visible.
  const extra =
    pickedExisting && !read.candidates.some((c) => c.playerId === pickedExisting.playerId)
      ? pickedExisting
      : null;
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
  const newName = pickedNew ? cleanNewPlayerName(pickedNew.name) : "";
  const newNameReady = pickedNew ? newPlayerNameReady(pickedNew.name) : false;
  const newStints = answer.then?.kind === "add" ? answer.then.stints : [];

  return (
    <div className="space-y-2">
      {read.state === "loading" && <RowStatus>Looking for players…</RowStatus>}
      <PlayerChoices
        label={sharedPlayer ? `Which ${controlSubject}?` : `Which ${line.printedPlayer}?`}
        choices={choices}
        team={teamName}
        pickedId={pickedExisting?.playerId}
        newOption={{
          name: newName || line.printedPlayer.trim(),
          picked: pickedNew !== undefined,
        }}
        disabled={disabled}
        onPick={pick}
        onPickNew={pickNew}
        onEnterNew={() => nameRef.current?.focus()}
      />
      {searchOpen ? (
        <div ref={searchWrapRef}>
          <EntityLinkSearch
            kind="player"
            sportId={sportId}
            contextOptionId={selectorOptionId}
            onSelect={(id, name) => pick(id as Id<"players">, name)}
            onCancel={cancelSearch}
          />
        </div>
      ) : (
        <NeonButton
          ref={elseRef}
          size="1"
          variant="secondary"
          outline
          onClick={() => {
            if (!disabled) onOpenSearch();
          }}
          aria-disabled={disabled || undefined}
          aria-label={`Someone else for ${controlSubject}`}
          className="max-sm:min-h-11"
        >
          Someone else…
        </NeonButton>
      )}
      {pickedNew && (
        <div className="space-y-1.5">
          <Input
            bare
            ref={nameRef}
            type="text"
            value={pickedNew.name}
            maxLength={MAX_PLAYER_NAME_LENGTH}
            aria-label={`New player’s name for ${lineLabel}`}
            aria-invalid={!newNameReady || undefined}
            aria-describedby={newNameReady ? undefined : blankNameReasonId}
            data-career-new-name={newNameReady ? "named" : "blank"}
            disabled={disabled}
            onChange={(e) =>
              onAnswer({ ...answer, pick: { ...pickedNew, name: e.target.value } })
            }
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              // Never the wizard's own Enter. A named player: on to the team box.
              e.preventDefault();
              e.stopPropagation();
              if (e.repeat || !newNameReady) return;
              stintsRef.current?.querySelector<HTMLElement>("input")?.focus();
            }}
            className="w-full p-1.5 text-sm"
          />
          <div ref={stintsRef}>
            <StintsPanel
              subject={
                sharedPlayer
                  ? `${newName || line.printedPlayer.trim()} (${lineLabel})`
                  : newName || line.printedPlayer.trim()
              }
              playerId=""
              stints={newStints}
              onChange={(stints) => onAnswer({ ...answer, then: { kind: "add", stints } })}
              env={stintEnv}
              onDone={onWalk}
              disabled={disabled}
            />
          </div>
        </div>
      )}
      {pickedExisting && (
        <FollowUp
          line={line}
          setYear={setYear}
          stintEnv={stintEnv}
          stintTeam={lineTeam}
          subjectId={pickedExisting.playerId}
          answer={answer}
          onAnswer={onAnswer}
          coverage={coverage}
          failed={failed}
          subject={pickedExisting.name}
          controlSubject={
            sharedPlayer ? `${pickedExisting.name} (${lineLabel})` : pickedExisting.name
          }
          team={teamName}
          disabled={disabled}
          onWalk={onWalk}
        />
      )}
    </div>
  );
}

/**
 * The namesakes, then "New player named X": one radio group with one tab stop.
 * Arrows move and pick (never a focus jump off the rows), Space or a click
 * picks, Enter picks. "New player" also steps into its name box on a click,
 * Space or Enter. "Someone else…" is a button outside the group.
 */
function PlayerChoices({
  label,
  choices,
  team,
  pickedId,
  newOption,
  disabled,
  onPick,
  onPickNew,
  onEnterNew,
}: {
  label: string;
  choices: readonly Candidate[];
  team: string;
  pickedId?: Id<"players">;
  /** The last row: the printed person is nobody NB has. */
  newOption: { name: string; picked: boolean };
  disabled: boolean;
  onPick: (playerId: Id<"players">, name: string) => void;
  onPickNew: (via: "arrow" | "press") => void;
  /** Enter on the New player row that is already the pick. */
  onEnterNew: () => void;
}) {
  // The rows: each namesake by player id, then the new-player row.
  const NEW = "__new";
  const rowIds = [...choices.map((c) => c.playerId as string), NEW];
  const pickedAt = newOption.picked
    ? rowIds.length - 1
    : choices.findIndex((c) => c.playerId === pickedId);
  const stop = pickedAt >= 0 ? pickedAt : 0;
  // After an arrow pick the rows may be re-ordered by the re-render (a pick
  // joins the list as an extra row), so focus follows the row, by id,
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
      {rowIds.map((rowId, i) => {
        const isNew = rowId === NEW;
        const c = isNew ? undefined : choices[i];
        const picked = i === pickedAt;
        const choose = (via: "arrow" | "press") => {
          if (disabled) return;
          if (isNew) {
            onPickNew(via);
            return;
          }
          if (picked || !c) return;
          onPick(c.playerId, c.name);
        };
        return (
          <NeonButton
            key={rowId}
            ref={(el) => {
              if (el) optionRefs.current.set(rowId, el);
              else optionRefs.current.delete(rowId);
            }}
            variant="secondary"
            outline={!picked}
            type="button"
            role="radio"
            aria-checked={picked}
            aria-disabled={disabled || undefined}
            tabIndex={i === stop ? 0 : -1}
            onClick={() => choose("press")}
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
                const to = (i + step + rowIds.length) % rowIds.length;
                if (to === pickedAt) {
                  // Already the pick: re-picking would reset what was typed under it.
                  optionRefs.current.get(rowIds[to])?.focus();
                  return;
                }
                focusAfterRender.current = rowIds[to];
                if (rowIds[to] === NEW) onPickNew("arrow");
                else onPick(choices[to].playerId, choices[to].name);
              } else if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                if (event.repeat || disabled) return;
                if (isNew && picked) onEnterNew();
                else choose("press");
              }
            }}
            // Up to three lines in one button: the name, the detail and the
            // team note. The lines inherit NeonButton's ink (no colour of their
            // own), so they read on the outline, the fill and the hover fill.
            className="h-auto w-full flex-col items-start whitespace-normal py-1.5 text-left max-sm:min-h-11"
          >
            <span className="font-semibold">
              {picked && (
                <span aria-hidden="true" className="mr-1.5">
                  ✓
                </span>
              )}
              {isNew ? `New player named ${newOption.name}` : c?.name}
            </span>
            {c?.detail && <span className="text-xs font-normal">{c.detail}</span>}
            {c?.covers && team && <span className="text-xs font-normal">{playedForText(team)}</span>}
          </NeonButton>
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
  controlSubject,
  pickedShortName,
  stintEnv,
  disabled,
  searchOpen,
  setSearchOpen,
  onOpenSearch,
  searchFromPill,
  focusPill,
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
  /** What names this line's controls: the player, or the line when the player has two. */
  controlSubject: string;
  /** The picked team's short name, when known: what the follow-up calls it. */
  pickedShortName?: string;
  stintEnv: StintEnv;
  disabled: boolean;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  /** Open the search from the panel's own button. */
  onOpenSearch: () => void;
  /** The pill opened the search: Escape returns there. */
  searchFromPill: boolean;
  focusPill: () => void;
  onWalk: () => void;
}) {
  const picked = answer.pick;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pick = (teamId: Id<"teams">, name: string) => {
    const next: CareerAnswer = { kind: "team", pick: { teamId, name } };
    onAnswer(next);
    const pair = followUpPair(line, next);
    if (pair) requestCoverage([coverageAskOf(pair.ask)]);
    setSearchOpen(false);
    // The search is about to unmount with focus in it.
    setTimeout(() => buttonRef.current?.focus(), 0);
  };
  /** Leaving the search without a pick: focus goes back to what opened it. */
  const cancelSearch = () => {
    setSearchOpen(false);
    setTimeout(() => (searchFromPill ? focusPill() : buttonRef.current?.focus()), 0);
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
            onClick={() => {
              if (!disabled) onOpenSearch();
            }}
            aria-disabled={disabled || undefined}
            aria-label={
              picked
                ? `Pick another team for ${controlSubject}`
                : `Pick a team for ${controlSubject}`
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
          stintEnv={stintEnv}
          stintTeam={{ teamId: picked.teamId, label: picked.name }}
          subjectId={line.playerId}
          answer={answer}
          onAnswer={onAnswer}
          coverage={coverage}
          failed={failed}
          subject={playerName}
          controlSubject={controlSubject}
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
