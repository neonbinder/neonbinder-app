import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useSetNameInTitlesTarget } from "./set-name-in-titles-jump";
import { PencilSquareIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useFieldTestClass } from "@/src/hooks/useFieldTestClass";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  EXPECTED_FEATURES,
  type ExpectedFeature,
} from "../../convex/features/expectedFeatures";
import { resolvableSides } from "../../convex/marketplaceResolvability";
import {
  primaryId,
  slotIds,
  type SlotBearingRow,
} from "../../convex/platformSlots";
import { isSlAllBrandsBrandId } from "../../convex/slBrandAxis";
// NEO-294 — the refusal the server throws, rendered by the affordance that
// would otherwise earn it. One sentence, one definition; a second copy here
// is how the panel and the mutation come to disagree.
import {
  BRAND_UNKNOWN_RENAME_REFUSAL,
  isBrandUnknownRow,
} from "../../convex/selectorSyncMatch";
import { activateOnEnter } from "@/lib/dom/activate-on-enter";
import { EDIT_ATTRIBUTES_LABEL } from "./control-labels";
import { ConfirmDialog } from "../modules/confirm-dialog";
import { userFacingMessage } from "@/lib/errors/user-facing-message";
import { teamFullName } from "../../lib/teams/team-name";
import { FeatureValueControl } from "./FeatureValueControl";
import { AUTOGRAPH_CHOICE_LABEL, AUTOGRAPH_FORMATS } from "./entity-review-steps";
import CardPrefixRow from "./CardPrefixRow";
import RenameEntityControl, { type RenameEntityHandle } from "./RenameEntityControl";
import { derivedVariantFlags, variantTypeKind } from "../../convex/variantRole";
import { titleChainFacts } from "../../convex/listingShortName";
import { setDescriptionForTitles } from "../../convex/features/listingInputs";
import MoveSetToBrandControl from "./MoveSetToBrandControl";
import MakeParallelControl, { type ReshapeStep } from "./MakeParallelControl";
import MakeInsertControl from "./MakeInsertControl";
import PromoteToSetControl from "./PromoteToSetControl";
import PublishedChecklistPanel from "./PublishedChecklistPanel";
import TeamPicker, { type TeamPickerLabels } from "./TeamPicker";
import { NO_TEAM_LABELS, NO_TEAM_TEXT } from "./team-picker-labels";
import EveryCardPlayerControl from "./EveryCardPlayerControl";
import SetLeagueRow from "./SetLeagueRow";
import NoTeamCardsControl from "./NoTeamCardsControl";
import {
  ALL_SIDES,
  joinLabels,
  LEVEL_SINGULAR,
  levelNoun,
  SIDE_LABEL,
  type SelectorLevel,
} from "./selector-sync-feedback";

/**
 * NEO-38 (PR B-2) — level-agnostic set ATTRIBUTES editor.
 *
 * Renamed/generalized from `SetFeaturesPanel`. Mounts at the deepest
 * selected node at ANY level (sport → parallel), not just setName, so
 * the panel never vanishes when a variant (e.g. "Base") is selected.
 *
 * Renders one row per applicable `EXPECTED_FEATURES` entry — persisted via
 * `setSelectorOptionFeature`, a single-row patch on THIS node only
 * (NEO-71-74: write-once feature snapshots). A row's `features` is already
 * the complete resolved value — computed once via copy-down at the node's
 * own creation — so this panel reads it directly, with no client-side
 * ancestor-chain merge.
 *
 * `releaseDate` / `block` / `totalCardCount` used to live in a separate
 * `setMetadata` object editable ONLY at the setName level (with every other
 * level showing a read-only "inherited from Set" display). That couldn't
 * represent a real case: a parallel/insert released LATER than its parent
 * set (e.g. a Panini Rewards-exclusive parallel with its own release date).
 * They're now plain features like everything else here — independently
 * editable at every set-side level, copied down at creation like the rest.
 *
 * Collapsible so it never pushes the card list off-screen. Collapsed shows
 * one compact line: the title and the "Edit attributes" toggle, nothing else
 * (NEO-569; a run's ledger is the one thing kept on screen). Default
 * collapsed only when `defaultCollapsed` (cards present); expanded otherwise
 * so the setName-with-no-cards flow needs no extra tap. NEO-496: the set
 * level itself always opens by default, its official checklist first,
 * unless the operator closed it on that set this tab session.
 *
 * None of these fields are actually required — blank is a perfectly
 * acceptable, complete answer for most of them (not every card is
 * autographed, has a memorabilia relic, a known signer, etc). There is
 * deliberately no "missing"/required warning treatment anywhere in this
 * panel — every row renders identically whether filled in or blank.
 *
 * Save flow:
 *   1. User types a new value into a row.
 *   2. Blur / Enter triggers the mutation (patches this row only).
 *   3. Toast renders "Saved {label}".
 *
 * Clear flow (NEO-217): emptying a text row, or picking the "—" option in a
 * select, sends `value: ""`, which the server treats as "remove this key"
 * (never as a stored empty string). The toast then reads "Cleared {label}".
 * Blank is a complete answer for every field here, so being unable to get back
 * to blank was a hole, not a safeguard.
 *
 * Team (NEO-277): the ONE attribute here that flows down. A whole set can
 * belong to one team — a minor league team set, a police set, a college issue
 * — and typing that team onto every card by hand was the whole cost of
 * building such a set. `teamIds` is a typed top-level field on the row (not a
 * `features` key: it is a link to NB's own `teams` rows, not a string), edited
 * at setName/variantType/insert/parallel through the same `TeamPicker` the
 * card drawer uses. It is rendered FIRST and outside the features grid because
 * it behaves differently from everything in the grid: saving a non-empty value
 * cascades to the rows and cards beneath (server-side, chunked), so the save
 * goes through a confirm that states the card count; clearing it never touches
 * a card, and says so before it happens when cards would be left carrying the
 * team. See `SetTeamRow`.
 *
 * Card prefix (NEO-291): the first cell of the grid, at the levels whose cards
 * carry one — an insert, a parallel, or the base variant type. It is
 * `metadata.cardNumberPrefix`, not a `features` key, and saves through its own
 * mutation; otherwise it behaves exactly like the text rows around it. See
 * `CardPrefixRow`.
 *
 * Brand (NEO-237): the first cell of the grid on a MANUFACTURER row — the
 * set-name prefix that says which sets are this brand's ("Choice" files
 * "Choice Biloxi Shuckers" here) and, for a brand linked to SportLots through
 * its All Brands option, what SportLots is asked for. `metadata.setNamePrefix`,
 * its own mutation, and a save that can MOVE sets: prefix-matching sets sit
 * under the year's Unknown row until a brand claims them, so the toast says
 * how many it moved. Hidden on the Unknown row itself, which has no prefix by
 * definition. The label is "Brand" (Jason 2026-09-21, provisional). See
 * `BrandPrefixRow`.
 *
 * Beside it, on the same rows, the brand's SportLots link "through All
 * Brands" as a pressed toggle (`SlViaAllBrandsToggle`): on when the row's
 * SportLots id is SportLots' all-brands option, so SportLots is asked for the
 * whole year and narrowed to the sets that start with the Brand value. The
 * confirm-create tick was the only door to that link before; this is the
 * repair path for a brand created without it, and the undo. Disabled with
 * the reason when the row holds a SportLots brand of its own (a real link is
 * never overwritten) or when the year has no SportLots link to go through.
 */

/**
 * NEO-306 — "Edit attributes ▾" / "Hide attributes ▴". Their text stays (flows
 * target it); they gain the panel's one focus ring and a taller line box. The
 * old `focus:outline-none` with only a colour change left a keyboard operator
 * a focus indicator in name only.
 */
const HIDE_ATTRIBUTES_LABEL = "Hide attributes";
const ATTRIBUTES_TOGGLE_CLASS =
  "text-xs py-1 rounded text-ink-3 hover:text-neon-green-text focus-outline";

/**
 * NEO-291 — where the Card prefix row is editable.
 *
 * The checklist sync reads the prefix off the ancestor chain of the row the
 * cards hang from, so it is edited where cards hang: inserts and parallels
 * always, and a variant type only when it is the base set (Base's cards hang
 * directly from it; any other variant type's cards hang from its inserts).
 * Sport, year, manufacturer and set are containers — a prefix there would
 * apply to every checklist beneath, which no set does.
 */
function showsCardPrefix(level: Level, value: string): boolean {
  if (level === "insert" || level === "parallel") return true;
  return level === "variantType" && variantTypeKind({ value }) === "base";
}

/**
 * NEO-335 — where "Set name in titles" is edited: the set row, and the
 * levels cards hang from (`showsCardPrefix`). The title reads the nearest
 * self-or-ancestor short name up to the set, so a set-wide name lives on the
 * set and an insert can carry its own.
 */
function showsShortNameRow(level: Level, value: string): boolean {
  return level === "setName" || showsCardPrefix(level, value);
}


/**
 * NEO-277 — where the Team row is editable. Sport, year and manufacturer are
 * containers for many teams' sets; a team only makes sense from the set down.
 */
const TEAM_LEVELS: ReadonlySet<string> = new Set([
  "setName",
  "variantType",
  "insert",
  "parallel",
]);

/**
 * NEO-496 — the set level opens this panel by default (Jason, 2026-11-12):
 * the set's official checklist upload sits at its top, and a set is where an
 * operator goes to give it one. Every other level keeps the caller's default
 * (collapsed in the set builder, NEO-38). An operator who closes the panel
 * on a set keeps it closed on that set for the rest of the tab session, so
 * Back to the set or a re-pick never reopens what they put away.
 * `sessionStorage` can throw (private windows, blocked site data), so every
 * touch is guarded and the set simply opens by default if it does.
 */
const CLOSED_SETS_KEY = "nb.setAttributesClosedSets";
/**
 * NEO-496 (a11y audit) — the most sets remembered as closed; the oldest
 * close is dropped first. A long session walks a few dozen sets at most, so
 * this only keeps the stored list from growing without end.
 */
export const CLOSED_SETS_CAP = 200;

function readClosedSets(): string[] {
  try {
    const raw = window.sessionStorage.getItem(CLOSED_SETS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function rememberSetClosed(id: string, closed: boolean) {
  try {
    const rest = readClosedSets().filter((other) => other !== id);
    // Newest last, so the oldest close is the one dropped at the cap.
    const next = closed ? [...rest, id].slice(-CLOSED_SETS_CAP) : rest;
    window.sessionStorage.setItem(CLOSED_SETS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the set opens by default next time.
  }
}

/** Whether the panel starts open on this row (see `CLOSED_SETS_KEY`). */
function opensByDefault(
  level: string | undefined,
  id: string,
  defaultCollapsed: boolean | undefined,
): boolean {
  if (level === "setName") return !readClosedSets().includes(id);
  return !defaultCollapsed;
}

type Level =
  | "sport"
  | "year"
  | "manufacturer"
  | "setName"
  | "variantType"
  | "insert"
  | "parallel";

/** Human-readable label per selectorOptions level (fixes QA #2). */
const LEVEL_LABEL: Record<Level, string> = {
  sport: "Sport",
  year: "Year",
  manufacturer: "Manufacturer",
  setName: "Set",
  variantType: "Variant",
  insert: "Insert",
  parallel: "Parallel",
};

export default function SetAttributesPanel({
  selectorOptionId,
  defaultCollapsed,
  onDeleted,
  onMoved,
  onReshaped,
  sources,
}: {
  selectorOptionId: Id<"selectorOptions">;
  /** Start collapsed (cards present) so the panel doesn't push them off-screen. */
  defaultCollapsed?: boolean;
  /**
   * NEO-219 — the row this panel describes was just deleted, so the panel and
   * everything downstream of it is about to be pointing at nothing. The owner
   * (`SetSelector`) clears the selection from `level` down and parks focus on
   * the column, because only it knows where "stable" is; this panel cannot,
   * since it unmounts as part of the same update.
   */
  onDeleted?: (level: SelectorLevel) => void;
  /**
   * NEO-294 — the set this panel describes has moved under `brandId`. The
   * Sets column is scoped to the brand it LEFT, so without this the row
   * silently disappears from the column the operator is looking at while the
   * panel below carries on describing it. The owner re-points the
   * Manufacturers column at the destination; same division as `onDeleted` —
   * only it knows what the cascade above this panel is showing.
   */
  onMoved?: (brandId: Id<"selectorOptions">) => void;
  /**
   * NEO-305 — the row this panel describes changed shape: a set became a
   * parallel ("Make parallel of…", the set is gone) or a parallel's SportLots
   * set became a set ("Promote to set"). `path` is where the result lives,
   * set first; the owner drills the cascade there and parks focus, the same
   * division as `onDeleted` and `onMoved`.
   */
  onReshaped?: (path: ReshapeStep[]) => void;
  /**
   * NEO-496 — the row's marketplace sources (the set builder's
   * `MultiSourcePanel`), drawn inside the open panel only. Attaching a second
   * BSC or SportLots set happens, but it is the exception (Jason, 2026-11-12),
   * so it no longer takes its own card above the panel: it sits behind
   * "Edit attributes" with the rest of the row's settings. The owner decides
   * whether there is one (it has the row the cards are read from); the source
   * panel itself decides which levels it shows on.
   */
  sources?: ReactNode;
}) {
  const row = useQuery(api.selectorOptions.getSelectorOptionById, {
    id: selectorOptionId,
  });
  const chain = useQuery(api.selectorOptions.getAncestorChain, {
    id: selectorOptionId,
  });
  const setSelectorOptionFeature = useMutation(
    api.selectorOptions.setSelectorOptionFeature,
  );
  const setSelectorOptionCardNumberPrefix = useMutation(
    api.selectorOptions.setSelectorOptionCardNumberPrefix,
  );
  const setSelectorOptionListingShortName = useMutation(
    api.selectorOptions.setSelectorOptionListingShortName,
  );
  // NEO-345 — the leaf's autograph format, through its own mutation: a save
  // also carries the format onto the leaf's AU cards (server-side cascade).
  const setAutographFormat = useMutation(api.autographFormat.setAutographFormat);
  const setSelectorOptionSetNamePrefix = useMutation(
    api.brandView.setSelectorOptionSetNamePrefix,
  );
  const setManufacturerSlViaAllBrands = useMutation(
    api.brandView.setManufacturerSlViaAllBrands,
  );
  const setParallelsNameThemselves = useMutation(
    api.selectorOptions.setSelectorOptionParallelsNameThemselves,
  );
  // NEO-619 — "Parallels name themselves" belongs to an insert-role row (an
  // insert under an Insert type, read through `derivedVariantFlags`: the
  // variant type's KIND, never its name) and only means something once a
  // parallel hangs beneath it. The parallels are read with the SAME reference
  // and args (key order included) the set builder's Sub-Variants column
  // subscribes to (`components/modules/SetSelector.tsx`), so the Convex client
  // holds one subscription for both; skipped on every other row.
  const isInsertRoleRow =
    row?.level === "insert" &&
    derivedVariantFlags(
      "insert",
      chain?.find((c) => c.level === "variantType"),
    )?.isInsert === true;
  const parallelRowsBeneath = useQuery(
    api.selectorOptions.getSelectorOptions,
    isInsertRoleRow && row
      ? { level: "parallel", parentId: row._id }
      : "skip",
  );

  // The row's level decides the default (NEO-496: open at the set level). The
  // row may still be loading on the first render; the effect below settles
  // it once the level is known, before the panel draws anything.
  const rowLevel = row?.level;
  /** The open body, for the toggle's `aria-controls`. */
  const bodyId = useId();
  const [expanded, setExpanded] = useState(() =>
    opensByDefault(rowLevel, selectorOptionId, defaultCollapsed),
  );
  // Re-evaluate the default whenever the source intent flips (cards
  // appear/disappear or the selected node changes). Without this, drilling
  // from a card-less set into a node with cards would keep the panel
  // expanded (pushing the list down) because state initializes once. The
  // level is in the key too: it is unknown until the row loads (NEO-496).
  //
  // Settled DURING render (the previous-value pattern), not in an effect:
  // an effect lets the first paint of a newly picked row wear the previous
  // row's open state, so for a frame the set's open panel (NEO-496) sat on
  // the variant picked below it, and a reader checking which toggle is
  // showing could act on the wrong one.
  const openKey = `${selectorOptionId}|${rowLevel ?? ""}|${defaultCollapsed ? 1 : 0}`;
  const [openSettledFor, setOpenSettledFor] = useState(openKey);
  if (openSettledFor !== openKey) {
    setOpenSettledFor(openKey);
    setExpanded(opensByDefault(rowLevel, selectorOptionId, defaultCollapsed));
  }
  /**
   * NEO-528 — the collapsed panel's "Edit attributes" toggle: where focus
   * lands when the bulk control's finished ledger is dismissed with the panel
   * shut (the ledger was all the control drew, so nothing of it is left).
   */
  const expandToggleRef = useRef<HTMLButtonElement | null>(null);
  /**
   * NEO-556 — the Team row itself: where a dismissed No Team run puts focus
   * (the attributes toggle above is the fallback). Refs, never a document
   * query, so a second panel on the page can never take it.
   */
  const teamRowRef = useRef<HTMLDivElement | null>(null);
  // NEO-412 — the panel's two toasts, at most one showing: a confirmation or
  // progress line (`toast`, the polite status region) and a failure
  // (`failure`, the alert region). Raising either clears the other.
  const [toast, setToast] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // NEO-569 — what keeps the panel open. The name field (open or saving) and
  // the delete confirm (open or busy) live inside the collapsible header; shut
  // under them, the typed name, a refusal's reason and the "Deleting…" state
  // would unmount with them. Each control reports here; `setOpen(false)` is a
  // no-op while either holds, and the delete confirm's modal also makes the
  // toggle inert (it is a sibling outside the dialog, reachable by a virtual
  // cursor).
  const [renameHeld, setRenameHeld] = useState(false);
  /** The rename control's handle: where a refused toggle press sends focus. */
  const renameRef = useRef<RenameEntityHandle>(null);
  /**
   * Set when the operator's own press shuts the panel. Shutting unmounts what
   * had focus (the rename pencil the field hands focus to, a field in the
   * body), which drops focus to <body>; the layout effect below parks it on
   * the toggle instead.
   */
  const parkFocusOnToggle = useRef(false);
  useLayoutEffect(() => {
    if (expanded || !parkFocusOnToggle.current) return;
    parkFocusOnToggle.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) {
      expandToggleRef.current?.focus({ preventScroll: true });
    }
  }, [expanded]);
  const [deleteHeld, setDeleteHeld] = useState(false);
  /** NEO-569 — the collapsed toggle's description (the set's team). */
  const teamNoteId = useId();
  // NEO-528 — bumped on every raise and keyed onto the toast's box, so the
  // same sentence raised twice (a second "Saved, every new card gets X") is
  // a new node in the live region and is read again, not a no-op.
  const [toastSeq, setToastSeq] = useState(0);
  // The one pending dismissal. Every toast replaces the one before it, so it
  // also cancels that toast's timer: otherwise "Saving…"'s timer (or an older
  // save's) wipes the "Saved" that followed it.
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // Derive the sport from the ancestor chain so we can drop features that
  // don't apply (e.g. "League" hidden for Pokemon).
  const ancestorSport = useMemo(() => {
    if (!chain) return undefined;
    return chain.find((c) => c.level === "sport")?.value;
  }, [chain]);
  // NEO-277: the sport ROW id, which is what `TeamPicker` scopes its typeahead
  // to and tags a newly-created team with (NEO-96) — never the display name.
  const ancestorSportId = useMemo(() => {
    if (!chain) return undefined;
    return chain.find((c) => c.level === "sport")?._id;
  }, [chain]);

  // NEO-535 — the walker's "Trim Set name in titles" door lands here: the
  // panel opens and the row's box takes focus (`set-name-in-titles-jump`).
  // Counted rather than flagged, so a second trip re-runs the effect. Focused
  // a frame late: the walker closing restores focus to its opener first. A
  // collapsed panel may take a few frames to draw the box, so the look is
  // retried for `SHORT_NAME_FRAMES`; if the box never shows, focus lands on
  // the panel itself rather than staying wherever the walker left it.
  const regionRef = useRef<HTMLDivElement | null>(null);
  const [shortNameTrips, setShortNameTrips] = useState(0);
  const openShortName = useCallback(() => {
    setExpanded(true);
    setShortNameTrips((n) => n + 1);
  }, []);
  useEffect(() => {
    if (shortNameTrips === 0) return;
    let frame = 0;
    let tries = 0;
    const look = () => {
      const region = regionRef.current;
      const field = region?.querySelector<HTMLElement>(
        `[data-feat-key="${SHORT_NAME_FEATURE.key}"]`,
      );
      if (field) {
        field.scrollIntoView({ block: "center" });
        field.focus({ preventScroll: true });
        return;
      }
      tries += 1;
      if (tries < SHORT_NAME_FRAMES) {
        frame = requestAnimationFrame(look);
        return;
      }
      region?.scrollIntoView({ block: "start" });
      region?.focus({ preventScroll: true });
    };
    frame = requestAnimationFrame(look);
    return () => cancelAnimationFrame(frame);
  }, [shortNameTrips]);

  const applicable = useMemo(() => {
    return EXPECTED_FEATURES.filter((f) => {
      if (f.hiddenAtLevels?.includes("set")) return false;
      // NEO-345 — rendered as its own row (`AUTOGRAPH_FORMAT_FEATURE`), saved
      // through `setAutographFormat` so the leaf's AU cards follow it.
      if (f.key === AUTOGRAPH_FORMAT_FEATURE.key) return false;
      // NEO-569 — League is the row's own list of NB leagues (`SetLeagueRow`),
      // never the retired free-text `features.league`.
      if (f.key === "league") return false;
      if (!f.applicableSports) return true;
      if (!ancestorSport) return true;
      return f.applicableSports.includes(ancestorSport);
    });
  }, [ancestorSport]);

  // NEO-569 — the shut panel shows only its title and the toggle, so the set's
  // team reaches a screen reader as the toggle's description instead. The read
  // is skipped while the panel is open (the Team row's own picker says it).
  const collapsedTeamIds =
    !expanded && row && TEAM_LEVELS.has(row.level as Level)
      ? (row.teamIds ?? [])
      : [];
  const collapsedTeamRows = useQuery(
    api.teams.getManyByIds,
    collapsedTeamIds.length > 0 ? { ids: collapsedTeamIds } : "skip",
  );

  if (!row || !chain) return null;

  const leafLevel = row.level as Level;
  // The operator's own open or close. On a set it is remembered for the tab
  // session (`CLOSED_SETS_KEY`); elsewhere the default is collapsed anyway.
  const setOpen = (open: boolean) => {
    // NEO-569: not while a rename or a delete confirm is in flight (see above).
    if (!open && renameHeld) {
      // Refused, and said so: focus goes to the name field, where the reason
      // (or the saving state) is read, not left on the toggle.
      renameRef.current?.focusField();
      return;
    }
    if (!open && deleteHeld) return;
    if (!open) parkFocusOnToggle.current = true;
    setExpanded(open);
    if (leafLevel === "setName") rememberSetClosed(selectorOptionId, !open);
  };
  // NEO-334 — a variant type's title IS its kind (Jason, 2026-10-10): the
  // type titled "Base" is the set's Base. Read once for the header's tag and
  // the delete confirm.
  const isBaseVariantType =
    leafLevel === "variantType" && variantTypeKind(row) === "base";
  // NEO-294 — the year the move picker's brands belong to, named so the list
  // says WHICH year's brands it is offering. Not a memo: it is one find over a
  // chain of at most seven, below the guard that makes `chain` non-null.
  const ancestorYear = chain.find((c) => c.level === "year")?.value;
  const features = row.features ?? {};
  const teamIds: Array<Id<"teams">> = row.teamIds ?? [];
  // NEO-556 — the Team default's third state. A row never stores both (the
  // one writer refuses it); one that somehow did reads as its teams, the
  // server's own rule (`teamDefaultOf`: a value that names a team wins).
  const noTeamDefault = teamIds.length === 0 && row.noTeamDefault !== undefined;
  const showTeamRow = TEAM_LEVELS.has(leafLevel);
  const showCardPrefixRow = showsCardPrefix(leafLevel, row.value);
  const cardNumberPrefix = row.metadata?.cardNumberPrefix;
  // NEO-335/535 — this row's own "Set name in titles", and the description
  // this row's cards get without one, for the field's placeholder.
  const showShortNameRow = showsShortNameRow(leafLevel, row.value);
  const listingShortName = row.metadata?.listingShortName;
  // NEO-619 — shown on an insert-role row with a parallel beneath it. A switch
  // already on stays reachable with none left, so it can always be turned off:
  // a later parallel would otherwise inherit a switch nobody can see.
  const parallelsNameThemselvesOn = row.metadata?.parallelsNameThemselves === true;
  const showParallelsNameThemselves =
    isInsertRoleRow &&
    (parallelsNameThemselvesOn || (parallelRowsBeneath?.length ?? 0) >= 1);
  const titlesDescription = showShortNameRow
    ? setNameInTitlesFor(row, chain, features)
    : undefined;
  // NEO-237: manufacturer rows only, and never the year's Unknown row — that
  // row holds the sets whose brand is NOT known, so a prefix on it is a
  // contradiction, and the server refuses one.
  const showBrandPrefixRow =
    leafLevel === "manufacturer" && !row.metadata?.isBrandUnknown;
  // NEO-294 — Jason, 2026-09-22: "Unknown should not be renamable." Read off
  // the same NB role flag the line above reads, so the panel cannot disagree
  // with itself about which row this is.
  const brandUnknownRow = isBrandUnknownRow(row.metadata);
  const setNamePrefix = row.metadata?.setNamePrefix;
  // NEO-237 — the via-All-Brands toggle's three states, read off the row's
  // SportLots slots and the chain above it. "Is this id the all-brands
  // option" is a marketplace-vocabulary question answered by the adapter
  // boundary's own predicate (`slBrandAxis.ts`, FE-importable on purpose);
  // the toggle is the linkage control, and linkage is the one thing a
  // component may show about a marketplace id.
  const slPrimary = showBrandPrefixRow ? primaryId(row, "sportlots") : undefined;
  const slViaAllBrandsOn = isSlAllBrandsBrandId(slPrimary);
  const slHasOwnBrand = slPrimary !== undefined && !slViaAllBrandsOn;
  // The chain above the row — `getAncestorChain` includes the leaf, and the
  // sync judges a manufacturer against its parents (`EntityColumn`'s
  // `parentChain`, same rule).
  const slReachable =
    showBrandPrefixRow &&
    resolvableSides(chain.slice(0, -1), { level: "manufacturer" }).sportlots
      .resolvable;
  const slViaAllBrandsDisabledReason = slHasOwnBrand
    ? "Linked to a SportLots brand of its own"
    : !slReachable && !slViaAllBrandsOn
      ? "This year has no SportLots link to go through"
      : null;

  // Toggle-pill features (checkbox + toggleOptions) render together in one
  // wrapping row instead of scattered through the 2-column grid at their
  // config-order position.
  const toggleFeatures = applicable.filter(
    (f) => f.inputType === "checkbox" || f.inputType === "toggleOptions",
  );
  const otherFeatures = applicable.filter(
    (f) => f.inputType !== "checkbox" && f.inputType !== "toggleOptions",
  );

  // Breadcrumb: "Attributes for {leaf} ({levelLabel}) — a › b › c".
  const breadcrumb = chain.map((c) => c.value).join(" › ");
  const headerTitle = `Attributes for ${row.value} (${LEVEL_LABEL[leafLevel]})`;
  // NEO-569 — said by the shut toggle, never drawn: "Team: Durham Bulls" (the
  // full names), "Team: No Team", or nothing when the set has no team default.
  const teamNote =
    expanded || !showTeamRow
      ? null
      : teamIds.length > 0
        ? // Only when every id resolved: a partial list reads as the whole.
          collapsedTeamRows && collapsedTeamRows.length === teamIds.length
          ? `Team: ${joinLabels(collapsedTeamRows.map((t) => teamFullName(t)))}`
          : null
        : noTeamDefault
          ? `Team: ${NO_TEAM_TEXT}`
          : null;

  /**
   * Put `message` in the `kind` toast, replacing whatever either toast shows
   * and cancelling its dismissal. `dismissAfterMs` schedules this one's;
   * without it the toast stays until the next one replaces it.
   */
  const raiseToast = (
    kind: "status" | "failure",
    message: string,
    dismissAfterMs?: number,
  ) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = null;
    setToast(kind === "status" ? message : null);
    setFailure(kind === "failure" ? message : null);
    setToastSeq((n) => n + 1);
    if (dismissAfterMs !== undefined) {
      toastTimer.current = setTimeout(() => {
        toastTimer.current = null;
        setToast(null);
        setFailure(null);
      }, dismissAfterMs);
    }
  };

  /**
   * Raise a transient confirmation.
   *
   * Shared by every row below that saves, which is why it is a helper rather
   * than an inline setToast: each caller raising a 6s toast has to agree on
   * the 6s.
   */
  const showToast = (message: string) => raiseToast("status", message, 6000);

  /**
   * NEO-556 — take the confirmation down early, when the operator has moved
   * on to the next step it pointed at (the "Mark N teamless cards" confirm
   * opening under it). A failure stays: it is news still to act on.
   */
  const dismissStatusToast = () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = null;
    setToast(null);
  };

  /**
   * NEO-412 — "Saving {label}…" while a write is in flight. It never dismisses
   * itself: the save's own "Saved"/"Cleared"/"Failed" replaces it, so the
   * panel never says Saved before the server has the value.
   */
  const showSavingToast = (label: string) =>
    raiseToast("status", `Saving ${label}…`);

  /**
   * A failure stays up until the next toast replaces it, as it always has.
   * It goes to the alert region, not the status one: it is news the operator
   * must act on, not a confirmation. Routed through `raiseToast` so an
   * earlier toast's timer cannot wipe it.
   */
  const showFailedToast = (message: string) =>
    raiseToast("failure", `Failed: ${message}`);

  /**
   * NEO-217 — an empty value CLEARS the attribute; it is not a no-op.
   *
   * This used to return early on `""`, which meant nothing set at this level
   * could ever be un-set: a League typed by mistake, or a Season that turned
   * out to belong to the parallel rather than the set, was permanent. The
   * server now removes the key entirely for `""` (never stores an empty
   * string — "attribute gone" has one spelling, absence), so the only thing
   * needed here is to stop swallowing the empty commit and to say which of
   * the two things happened.
   */
  const handleSaveFeature = async (
    key: string,
    label: string,
    value: string,
  ) => {
    const trimmed = value.trim();
    const clearing = trimmed.length === 0;
    // A clear of an already-absent key is the real no-op — `features[key]`
    // is undefined, and `"" === undefined` is false, so it needs saying.
    if (clearing ? features[key] === undefined : features[key] === trimmed) {
      return;
    }
    // NEO-412 — "Saving {label}…" while the write is in flight, and the
    // confirmation only once it has landed: an optimistic "Saved" let a fast
    // operator (and an E2E spec) act on a value the server did not have yet.
    // The mutation is a single-row patch (NEO-71-74), no propagation counts
    // to report. "Saved {label}" is unchanged (E2E asserts it); "Cleared
    // {label}" is deliberately distinct so the toast never claims a value was
    // stored.
    showSavingToast(label);
    try {
      await setSelectorOptionFeature({ selectorOptionId, key, value: trimmed });
      showToast(clearing ? `Cleared ${label}` : `Saved ${label}`);
    } catch (e) {
      // NEVER a raw `.message`. Production redacts a plain Error to "Server
      // Error", and even a surviving message reaches the client wrapped in
      // "[CONVEX M(selectorOptions:setSelectorOptionFeature)] [Request ID: …]"
      // — so the old `Failed: ${e.message}` toast showed an operator either
      // nothing useful or a request id. Only a ConvexError's `data` is text a
      // backend deliberately chose for a person, and `userFacingMessage` is
      // the one place that rule lives.
      showFailedToast(userFacingMessage(e, `Could not save ${label}`));
    }
  };

  /**
   * NEO-291 — the Card prefix row's save. Same shape as `handleSaveFeature`
   * (no-op on an unchanged value, "Saving…" until the write lands,
   * `userFacingMessage` on failure) with its own mutation, because the prefix
   * is `metadata.cardNumberPrefix` rather than a `features` key. The server
   * trims and treats `""` as "remove the key", so the clear/save split here
   * is only for the toast's sake.
   */
  const handleSaveCardNumberPrefix = async (value: string) => {
    const label = "Card prefix";
    const trimmed = value.trim();
    const clearing = trimmed.length === 0;
    if (
      clearing ? cardNumberPrefix === undefined : cardNumberPrefix === trimmed
    ) {
      return;
    }
    showSavingToast(label);
    try {
      await setSelectorOptionCardNumberPrefix({
        id: selectorOptionId,
        cardNumberPrefix: trimmed,
      });
      showToast(clearing ? `Cleared ${label}` : `Saved ${label}`);
    } catch (e) {
      showFailedToast(userFacingMessage(e, `Could not save ${label}`));
    }
  };

  /**
   * NEO-335 — the "Set name in titles" row's save. The card prefix's
   * shape: no-op on an unchanged value, "Saving…" until the write lands, the
   * server's own sentence on a refusal. The server trims, refuses
   * control/invisible characters and anything past 80, and treats `""` as
   * "remove the key". Existing titles are not rewritten; Regenerate reads the
   * new name, which is why "Saved" waits for the server (NEO-412): a
   * Regenerate pressed on an early "Saved" read the old name.
   */
  const handleSaveListingShortName = async (value: string) => {
    const label = SHORT_NAME_FEATURE.label;
    const trimmed = value.trim();
    const clearing = trimmed.length === 0;
    if (clearing ? listingShortName === undefined : listingShortName === trimmed) {
      return;
    }
    showSavingToast(label);
    try {
      await setSelectorOptionListingShortName({
        id: selectorOptionId,
        listingShortName: trimmed,
      });
      showToast(clearing ? `Cleared ${label}` : `Saved ${label}`);
    } catch (e) {
      showFailedToast(userFacingMessage(e, `Could not save ${label}`));
    }
  };

  /**
   * NEO-345 — the "Autograph format" row's save. `handleSaveFeature`'s shape
   * (no-op on an unchanged value, "Saving…" until the write lands, the
   * server's own sentence on a refusal) through `setAutographFormat`, which
   * also carries the format onto the leaf's AU cards. `""` clears the leaf's
   * format and touches no card.
   */
  const handleSaveAutographFormat = async (value: string) => {
    const label = AUTOGRAPH_FORMAT_FEATURE.label;
    const trimmed = value.trim();
    const clearing = trimmed.length === 0;
    const current = features[AUTOGRAPH_FORMAT_FEATURE.key];
    if (clearing ? current === undefined : current === trimmed) return;
    if (!clearing && !(AUTOGRAPH_FORMATS as readonly string[]).includes(trimmed)) return;
    showSavingToast(label);
    try {
      await setAutographFormat({
        selectorOptionId,
        value: trimmed as (typeof AUTOGRAPH_FORMATS)[number] | "",
      });
      showToast(clearing ? `Cleared ${label}` : `Saved ${label}`);
    } catch (e) {
      showFailedToast(userFacingMessage(e, `Could not save ${label}`));
    }
  };

  /**
   * NEO-237 — the Brand row's save. The toast waits for the server, as every
   * row's does since NEO-412, and here the answer carries news: a non-empty
   * save can MOVE prefix-matching sets out of the year's Unknown row, and the
   * count is the one thing worth saying about it ("Saved Brand · 3 sets
   * moved out of Unknown"). A save that moved nothing, and a clear, read like
   * every other row's.
   */
  const handleSaveSetNamePrefix = async (value: string) => {
    const label = "Brand";
    const trimmed = value.trim();
    const clearing = trimmed.length === 0;
    if (clearing ? setNamePrefix === undefined : setNamePrefix === trimmed) {
      return;
    }
    try {
      const { rehomed } = await setSelectorOptionSetNamePrefix({
        id: selectorOptionId,
        setNamePrefix: trimmed,
      });
      showToast(
        clearing
          ? // Not "Cleared Brand": the row's NAME is untouched, and what a
            // clear changes is which sets the brand claims.
            "Cleared — this brand claims no sets by name now"
          : rehomed > 0
            ? `Saved ${label} · ${rehomed} ${rehomed === 1 ? "set" : "sets"} moved out of Unknown`
            : `Saved ${label}`,
      );
    } catch (e) {
      showFailedToast(
        prefixTakenRefusal(e, trimmed) ??
          userFacingMessage(e, `Could not save ${label}`),
      );
    }
  };

  /**
   * NEO-237 — the via-All-Brands toggle's write. The toast waits for the
   * server like the Brand row's does: this one writes (or retires) a
   * marketplace slot, and the confirmation should mean it happened.
   */
  const handleToggleSlViaAllBrands = async (enabled: boolean) => {
    try {
      await setManufacturerSlViaAllBrands({ id: selectorOptionId, enabled });
      showToast(
        enabled
          ? "Linked — SportLots sets match this brand by name now"
          : "Unlinked — SportLots sets no longer match this brand by name",
      );
    } catch (e) {
      showFailedToast(
        slViaAllBrandsRefusal(e) ??
          userFacingMessage(e, "Could not change the SportLots link"),
      );
    }
  };

  /**
   * NEO-619 — the "Parallels name themselves" switch's write. The toast waits
   * for the server like every row's (NEO-412) and says what the switch does
   * not do: it leaves existing titles alone, and Regenerate reads it.
   */
  const handleToggleParallelsNameThemselves = async (on: boolean) => {
    try {
      await setParallelsNameThemselves({ id: selectorOptionId, on });
      showToast(
        on
          ? "Parallels name themselves · Regenerate a card to retitle it"
          : "Parallels carry the insert's name again · Regenerate a card to retitle it",
      );
    } catch (e) {
      showFailedToast(
        userFacingMessage(e, "Could not change how parallels are titled"),
      );
    }
  };

  /**
   * NEO-306 — the levels whose rows can carry a set action (Move, Make
   * parallel of…, Make insert of…, Promote to set). Whether one actually
   * renders is each control's own call; see the "Set actions" row.
   */
  const hasRowActions =
    leafLevel === "setName" ||
    leafLevel === "insert" ||
    leafLevel === "parallel";

  return (
    <div
      // NEO-569: collapsed, the panel is one compact line (its title and the
      // "Edit attributes" toggle), so it takes less padding than the open
      // panel. `space-y-3` stays for a run ledger that is kept on screen.
      className={`border border-rule-strong rounded-lg bg-raised-deep/60 space-y-3 focus-outline ${
        expanded ? "p-4" : "px-4 py-2"
      }`}
      ref={regionRef}
      // NEO-535: the "Trim Set name in titles" jump's fallback focus target;
      // never a Tab stop.
      tabIndex={-1}
      role="region"
      aria-label="Set attributes panel"
    >
      {showShortNameRow && <SetNameInTitlesTarget open={openShortName} />}
      {/* Breadcrumb header (fixes QA #2 — which level/column applies).
          NEO-569 (Jason, 2026-11-17): collapsed, this shows ONLY the title and
          the "Edit attributes" toggle. The rename pencil, the Base tag, the
          delete, the breadcrumb and the Set actions all come back with the
          open panel, in the places they have always sat. */}
      <div
        className={`flex justify-between gap-3 ${expanded ? "items-start" : "items-center"}`}
      >
        <div className="relative min-w-0">
          {/* NEO-569: the collapsed toggle's description. Always mounted (empty
              when there is nothing to say) and `sr-only`: the closed bar shows
              only the title and the toggle. `relative` on this box keeps the
              absolute span from escaping the `truncate` clip (NEO-341). */}
          <span id={teamNoteId} className="sr-only">
            {teamNote}
          </span>
          {/* NEO-96: the rename pencil sits immediately after the title
              because the title IS the name it edits — that adjacency is the
              only thing making it discoverable. The panel scopes itself to the
              deepest current selection at ANY level, so this one control
              renames sports, years, manufacturers, sets and variants alike. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* NEO-499: `min-w-0 wrap-anywhere` (WizardChrome's h2 pattern). A
                set name can be one unbroken token up to the 200-character
                cap; as a flex item the heading's minimum width was that whole
                token, so past about 100 characters it ran off a phone's right
                edge, widened the page and put the page under the reader's
                taps. Now the name breaks wherever it has to. */}
            <h3 className="min-w-0 wrap-anywhere text-sm font-semibold text-ink">
              {headerTitle}
            </h3>
            {expanded && (
              <>
              {/* NEO-239: every level renames, variantType included.
                  NEO-294: with ONE exception — the year's Unknown row, which is
                  frozen at the mutation. The pencil is replaced rather than
                  removed, so the answer to "why can't I rename this one" is
                  where the question gets asked.
                  NEO-334: a variant type's title IS its kind, so renaming one
                  to or from Base / Insert / Parallel changes what it is. The
                  server refuses that while rows sit beneath it, and the pencil
                  says why in its own refusal line under this header. */}
              {brandUnknownRow ? (
                <BrandUnknownRenameNotice value={row.value} />
              ) : (
                <RenameEntityControl
                  ref={renameRef}
                  id={selectorOptionId}
                  currentValue={row.value}
                  onBusyChange={setRenameHeld}
                />
              )}
              {/* NEO-239: which variant type is the set's base is IDENTITY, not
                  an attribute, so it sits with the name rather than in the grid
                  below.
                  NEO-334: the type titled "Base" IS the base (Jason,
                  2026-10-10), so there is nothing to mark: "Mark as base set"
                  and its mutation are gone, and a type becomes the base by
                  being renamed "Base" with the pencil beside this tag. */}
              {isBaseVariantType && <BaseSetTag />}
              {/* NEO-219: the one sanctioned delete, next to the pencil for the
                  same reason the pencil is next to the title — the title IS the
                  row it acts on.
                  NEO-239: this used to be wrapped in `canRenameSelectorRow(row)`,
                  which meant "hide it on a variantType that is not custom". That
                  predicate is gone with the custom concept — a row either carries
                  marketplace ids or it does not, and both behave the same — so
                  the gate is now the control's OWN, and it is a better one: on
                  click it reads `getSelectorOptionHoldings` once (NEO-400: never
                  subscribed, that read is too heavy to re-run on every write)
                  and shows an explained refusal for a row with something below
                  it, or the confirm when the row is genuinely empty. The server's
                  emptiness check still runs independently. Nothing became
                  deletable that the server would not already have let go. */}
              <DeleteSelectorRowControl
                // Keyed on the row: this panel does NOT remount when the
                // selection moves, so without this a dialog opened for one row
                // — or a revealed reason belonging to it — would survive onto
                // the next one and ask its question about the wrong thing.
                key={selectorOptionId}
                id={selectorOptionId}
                row={row}
                level={leafLevel}
                isBase={isBaseVariantType}
                onDeleted={onDeleted}
                onOpenChange={setDeleteHeld}
              />
              </>
            )}
          </div>
          {/* NEO-341: `relative` so this line's `truncate` clips the `sr-only`
              text in it too. Unpositioned, an absolute span took
              binder-layout's wrapper as its containing block, escaped the
              clip at the end of a nowrap run, and widened a 412px page by
              ~50px, sliding the whole page (and the card drawer) sideways on
              a phone.
              NEO-569: open panel only. The team livery (NEO-277) and the No
              Team summary (NEO-556) that used to ride this line while the
              panel was shut are gone with it: the Team row below says both. */}
          {expanded && (
            <p className="relative text-xs text-ink-3 mt-0.5 truncate" title={breadcrumb}>
              {breadcrumb}
            </p>
          )}
        </div>
        {/* NEO-496 (a11y audit): ONE button for both states, so toggling
            keeps focus on it. Two elements swapped under the press and
            dropped focus to <body>. Its name still says what a press does
            ("Edit attributes" / "Hide attributes": specs and copy name
            them), and `aria-expanded` says the state. */}
        <button
          ref={expandToggleRef}
          type="button"
          onClick={() => setOpen(!expanded)}
          // NEO-569: Safari does not focus a button on a click, so an open name
          // field would never blur (and so never commit or cancel) under the
          // press. Take focus on the press, as Chrome does.
          onMouseDown={(e) => {
            if (renameHeld) e.currentTarget.focus();
          }}
          onKeyDown={(e) => activateOnEnter(e, () => setOpen(!expanded))}
          aria-label={expanded ? HIDE_ATTRIBUTES_LABEL : EDIT_ATTRIBUTES_LABEL}
          aria-expanded={expanded}
          // NEO-569: the delete confirm is modal and this button sits outside
          // it; inert keeps a virtual cursor from pressing it under the dialog.
          inert={deleteHeld || undefined}
          // The set's team, said while shut (not drawn). No description when
          // the set has no team default.
          aria-describedby={teamNote ? teamNoteId : undefined}
          // NEO-569: the body is not mounted while collapsed, so there is
          // nothing for `aria-controls` to name until it opens.
          aria-controls={expanded ? bodyId : undefined}
          className={`shrink-0 ${ATTRIBUTES_TOGGLE_CLASS}`}
        >
          {expanded ? `${HIDE_ATTRIBUTES_LABEL} ▴` : `${EDIT_ATTRIBUTES_LABEL} ▾`}
        </button>
      </div>

      {/* NEO-306: the things that can be DONE to this row, as its own row of
          visibly-button chips under the breadcrumb (NEO-569: open panel only) — out of the title line,
          where they were grey text beside the name and did not read as
          controls. The title line keeps what is about the row's identity:
          its name (pencil), whether it is the base (tag) and the delete.

          Rendered only at the levels that can carry an action, and hidden
          while empty (`empty:hidden` — each control renders nothing when the
          server says it does not apply, and JSX leaves no whitespace nodes, so
          an empty row is `:empty` and leaves the accessibility tree with its
          `display: none`). A wrapping flex row, so at the E2E viewport's
          1024px it breaks between chips rather than squeezing them.

          Every control keeps its own `key` prefix: the panel does not remount
          when the selection moves, and two siblings sharing a key is the one
          thing React refuses to reconcile (NEO-279, CI run 34930152576). */}
      {expanded && hasRowActions && (
        <div
          role="group"
          aria-label="Set actions"
          className="flex flex-wrap items-center gap-2 empty:hidden"
        >
          {/* NEO-294: the operator's undo for every automatic placement —
              the prefix re-home, the known-brands list, the sync's own
              bucketing into Unknown. A set filed under the wrong brand is
              the case an operator would otherwise "fix" by deleting and
              rebuilding it. Set level only: a brand is a set's parent, and
              nothing else here has one. First in the row: it is the one
              action every set row carries. */}
          {leafLevel === "setName" && (
            <MoveSetToBrandControl
              key={`move-brand-${selectorOptionId}`}
              setId={selectorOptionId}
              setValue={row.value}
              yearLabel={ancestorYear}
              showToast={showToast}
              onMoved={onMoved}
            />
          )}
          {/* NEO-305: the other things that can happen to a set ROW's
              shape — a SportLots-filed "set" that is really a parallel folds
              into its set, and the way back out. Each renders nothing unless
              the server says it could work here. */}
          {leafLevel === "setName" && (
            <MakeParallelControl
              key={`make-parallel-${selectorOptionId}`}
              setId={selectorOptionId}
              setValue={row.value}
              showToast={showToast}
              onReshaped={onReshaped}
            />
          )}
          {/* NEO-306: "Make insert of…", after Make parallel of…. Offered on
              set rows AND insert-level rows (a SportLots set, or a row the
              Parallels reconcile filed, that is really an insert or a
              parallel of one); its own eligibility query decides. */}
          {(leafLevel === "setName" || leafLevel === "insert") && (
            <MakeInsertControl
              key={`make-insert-${selectorOptionId}`}
              rowId={selectorOptionId}
              rowValue={row.value}
              showToast={showToast}
              onReshaped={onReshaped}
            />
          )}
          {/* NEO-306: the way back from an insert OR a parallel row — a
              parallel of an insert can hold a SportLots link too. The level
              only says where it could apply; the control's eligibility
              query decides whether it does. */}
          {(leafLevel === "insert" || leafLevel === "parallel") && (
            <PromoteToSetControl
              key={`promote-set-${selectorOptionId}`}
              parallelId={selectorOptionId}
              parallelValue={row.value}
              showToast={showToast}
              onReshaped={onReshaped}
            />
          )}
        </div>
      )}

      {/* NEO-47: position the save confirmation FIXED in the viewport, not
          in-flow above the grid. A save made while scrolled down to the
          feature rows would otherwise render the toast off-screen above the
          fold — invisible to the user (and the e2e assertion).

          NEO-239: outside the `expanded` branch, so a confirmation raised
          while the panel is collapsed is still seen. (The header control that
          first needed this, "Mark as base set", went with NEO-334.)

          NEO-412: both regions are always mounted (empty when idle): a live
          region inserted with its text is not reliably announced; a text
          change on a mounted node is. The box is drawn only while there is a
          message. The status region is the panel's one `status`; a failure
          is the separate `alert`, in the negative colour. */}
      {/* NEO-499: the wrapper spans the viewport less a 1rem gutter each side
          (`inset-x-4`) and centres the box in that band, so the box can grow
          to the band's full width and a toast quoting a long unbroken set
          name breaks anywhere inside it on a phone. (A fixed box at
          `left-1/2 -translate-x-1/2` shrink-wraps to half the viewport, so a
          width cap on it never binds.) EntityColumn's toast copies this
          wrapper verbatim; change both together. */}
      <div className="pointer-events-none fixed inset-x-4 top-20 z-50 flex flex-col items-center">
        <div role="status" aria-live="polite" aria-atomic="true" className="max-w-full">
          {toast && (
            <div
              key={toastSeq}
              className="max-w-full wrap-anywhere px-4 py-2 bg-raised-deep border border-neon-green-text/60 rounded text-xs text-neon-green-text shadow-lg">
              {toast}
            </div>
          )}
        </div>
        <div role="alert" aria-atomic="true" className="max-w-full">
          {failure && (
            <div
              key={toastSeq}
              className="max-w-full wrap-anywhere px-4 py-2 bg-raised-deep border border-neon-pink-text/60 rounded text-xs text-neon-pink-text shadow-lg">
              {failure}
            </div>
          )}
        </div>
      </div>

      {expanded && (
        // The body the toggle's `aria-controls` names (NEO-496 a11y).
        <div id={bodyId} className="space-y-3">
          {/* NEO-496: the set's publisher checklist, one file for the whole
              set, at the set level only. First and full width (Jason,
              2026-11-12): the upload is what an operator opens a set to do,
              and the panel opens itself at the set level to offer it. It is
              a source the set's syncs read, not a fact about this row, so
              it sits above the "Set attributes" label, not among them. */}
          {leafLevel === "setName" && (
            <PublishedChecklistPanel
              setId={selectorOptionId}
              setName={row.value}
              setYear={ancestorYear ?? null}
              onStatus={showToast}
            />
          )}

          {/* NEO-496: where this row's cards come from, when it draws on
              marketplace sets (insert, parallel, a terminal variant). Above
              the attributes for the same reason as the checklist: a source,
              not a fact about the row. The two never meet, since the
              checklist lives on the set and the sources below it. */}
          {sources}

          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-3 uppercase tracking-wide">
              Set attributes
            </span>
          </div>

          {/* NEO-277 / NEO-569: League and Team FIRST, outside the grid —
              the position is the information. Every row below is a fact about
              THIS node only (write-once snapshots, no cascade); these two flow
              down to every card. League on the left, Team on the right,
              because the team pickers rank by the leagues (Jason, NEO-569):
              side by side while the panel is wide enough for both, League
              above Team when it is not. flex-wrap on the panel's own width,
              not a viewport breakpoint, since the panel is narrow inside the
              set builder's split view on any screen. Each is keyed on the
              row so a confirm or a save in flight for one set never carries
              over to the next one — the same reason
              `DeleteSelectorRowControl` is keyed. */}
          {showTeamRow && (
            <div className="flex flex-wrap gap-2">
              <div className="flex min-w-0 flex-1 basis-64 flex-col *:flex-1">
                <SetLeagueRow
                  key={`set-league-${selectorOptionId}`}
                  selectorOptionId={selectorOptionId}
                  levelLabel={LEVEL_LABEL[leafLevel]}
                  isSet={leafLevel === "setName"}
                  ancestors={chain}
                  onSaving={showSavingToast}
                  onSaved={showToast}
                  onFailed={showFailedToast}
                />
              </div>
              <div className="flex min-w-0 flex-1 basis-64 flex-col *:flex-1">
                <SetTeamRow
                  key={selectorOptionId}
                  rowRef={teamRowRef}
                  selectorOptionId={selectorOptionId}
                  level={leafLevel}
                  teamIds={teamIds}
                  noTeam={noTeamDefault}
                  teamCascadeStartedAt={row.teamCascadeStartedAt}
                  sportId={ancestorSportId}
                  onSaved={showToast}
                  onFailed={showFailedToast}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* NEO-556 — "Mark N teamless cards No Team": the follow-up to a No
          Team row, directly under the Team row it follows from. Outside the
          `expanded` branch for the reason NEO-528's control below is: a run's
          ledger stays on screen when the panel is collapsed, until it is
          dismissed. Keyed on the row so a count or a finished run never
          carries over to the next one. */}
      {showTeamRow && (
        <NoTeamCardsControl
          key={`no-team-cards-${selectorOptionId}`}
          selectorOptionId={selectorOptionId}
          isNoTeam={noTeamDefault}
          teamCascadeStartedAt={row.teamCascadeStartedAt}
          expanded={expanded}
          // The No Team finish toast has done its job once the Mark confirm
          // opens; it must not sit over the dialog for the rest of its 6s.
          onConfirmOpen={dismissStatusToast}
          onDismissed={() => {
            if (!expanded) {
              expandToggleRef.current?.focus({ preventScroll: true });
              return;
            }
            // This panel's own Team row's toggle; when it is disabled (a save
            // or a cascade in flight) a focus() on it is a no-op that drops
            // focus to <body>, so the panel's attributes toggle takes it.
            const toggle = teamRowRef.current?.querySelector<HTMLButtonElement>(NO_TEAM_TOGGLE_SELECTOR);
            const target = toggle && !toggle.disabled ? toggle : expandToggleRef.current;
            target?.focus({ preventScroll: true });
          }}
        />
      )}

      {/* NEO-528 — "Player on every card": the stored player and cameos every
          new card beneath this row is born with, and the run that brings the
          cards already here along. At EVERY level (a whole year of one
          player's cards is a real thing), under Team and League: it is the
          other attribute here that reaches every card. Outside the
          `expanded` branch so a run's ledger stays on screen when the panel
          is collapsed, until it is dismissed; the control draws its section
          only while expanded. Keyed on the row so a confirm or a finished run
          never carries over to the next one. Its "Saved…" / "Cleared…"
          notes are its own status line, beside its actions, not this panel's
          toast (pinned to the top of the viewport, a screen away on a phone). */}
      <EveryCardPlayerControl
        key={`every-card-player-${selectorOptionId}`}
        variantId={selectorOptionId}
        level={leafLevel}
        rowName={row.value}
        sportId={ancestorSportId}
        expanded={expanded}
        onDismissedCollapsed={() => expandToggleRef.current?.focus({ preventScroll: true })}
      />

      {expanded && (
        <div className="space-y-3">
          {toggleFeatures.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label="Set attribute toggles"
            >
              {toggleFeatures.map((feat) => (
                <SetFeatureRow
                  key={feat.key}
                  feat={feat}
                  value={features[feat.key]}
                  onSave={(v) => handleSaveFeature(feat.key, feat.label, v)}
                />
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {/* NEO-237: first cell on a brand row, for the same reason the
                card prefix is first on a variant row — it is the one fact
                here that decides which SETS are this brand's. */}
            {showBrandPrefixRow && (
              <BrandPrefixRow
                value={setNamePrefix}
                onSave={handleSaveSetNamePrefix}
              />
            )}
            {/* NEO-237: the second cell on a brand row — the SportLots side
                of the same fact. Brand says which sets are this brand's;
                this says whether SportLots is asked for them by that name.
                It is ON from creation (the server links every new brand
                through All Brands when the year can be asked — Jason,
                2026-09-21), so this cell is the ONE place to turn it off. */}
            {showBrandPrefixRow && (
              <SlViaAllBrandsToggle
                key={`sl-via-all-brands-${selectorOptionId}`}
                on={slViaAllBrandsOn}
                disabledReason={slViaAllBrandsDisabledReason}
                onToggle={handleToggleSlViaAllBrands}
              />
            )}
            {/* NEO-291: first cell, because it is the one fact here that
                changes how the cards beneath are NUMBERED — every card in an
                insert wears it — and an operator building a Diamond Kings
                insert meets it before League or Era. Only at the levels
                cards hang from; see `showsCardPrefix`. */}
            {showCardPrefixRow && (
              <CardPrefixRow
                value={cardNumberPrefix}
                onSave={handleSaveCardNumberPrefix}
              />
            )}
            {/* NEO-335: beside the prefix, at the set and the levels cards
                hang from — the other fact here that changes what a new
                card's title says. */}
            {showShortNameRow && (
              <ShortNameRow
                value={listingShortName}
                inherited={titlesDescription}
                onSave={handleSaveListingShortName}
              />
            )}
            {/* NEO-619: an insert's one switch for every parallel beneath it,
                beside the "Set name in titles" it changes the reading of. */}
            {showParallelsNameThemselves && (
              <PressedToggleCell
                key={`parallels-name-themselves-${selectorOptionId}`}
                eyebrow="Titles"
                cellLabel="Set feature Parallel titles"
                text={PARALLELS_NAME_THEMSELVES_TEXT}
                on={parallelsNameThemselvesOn}
                disabledReason={null}
                onToggle={handleToggleParallelsNameThemselves}
              />
            )}
            {/* NEO-345: at the levels cards hang from — how this leaf's
                autographs are signed. Its AU cards take it. */}
            {showCardPrefixRow && (
              <AutographFormatRow
                value={features[AUTOGRAPH_FORMAT_FEATURE.key]}
                onSave={handleSaveAutographFormat}
              />
            )}
            {otherFeatures.map((feat) => (
              <SetFeatureRow
                key={feat.key}
                feat={feat}
                value={features[feat.key]}
                onSave={(v) => handleSaveFeature(feat.key, feat.label, v)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * NEO-335/535 — "Set name in titles", as a row in the Attributes panel: the
 * WHOLE set description a title opens with (year, brand, set, insert,
 * parallel), used as typed. `metadata.listingShortName`, its own mutation,
 * and `CardPrefixRow`'s shape exactly (hydration, clear on empty, the hint in
 * the DOM as the input's description). E2E targets the input as
 * `Value for Set name in titles`; the wrapper is
 * `Set feature Set name in titles`.
 *
 * A row with no value of its own shows, as the placeholder, the description
 * its cards get: the value it inherits (with its insert and parallel names
 * added, `titleChainFacts`), else the builder's own (`setDescriptionForTitles`).
 */
/** Frames the "Set name in titles" jump waits for the box before focusing the panel. */
const SHORT_NAME_FRAMES = 10;

const SHORT_NAME_FEATURE: ExpectedFeature = {
  key: "listingShortName",
  label: "Set name in titles",
  inputType: "text",
  hint: "How titles name this set: year, brand, set, insert, parallel. Only steps in when a title runs long or drops a first name. New cards only.",
};

/**
 * NEO-535 — the description a row's new cards open their titles with when the
 * row has no "Set name in titles" of its own: the nearest ancestor's (as the
 * builder reads the chain), else the builder's own description. `chain` is
 * root first; the row itself may or may not end it.
 */
function setNameInTitlesFor(
  row: { _id: string; level: string; value: string },
  chain: ReadonlyArray<{
    _id: string;
    level: string;
    value: string;
    metadata?: {
      listingShortName?: string;
      parallelsNameThemselves?: boolean;
      isBrandUnknown?: boolean;
    } | null;
  }>,
  features: Record<string, string>,
): string | undefined {
  // The row's own value is what the field shows; the placeholder is what the
  // cards get without it, so the row is read with no value of its own.
  const above = chain.filter((c) => c._id !== row._id).reverse();
  const facts = titleChainFacts([
    { level: row.level, value: row.value },
    ...above.map(asChainRow),
  ]);
  if (facts.listingShortName) return facts.listingShortName;
  const at = (level: string) => chain.find((c) => c.level === level);
  const manufacturer = at("manufacturer");
  const description = setDescriptionForTitles({
    sportValue: at("sport")?.value ?? "",
    setNameValue: at("setName")?.value,
    ...(manufacturer?.metadata?.isBrandUnknown ? { manufacturerBrandUnknown: true } : {}),
    inheritedFeatures: {
      ...(at("year") ? { season: at("year")!.value } : {}),
      ...(manufacturer ? { manufacturer: manufacturer.value } : {}),
      ...features,
    },
    ...facts,
  });
  return description || undefined;
}

function asChainRow(row: {
  level: string;
  value: string;
  metadata?: { listingShortName?: string; parallelsNameThemselves?: boolean } | null;
}) {
  const listingShortName = row.metadata?.listingShortName;
  const parallelsNameThemselves = row.metadata?.parallelsNameThemselves;
  return {
    level: row.level,
    value: row.value,
    ...(listingShortName || parallelsNameThemselves
      ? {
          metadata: {
            ...(listingShortName ? { listingShortName } : {}),
            ...(parallelsNameThemselves ? { parallelsNameThemselves } : {}),
          },
        }
      : {}),
  };
}

/** Registers this panel as where "Set name in titles" lives, while mounted. */
function SetNameInTitlesTarget({ open }: { open: () => void }) {
  useSetNameInTitlesTarget(open);
  return null;
}

function ShortNameRow({
  value,
  inherited,
  onSave,
}: {
  /** The row's stored `metadata.listingShortName`; `undefined` when absent. */
  value: string | undefined;
  /** The description this row's cards get without a value of their own. */
  inherited: string | undefined;
  /** `""` clears. Trimming and validation are the server's. */
  onSave: (value: string) => Promise<unknown>;
}) {
  const label = SHORT_NAME_FEATURE.label;
  const fieldClass = useFieldTestClass();
  const hintId = useId();

  return (
    <label
      className="flex flex-col gap-0.5 p-2 rounded border text-xs border-rule-strong bg-raised-deep/30"
      aria-label={`Set feature ${label}`}
    >
      <span className="flex items-center justify-between text-[10px] uppercase tracking-wide text-ink-3">
        <span
          title={SHORT_NAME_FEATURE.hint}
          className="cursor-help underline decoration-dotted decoration-control"
        >
          {label}
        </span>
      </span>
      <span id={hintId} className="sr-only">
        {SHORT_NAME_FEATURE.hint}
      </span>
      <FeatureValueControl
        feat={SHORT_NAME_FEATURE}
        value={value ?? ""}
        onSave={onSave}
        onEmptyCommit={() => onSave("")}
        ariaLabel={`Value for ${label}`}
        ariaDescribedBy={hintId}
        placeholder={inherited ?? "e.g. Upper Deck Hologram"}
        dataFeatKey={SHORT_NAME_FEATURE.key}
        className={`${fieldClass("short-name")} w-full p-1 border rounded text-xs bg-raised-deep border-rule-strong focus:border-neon-green-text focus-outline`}
      />
    </label>
  );
}

/**
 * NEO-237 — the brand's set-name prefix, as a row in the Attributes panel.
 *
 * `CardPrefixRow`'s shape exactly: a synthetic `ExpectedFeature` carries the
 * label and hint into `FeatureValueControl`, hydration is
 * `useReactiveField`'s (never resync over an unsaved edit), and the save goes
 * through its own mutation. Maestro targets the input as `Value for Brand`;
 * the wrapper is `Set feature Brand`, the same shape as every other row.
 *
 * The label is "Brand", not "Set prefix" (Jason 2026-09-21, decision 4,
 * provisional pending the preview): to an operator the value IS the brand as
 * it appears at the front of a set name, and "prefix" is the mechanism.
 */
const BRAND_PREFIX_FEATURE: ExpectedFeature = {
  key: "setNamePrefix",
  label: "Brand",
  inputType: "text",
  hint: "Sets whose names start with this are this brand's — Choice claims Choice Biloxi Shuckers. Usually the brand name, spelled the way set names spell it.",
};

function BrandPrefixRow({
  value,
  onSave,
}: {
  /** The row's stored `metadata.setNamePrefix`; `undefined` when absent. */
  value: string | undefined;
  /** `""` clears. Trimming and validation are the server's. */
  onSave: (value: string) => Promise<unknown>;
}) {
  const label = BRAND_PREFIX_FEATURE.label;
  const fieldClass = useFieldTestClass();
  const hintId = useId();

  return (
    <label
      className="flex flex-col gap-0.5 p-2 rounded border text-xs border-rule-strong bg-raised-deep/30"
      aria-label={`Set feature ${label}`}
    >
      <span className="flex items-center justify-between text-[10px] uppercase tracking-wide text-ink-3">
        <span
          title={BRAND_PREFIX_FEATURE.hint}
          className="cursor-help underline decoration-dotted decoration-control"
        >
          {label}
        </span>
      </span>
      <span id={hintId} className="sr-only">
        {BRAND_PREFIX_FEATURE.hint}
      </span>
      <FeatureValueControl
        feat={BRAND_PREFIX_FEATURE}
        value={value ?? ""}
        onSave={onSave}
        // Same as the feature rows (NEO-217): without this an emptied field
        // snaps back to the stored prefix on blur. Routing it to `onSave("")`
        // is what makes the prefix clearable.
        onEmptyCommit={() => onSave("")}
        ariaLabel={`Value for ${label}`}
        ariaDescribedBy={hintId}
        placeholder="e.g. Upper Deck"
        dataFeatKey={BRAND_PREFIX_FEATURE.key}
        className={`${fieldClass("brand-prefix")} w-full p-1 border rounded text-xs bg-raised-deep border-rule-strong focus:border-neon-green-text focus-outline`}
      />
    </label>
  );
}

/**
 * The Brand row's structured refusal (security review S2): a sibling brand
 * under the same year already holds this prefix. Read from `data` — the
 * message is redacted on production — and named after the brand that holds
 * it, which is the thing the operator has to go and change.
 */
export function prefixTakenRefusal(e: unknown, prefix: string): string | null {
  if (typeof e !== "object" || e === null) return null;
  const data = (e as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const { code, value } = data as { code?: unknown; value?: unknown };
  if (code !== "PREFIX_TAKEN") return null;
  const holder = typeof value === "string" && value.length > 0 ? value : "another brand";
  return `'${prefix}' is already ${holder}'s Brand — two brands can't claim the same sets. Change it there first.`;
}

/**
 * The via-All-Brands toggle's structured refusals, from `data` for the same
 * reason. The toggle is disabled with the reason before either can fire;
 * these are the backstop for a row that changed under the panel.
 */
export function slViaAllBrandsRefusal(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const data = (e as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const { code, reason } = data as { code?: unknown; reason?: unknown };
  if (code === "SL_LINKED") {
    return typeof reason === "string" && reason.length > 0
      ? reason
      : "Linked to a SportLots brand of its own — that link stays.";
  }
  if (code === "SL_NOT_RESOLVABLE") {
    return "This year has no SportLots link to go through.";
  }
  return null;
}

/**
 * NEO-294 — the rename pencil's twin on the year's Unknown row.
 *
 * Jason, 2026-09-22: "Unknown should not be renamable." The server refuses it
 * at both doors, so the only question left is what the panel does with the
 * affordance that would earn the refusal.
 *
 * It STAYS, unpressable, rather than vanishing. Removing it would spare the
 * refusal and answer nothing: the operator who wants to rename this row still
 * wants to, and a control that is simply absent teaches them nothing about
 * why. The same shape the delete control next door already uses for a row it
 * cannot delete — `aria-disabled` with the reason named, revealed on click,
 * and in the DOM as the button's `aria-describedby` target at all times so a
 * screen reader hears it without the reveal. `aria-disabled`, never native
 * `disabled`: a disabled button is not reachable, and "why is this greyed
 * out" is exactly the question a keyboard user is entitled to ask.
 *
 * The accessible name is unchanged — "Rename {value}" — because it is the
 * same affordance in the same place; what changed is that it says no.
 */
/**
 * NEO-239 / NEO-334 — the base row's tag. Not a control, and deliberately not
 * styled like one: the same 10px tag idiom MultiSourcePanel uses for a slot's
 * facet, which this UI already reads as "a fact about the row". Green rather
 * than that idiom's grey because it is the single most consequential fact a
 * variant type carries: it decides whether the row is terminal and holds the
 * checklist.
 *
 * The panel scopes itself to ONE row, so without the tag "which one is the
 * base?" would need a column hunt. The title says how the role is decided now
 * that there is no button for it.
 */
function BaseSetTag() {
  return (
    <span
      className="shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-neon-green-text/50 text-neon-green-text"
      title="Titled Base, so this type holds the set's base checklist."
    >
      Base set
      {/* The explanation lives in the DOM too: `title` is hover-only and not
          reliably announced. The tag stays non-focusable — it is a fact, not
          a control. */}
      <span className="sr-only">
        , titled Base, so this type holds the set&apos;s base checklist
      </span>
    </span>
  );
}

function BrandUnknownRenameNotice({ value }: { value: string }) {
  const reasonId = useId();
  const [revealed, setRevealed] = useState(false);
  const reveal = () => setRevealed(true);

  return (
    <span className="shrink-0 inline-flex items-center gap-1">
      <button
        type="button"
        aria-label={`Rename ${value}`}
        aria-disabled="true"
        aria-describedby={reasonId}
        onClick={reveal}
        onKeyDown={(event) => activateOnEnter(event, reveal)}
        // min-w-6 min-h-6 and the ring, as the real pencil carries them: a
        // bare 16x16 icon is under WCAG 2.5.8's 24x24 minimum target.
        className="shrink-0 inline-flex items-center justify-center min-w-6 min-h-6 rounded text-ink-3 opacity-50 cursor-not-allowed focus-outline"
      >
        <PencilSquareIcon className="w-4 h-4" aria-hidden="true" />
      </button>
      <span
        id={reasonId}
        className={revealed ? "text-[11px] text-ink-3" : "sr-only"}
      >
        {BRAND_UNKNOWN_RENAME_REFUSAL}
      </span>
    </span>
  );
}

/** The toggle's visible sentence — what a flow asserts and taps. */
export const SL_VIA_ALL_BRANDS_TOGGLE_TEXT =
  "SportLots has no brand for this — match its sets by name";

/**
 * NEO-237 — the brand's SportLots link through All Brands, as a pressed
 * toggle in the Attributes grid, beside Brand.
 *
 * The only control for the link: a new brand gets it without being asked
 * (see `addCustomSelectorOption`), so an operator meets it here already on,
 * and presses it off for a brand that must NOT match SportLots sets by name.
 * Drawn as a box that fills when on, the whole sentence as the target,
 * `aria-pressed` — the column's other yes/no decisions are pressed buttons.
 * Wrapped in the grid's cell chrome with a "SportLots" eyebrow, so the cell
 * reads like its neighbours. When it cannot be pressed the reason is under
 * it in plain text — `aria-disabled` and `aria-describedby`, never native
 * `disabled`, so a keyboard user can reach it and hear why.
 */
function SlViaAllBrandsToggle({
  on,
  disabledReason,
  onToggle,
}: {
  on: boolean;
  /** Non-null: shown, unpressable, with this line under it. */
  disabledReason: string | null;
  onToggle: (enabled: boolean) => Promise<unknown>;
}) {
  return (
    <PressedToggleCell
      eyebrow="SportLots"
      cellLabel="Set feature SportLots link"
      fieldKey="btn-sl-via-all-brands"
      text={SL_VIA_ALL_BRANDS_TOGGLE_TEXT}
      on={on}
      disabledReason={disabledReason}
      onToggle={onToggle}
    />
  );
}

/** NEO-619 — the "Parallels name themselves" switch's visible sentence. */
export const PARALLELS_NAME_THEMSELVES_TEXT = "Parallels name themselves";

/**
 * The Attributes grid's pressed-toggle cell: an eyebrow over one pressed
 * button, the cell chrome its neighbours wear. The via-All-Brands link
 * (NEO-237) and the insert's "Parallels name themselves" (NEO-619) are both
 * this cell, so the two cannot drift apart.
 *
 * `aria-pressed` carries the state; a busy write or a `disabledReason` makes
 * it `aria-disabled` (never native `disabled`, so a keyboard user can reach it
 * and hear why), and the reason is printed under it.
 */
function PressedToggleCell({
  eyebrow,
  cellLabel,
  fieldKey,
  text,
  on,
  disabledReason,
  onToggle,
}: {
  eyebrow: string;
  /** The cell's own `aria-label` (`Set feature …`). */
  cellLabel: string;
  /** Legacy marker-class key for the button; omit it for a new control. */
  fieldKey?: string;
  /** The pressed button's visible sentence, and so its accessible name. */
  text: string;
  on: boolean;
  /** Non-null: shown, unpressable, with this line under it. */
  disabledReason: string | null;
  onToggle: (next: boolean) => Promise<unknown>;
}) {
  const fieldClass = useFieldTestClass();
  const reasonId = useId();
  const [busy, setBusy] = useState(false);
  const unavailable = busy || disabledReason !== null;

  const toggle = async () => {
    if (unavailable) return;
    setBusy(true);
    try {
      await onToggle(!on);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-1 p-2 rounded border text-xs border-rule-strong bg-raised-deep/30"
      aria-label={cellLabel}
    >
      <span className="text-[10px] uppercase tracking-wide text-ink-3">
        {eyebrow}
      </span>
      <button
        type="button"
        className={`${fieldKey ? `${fieldClass(fieldKey)} ` : ""}w-full text-left flex items-start gap-2 p-2 rounded-md border text-xs transition-colors focus-outline ${
          on
            ? "border-neon-green-text bg-neon-green/10 text-ink"
            : // gray-500: the 3:1 boundary tone on this panel's dark surface
              // (gray-600 measures ~2.0:1 against gray-800; -500 clears it).
              "border-control text-ink-2 hover:border-neon-green-text"
        } ${unavailable ? "opacity-60 cursor-not-allowed hover:border-control" : ""}`}
        aria-pressed={on}
        aria-disabled={unavailable || undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        onClick={() => void toggle()}
        onKeyDown={(e) => activateOnEnter(e, () => void toggle(), unavailable)}
      >
        <span
          aria-hidden="true"
          className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border ${
            on ? "border-neon-green-text bg-neon-green" : "border-control"
          }`}
        />
        <span>{text}</span>
      </button>
      {disabledReason && (
        // Next to the control it describes, not only in a tooltip: a
        // disabled control that keeps its reason on hover asks a keyboard
        // user to work it out.
        <span id={reasonId} className="text-[11px] text-ink-3">
          {disabledReason}
        </span>
      )}
    </div>
  );
}

/**
 * NEO-345 — how a leaf's autographs are signed: NB data the operator
 * supplies (no marketplace says), stored as the leaf's
 * `features.autographFormat` and inherited by every card on the leaf that
 * carries "AU". A select with "No value" to clear. The input is
 * `Value for Autograph format`.
 */
const AUTOGRAPH_FORMAT_FEATURE: ExpectedFeature = {
  key: "autographFormat",
  label: "Autograph format",
  inputType: "select",
  options: AUTOGRAPH_FORMATS,
  hint: "How this part's autographs are signed. Its autographed cards take it.",
};

/**
 * NEO-345 — the Autograph format row: `SetFeatureRow`'s select chrome
 * (wrapper `Set feature Autograph format`, select `Value for Autograph
 * format`, the hint as its description), but each option SAYS the same words
 * the wizard's tiles and the checklist prompt say (`AUTOGRAPH_CHOICE_LABEL`)
 * while its value stays the stored one. `FeatureValueControl`'s select can
 * only show the stored value, hence a row of its own.
 *
 * Never native `disabled` while saving (focus would drop to the page);
 * `aria-busy` instead, and the save handler toasts the outcome.
 */
function AutographFormatRow({
  value,
  onSave,
}: {
  value: string | undefined;
  onSave: (value: string) => Promise<unknown>;
}) {
  const label = AUTOGRAPH_FORMAT_FEATURE.label;
  const fieldClass = useFieldTestClass();
  const hintId = useId();
  const [busy, setBusy] = useState(false);
  const selected = (AUTOGRAPH_FORMATS as readonly string[]).includes(value ?? "") ? value! : "";
  const handleChange = async (next: string) => {
    if (next === selected || busy) return;
    setBusy(true);
    try {
      await onSave(next);
    } finally {
      setBusy(false);
    }
  };
  return (
    <label
      className="flex flex-col gap-0.5 p-2 rounded border text-xs border-rule-strong bg-raised-deep/30"
      aria-label={`Set feature ${label}`}
    >
      <span className="flex items-center justify-between text-[10px] uppercase tracking-wide text-ink-3">
        <span
          title={AUTOGRAPH_FORMAT_FEATURE.hint}
          className="cursor-help underline decoration-dotted decoration-control"
        >
          {label}
        </span>
      </span>
      <span id={hintId} className="sr-only">
        {AUTOGRAPH_FORMAT_FEATURE.hint}
      </span>
      <select
        value={selected}
        data-feat-key={AUTOGRAPH_FORMAT_FEATURE.key}
        aria-label={`Value for ${label}`}
        aria-describedby={hintId}
        aria-busy={busy || undefined}
        onChange={(e) => void handleChange(e.target.value)}
        className={`${fieldClass()} w-full p-1 border rounded text-xs bg-raised-deep border-rule-strong focus:border-neon-green-text focus-outline`}
      >
        {/* The house "No value" (NEO-217): selectable, and it clears. */}
        <option value="">No value</option>
        {AUTOGRAPH_FORMATS.map((format) => (
          <option key={format} value={format}>
            {AUTOGRAPH_CHOICE_LABEL[format]}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Editable feature row. Maestro targets `Value for {label}` — DO NOT rename.
 */
function SetFeatureRow({
  feat,
  value,
  onSave,
}: {
  feat: ExpectedFeature;
  value: string | undefined;
  onSave: (value: string) => Promise<unknown>;
}) {
  const label = feat.label;
  // Unique per-field marker class so Maestro's inputText targets THIS field
  // rather than the first input sharing the className (see useFieldTestClass).
  const fieldClass = useFieldTestClass();
  // NEO-291 (a11y): the hint used to ride only on the label's `title`, which
  // is hover-only — a keyboard or screen-reader user never met it. It is now
  // also in the DOM, visually hidden, as the control's `aria-describedby`
  // target; `title` + the dotted underline stay for sighted hover. The id is
  // on the hint span, never the input (see useFieldTestClass on resource-id).
  const hintId = useId();

  // "checkbox" features store "true"/"false" strings in the `features` map
  // (unlike "boolean", which is bound to a real schema column and isn't
  // meaningful at the set level). Unchecked/unset is itself a complete
  // answer, so this never shows the amber "missing" treatment. "toggleOptions"
  // renders the same bare-pill way (no label/box chrome) so it sits
  // indistinguishably in the shared toggle row.
  if (feat.inputType === "checkbox" || feat.inputType === "toggleOptions") {
    return (
      <div
        className="flex flex-row items-center"
        aria-label={`Set feature ${label}`}
      >
        <FeatureValueControl
          feat={feat}
          value={value ?? ""}
          onSave={onSave}
          ariaLabel={`Value for ${label}`}
          dataFeatKey={feat.key}
          className=""
        />
      </div>
    );
  }

  // "boolean" has no typed target at the set level (no set-level isRookie
  // column) and is filtered out via `hiddenAtLevels` before reaching here —
  // this is a defensive fallback, not an expected path.
  if (feat.inputType === "boolean") {
    console.warn(
      `SetFeatureRow: unexpected boolean-type feature "${feat.key}" at set level; rendering read-only.`,
    );
    return (
      <div
        className="flex flex-col gap-0.5 p-2 rounded border text-xs border-rule-strong bg-raised-deep/30"
        aria-label={`Set feature ${label}`}
      >
        <span className="text-[10px] uppercase tracking-wide text-ink-3">
          <span
            title={feat.hint}
            className={
              feat.hint
                ? "cursor-help underline decoration-dotted decoration-control"
                : undefined
            }
          >
            {label}
          </span>
        </span>
        {feat.hint && <span className="sr-only">{feat.hint}</span>}
        <span className="text-ink-2">{value ?? "—"}</span>
      </div>
    );
  }

  return (
    <label
      className="flex flex-col gap-0.5 p-2 rounded border text-xs border-rule-strong bg-raised-deep/30"
      aria-label={`Set feature ${label}`}
    >
      <span className="flex items-center justify-between text-[10px] uppercase tracking-wide text-ink-3">
        <span
          title={feat.hint}
          className={
            feat.hint
              ? "cursor-help underline decoration-dotted decoration-control"
              : undefined
          }
        >
          {label}
        </span>
      </span>
      {feat.hint && (
        <span id={hintId} className="sr-only">
          {feat.hint}
        </span>
      )}
      <FeatureValueControl
        feat={feat}
        value={value ?? ""}
        onSave={onSave}
        // NEO-217: without this, `useReactiveField` treats an empty commit as
        // "revert" and writes the old value straight back into the input — the
        // operator deletes the text, tabs out, and watches it reappear. Routing
        // it to `onSave("")` is what makes a set attribute clearable.
        onEmptyCommit={() => onSave("")}
        ariaLabel={`Value for ${label}`}
        ariaDescribedBy={feat.hint ? hintId : undefined}
        placeholder="—"
        dataFeatKey={feat.key}
        className={`${fieldClass()} w-full p-1 border rounded text-xs bg-raised-deep border-rule-strong focus:border-neon-green-text focus-outline`}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// NEO-277 — Team: the one attribute that flows down
// ---------------------------------------------------------------------------

/**
 * What a save of `teamIds` on this node would change beneath it — the
 * server's `getSelectorOptionTeamCascadePreview` answer.
 *
 * The confirm speaks in CARDS only. `nodesFollowing` is still counted (the
 * descendant rows that will carry the team down to cards created later) but
 * a collector does not think in variant rows, so it is never in a sentence.
 */
type TeamCascadePreview = {
  nodesFollowing: number;
  /** Cards that will get the new team: empty, or equal to this node's current team. */
  cardsFollowing: number;
  /** Every card that stays — the sum of the three reasons below. */
  cardsStaying: number;
  /** …because it carries a team of its own that is neither empty nor this node's. */
  cardsOverridden: number;
  /** …because an operator marked it as having no team. */
  cardsTeamless: number;
  /** …because it holds a team NAME still waiting for review, not a team row. */
  cardsPendingName: number;
  /**
   * Cards set-equal to this node's CURRENT team. Only meaningful for a
   * preview asked with `teamIds: []`: it is what a clear would leave behind.
   */
  cardsCarryingCurrent: number;
  /** Counting stopped early; every count above is a floor, not a total. */
  truncated: boolean;
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** How long a scheduled cascade is believed to still be running. */
const CASCADE_IN_FLIGHT_MS = 10 * 60 * 1000;

/**
 * "28 cards" — or, when the preview stopped counting, "more than 500 cards":
 * the floor is said up front rather than pretending to a total.
 */
function followingCards(preview: TeamCascadePreview): string {
  const cards = plural(preview.cardsFollowing, "card", "cards");
  return preview.truncated ? `more than ${cards}` : cards;
}

/**
 * The staying sentence, split by reason so the operator can tell WHY a card
 * is not following — a card on another team, a card confirmed as having no
 * team, and a card whose typed team name is still in review are three
 * different situations with three different remedies. Only non-zero parts
 * are said; the noun "card(s)" rides on the first part only, the way a
 * person lists them.
 *
 *   "2 cards carry a different team, 1 is marked as having no team,
 *    3 have a team name waiting for review — these will not change."
 */
function stayingSentence(preview: TeamCascadePreview): string {
  type Part = { count: number; lead: [string, string]; follow: [string, string] };
  const all: Part[] = [
    {
      count: preview.cardsOverridden,
      lead: ["card carries a different team", "cards carry a different team"],
      follow: ["carries a different team", "carry a different team"],
    },
    {
      count: preview.cardsTeamless,
      lead: [
        "card is marked as having no team",
        "cards are marked as having no team",
      ],
      follow: ["is marked as having no team", "are marked as having no team"],
    },
    {
      count: preview.cardsPendingName,
      lead: [
        "card has a team name waiting for review",
        "cards have a team name waiting for review",
      ],
      follow: [
        "has a team name waiting for review",
        "have a team name waiting for review",
      ],
    },
  ];
  const parts = all.filter((p) => p.count > 0);
  if (parts.length === 0) return "";
  const phrases = parts.map((p, i) => {
    const [one, many] = i === 0 ? p.lead : p.follow;
    return plural(p.count, one, many);
  });
  return `${phrases.join(", ")} — these will not change.`;
}

/**
 * The apply confirm's title and body, pure so the pluralisation, the split
 * staying sentence and the truncated floor can be pinned in a test without a
 * picker in the way.
 *
 *   title: "Apply Durham Bulls to this set?"
 *   body:  "28 cards under this set will get Durham Bulls. 2 cards carry a
 *           different team — these will not change."
 *
 * The second sentence only appears when something is staying, because "0
 * cards carry a different team" is reassurance nobody asked for. "This set" /
 * "this insert" / … follows the node's level, so the question is about the
 * thing the operator has selected, not a generic set.
 */
export function teamCascadeConfirmCopy({
  teamNames,
  levelLabel,
  preview,
}: {
  teamNames: string;
  levelLabel: string;
  preview: TeamCascadePreview;
}): { title: string; description: string } {
  const noun = levelLabel.toLowerCase();
  const following = followingCards(preview);
  const first = `${following.charAt(0).toUpperCase()}${following.slice(1)} under this ${noun} will get ${teamNames}.`;
  const staying = stayingSentence(preview);
  return {
    title: `Apply ${teamNames} to this ${noun}?`,
    description: staying ? `${first} ${staying}` : first,
  };
}

/**
 * The clear confirm — asked only when cards beneath are set-equal to the
 * team being taken off, because those are the cards an operator who picked
 * the wrong team is about to strand. The body says the way out: a clear
 * touches the node only, but a REPLACEMENT carries those cards along.
 *
 *   title: "Take Durham Bulls off this set?"
 *   body:  "28 cards keep Durham Bulls. Picked the wrong team? Pick the
 *           right one instead and they'll follow."
 */
export function teamClearConfirmCopy({
  teamNames,
  levelLabel,
  cardsCarryingCurrent,
}: {
  teamNames: string;
  levelLabel: string;
  cardsCarryingCurrent: number;
}): { title: string; description: string } {
  const noun = levelLabel.toLowerCase();
  return {
    title: `Take ${teamNames} off this ${noun}?`,
    description: `${plural(cardsCarryingCurrent, "card keeps", "cards keep")} ${teamNames}. Picked the wrong team? Pick the right one instead and they'll follow.`,
  };
}

/**
 * The toast after a confirmed save: "Saved Team · applying to 28 cards".
 * "Applying", present tense, because the cascade is scheduled and chunked
 * server-side and may still be running when this reads — the toast says what
 * was started; "Team applied to cards" says when it finished (see the
 * in-flight handling in `SetTeamRow`).
 */
export function teamSavedToast(preview: TeamCascadePreview | null): string {
  if (!preview || preview.cardsFollowing === 0) {
    return "Saved Team";
  }
  return `Saved Team · applying to ${followingCards(preview)}`;
}

/**
 * NEO-556 — the toast after No Team is saved. "Teamless": a new card whose
 * listing names a team keeps it (invariant 8), so not every new card.
 */
export const NO_TEAM_SAVED_TOAST = "Saved No Team · teamless new cards get it";
/**
 * NEO-556 — the line when a No Team save's cascade finishes. No Team reaches
 * the checklists beneath, never a card, so "Team applied to cards" would
 * claim what did not happen. Names the row's level ("under this set"), the
 * noun its confirm's title uses, rather than a bare "under it".
 */
export function noTeamAppliedToast(levelLabel: string): string {
  return `No Team applied to the checklists under this ${levelLabel.toLowerCase()}`;
}
/** NEO-556 — the toast after No Team is withdrawn (the row goes back to unset). */
export const NO_TEAM_CLEARED_TOAST = "Cleared No Team · cards unchanged";

/**
 * NEO-556 — the confirm before a row becomes No Team, asked only when the
 * answer reaches past the row: checklists beneath that follow it (they were
 * unset, or said what this row said), or cards still carrying the team being
 * replaced. A row with neither is saved straight away.
 *
 * No Team never moves a card that already exists, so the body says what
 * happens to new cards, what follows beneath, what stays, and that the
 * teamless cards already here are the next step (`NoTeamCardsControl`).
 *
 *   title: "Set this set to No Team?"
 *   body:  "New cards with nothing naming a team get No Team. 3 checklists
 *           under this set switch to No Team too. 28 cards keep Durham Bulls. Cards already here
 *           stay as they are; you can mark the teamless ones next."
 */
export function setNoTeamConfirmCopy({
  levelLabel,
  preview,
  currentTeamNames,
}: {
  levelLabel: string;
  preview: Pick<TeamCascadePreview, "nodesFollowing" | "cardsCarryingCurrent">;
  /** The row's team being replaced, when it has one. */
  currentTeamNames: string | null;
}): { title: string; description: string } {
  const noun = levelLabel.toLowerCase();
  const parts = ["New cards with nothing naming a team get No Team."];
  if (preview.nodesFollowing > 0) {
    parts.push(
      `${plural(preview.nodesFollowing, "checklist", "checklists")} under this ${noun} switch${preview.nodesFollowing === 1 ? "es" : ""} to No Team too.`,
    );
  }
  if (preview.cardsCarryingCurrent > 0 && currentTeamNames) {
    parts.push(
      `${plural(preview.cardsCarryingCurrent, "card keeps", "cards keep")} ${currentTeamNames}.`,
    );
  }
  parts.push("Cards already here stay as they are; you can mark the teamless ones next.");
  return { title: `Set this ${noun} to No Team?`, description: parts.join(" ") };
}

/**
 * The picker's accessible description (not shown, NEO-569: label + control
 * only, no always-on helper line). It says the one thing the screen does not,
 * that the save reaches every card beneath the row.
 *
 * NEO-556: with No Team on (stored or pending, as the toggle shows it) it
 * says what that answer does and how to undo it, at every level, rather than
 * offering the choice already made.
 */
export function teamHintCopy(level: Level, noTeam = false): string {
  if (noTeam) {
    return "No Team: new cards with nothing naming a team get it. Pick a team to replace it.";
  }
  return `Every card in this ${LEVEL_LABEL[level].toLowerCase()} gets this team.`;
}

/**
 * The No Team toggle's own accessible description (not shown). Off, it says
 * what pressing does; on, it is the on-state sentence the group already reads.
 */
export function noTeamToggleHintCopy(level: Level, noTeam: boolean): string {
  if (noTeam) return teamHintCopy(level, true);
  return "New cards with nothing naming a team get No Team.";
}

/** Order-insensitive equality: the picker appends, the row stores a set. */
function sameTeamIds(
  a: ReadonlyArray<Id<"teams">>,
  b: ReadonlyArray<Id<"teams">>,
): boolean {
  if (a.length !== b.length) return false;
  const sorted = (xs: ReadonlyArray<Id<"teams">>) =>
    [...(xs as ReadonlyArray<string>)].sort();
  const sa = sorted(a);
  const sb = sorted(b);
  return sa.every((id, i) => id === sb[i]);
}

/**
 * NEO-277 — the set row's picker exposes DIFFERENT accessible names from the
 * card drawer's, the quick-add form's and the attention walker's, because this
 * panel can be expanded while any of those has a picker open beneath it, and
 * neither hides the other. Whole-string rewords, never a suffix: Maestro's
 * `id:` selector is a regex find over the aria-label, so "Add team to set"
 * would make a flow's `id: "Add team"` match both. Each string shares no
 * substring with its default in either direction — pinned in
 * `SetAttributesPanel.test.tsx`, because the failure is silent both ways.
 *
 * `trigger` is also the trigger's VISIBLE text ("+ Add set team"), so it has
 * to read as a button label and not only as a name — SC 2.5.3.
 *
 * Module scope so the object identity is stable across renders and the E2E
 * author has one place to read the real strings from.
 */
export const SET_TEAM_PICKER_LABELS: TeamPickerLabels = {
  root: "Whole-set team",
  trigger: "Add set team",
  search: "Find a team for the set",
  results: "Set team matches",
};

/** The picker trigger inside the row, for parking focus after a decision. */
const PICKER_TRIGGER_SELECTOR = `button[aria-label="${SET_TEAM_PICKER_LABELS.trigger}"]`;
/** NEO-556 — the row's No Team toggle, for parking focus after a No Team decision. */
const NO_TEAM_TOGGLE_SELECTOR = `button[aria-label="${NO_TEAM_LABELS.everyCard}"]`;

/**
 * The Team row.
 *
 * Save flow, the only one in this panel with a question in it:
 *   1. A pick in `TeamPicker` calls `onChange(next)` with the full array.
 *   2. The picker shows `next` at once (`pending`), and two one-shot reads go
 *      out together: the cascade preview for `next`, and the team rows for
 *      their names. Imperative `convex.query` rather than `useQuery`, because
 *      this is a question asked once per pick, not a subscription.
 *   3. Cards follow → `ConfirmDialog` with the count. No card follows (an
 *      empty set, or every card already carries a different team) → save
 *      straight away; a question with only one honest answer is not asked.
 *   4. Confirm → `setSelectorOptionTeams` → "Saved Team · applying to …".
 *      Cancel → `pending` is dropped and the picker reads the row again.
 *
 * Change-team flow — the gesture this row exists for. The picker is
 * append-only, so "Bulls → Mudcats" is × on Bulls then add Mudcats. If the ×
 * saved a clear, the add would then arrive with an EMPTY previous value and
 * every card would silently stay on Bulls. So removing the LAST chip never
 * saves: the row goes into a pending-empty state — the picker shows no chips,
 * the stored value is untouched, and two actions appear beneath: "Clear team"
 * and "Keep {team}". Adding a team from there is the ordinary non-empty path,
 * and because the server's `previous` is still the stored team, the Bulls
 * cards are the ones reported as following. Moving the selection to another
 * row discards the pending state (this component is keyed on the row).
 *
 * Clear flow: "Clear team" asks the preview with `[]`; when cards beneath
 * carry this node's current team it opens a confirm that says they will keep
 * it and how to bring them along instead. Confirm (or nothing to strand) →
 * `[]` is saved, which patches the node only. Removing one chip of a
 * multi-team row is the ordinary non-empty path.
 *
 * In flight: while the row carries a fresh `teamCascadeStartedAt` the cascade
 * is still writing cards beneath it. The picker is disabled and a status line
 * says so; the moment the field clears, "Team applied to cards". The server
 * refuses a save in that window with a `ConvexError`, whose text the failure
 * toast shows as it is.
 *
 * A pick made while an earlier preview is still in flight supersedes it
 * (`seq`): the later answer is the only one the operator can still be asking
 * about.
 *
 * Focus: `ConfirmDialog` returns focus to whatever had it when it opened —
 * which, after a pick, is the picker's popover search box. Opening the dialog
 * blurs the picker, the picker closes its popover, and the box is gone by the
 * time the dialog closes, so the dialog's own restore finds nothing connected.
 * This row parks focus on the picker's "+ Add set team" trigger itself
 * instead: after a confirm or cancel, after a clear, after "Keep", and on
 * entering the pending-empty state (the × that got us there has just
 * unmounted under the operator's finger). Focus never falls to `<body>`.
 */
function SetTeamRow({
  rowRef,
  selectorOptionId,
  level,
  teamIds,
  noTeam,
  teamCascadeStartedAt,
  sportId,
  onSaved,
  onFailed,
}: {
  /** The row's container, shared with the panel (a dismissed run's focus target). */
  rowRef: RefObject<HTMLDivElement | null>;
  selectorOptionId: Id<"selectorOptions">;
  level: Level;
  /** The row's stored value; `[]` when the field is absent. */
  teamIds: Array<Id<"teams">>;
  /** NEO-556 — the row's stored value is No Team (`noTeamDefault`). */
  noTeam: boolean;
  /** Set when a cascade is scheduled, cleared by its last chunk. */
  teamCascadeStartedAt: number | undefined;
  sportId: Id<"selectorOptions"> | undefined;
  onSaved: (message: string) => void;
  onFailed: (message: string) => void;
}) {
  const convex = useConvex();
  const setSelectorOptionTeams = useMutation(
    api.selectorOptions.setSelectorOptionTeams,
  );
  // The stored team's rows, for "Keep Durham Bulls" and the clear confirm.
  // A subscription (not a one-shot) because the label is on screen for as
  // long as the pending-empty state is; Convex dedupes it with the picker's
  // own read of the same ids.
  const storedRows = useQuery(api.teams.getManyByIds, { ids: teamIds });
  const storedNames =
    storedRows && storedRows.length > 0
      ? joinLabels(storedRows.map((t) => teamFullName(t)))
      : null;
  const labelId = useId();
  const hintId = useId();
  const noTeamHintId = useId();
  const seqRef = useRef(0);

  /** The picker's value while a pick is being previewed or saved. */
  const [pending, setPending] = useState<Array<Id<"teams">> | null>(null);
  /**
   * NEO-556 — No Team pressed and being previewed or saved (`true`), or
   * withdrawn on screen (`false`); `null` when the toggle shows what is
   * stored. A pending team pick over a stored No Team shows it off.
   */
  const [pendingNoTeam, setPendingNoTeam] = useState<boolean | null>(null);
  /** The last chip was removed and the operator has not yet said which way. */
  const [pendingEmpty, setPendingEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{
    kind: "apply" | "clear" | "noTeam";
    next: Array<Id<"teams">>;
    preview: TeamCascadePreview | null;
    title: string;
    description: string;
  } | null>(null);

  // --- cascade in flight -------------------------------------------------
  // `now` exists so a fresh timestamp can go stale while this row is mounted
  // (a cascade that died mid-way must not lock the row forever): the effect
  // schedules one re-read at the moment it would cross the line.
  const [now, setNow] = useState(() => Date.now());
  const inFlight =
    teamCascadeStartedAt !== undefined &&
    now - teamCascadeStartedAt < CASCADE_IN_FLIGHT_MS;
  useEffect(() => {
    if (!inFlight || teamCascadeStartedAt === undefined) return;
    const remaining = teamCascadeStartedAt + CASCADE_IN_FLIGHT_MS - Date.now();
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [inFlight, teamCascadeStartedAt]);

  // "Team applied to cards" — said once, when the field the server set at
  // schedule time is cleared by the cascade's last chunk. A stale timestamp
  // expiring is NOT that: nothing finished, the row is merely usable again.
  const prevStartedAtRef = useRef(teamCascadeStartedAt);
  useEffect(() => {
    const prev = prevStartedAtRef.current;
    prevStartedAtRef.current = teamCascadeStartedAt;
    if (prev !== undefined && teamCascadeStartedAt === undefined) {
      // NEO-556: a No Team save's cascade moved checklists, not cards; its
      // finish line says so rather than replacing the No Team toast with a
      // claim about cards.
      onSaved(noTeam ? noTeamAppliedToast(LEVEL_LABEL[level]) : "Team applied to cards");
    }
    // `onSaved` is a fresh closure per parent render; the transition is what
    // this effect is about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamCascadeStartedAt]);

  /**
   * NEO-556 — focus while the row's controls are disabled (a save, or a
   * cascade in flight: a No Team save that moves checklists beneath leaves
   * the row in flight). A focused button that turns disabled drops focus to
   * <body>, and focus() on a disabled one does nothing. So the row itself
   * holds focus meanwhile (a labelled group whose "Applying to cards…" line
   * says why its controls rest), remembering the control it stands in for,
   * and hands focus back to it once the controls are free again.
   */
  const parkedRef = useRef<HTMLButtonElement | null>(null);
  const controlsDisabled = busy || inFlight;
  // Layout effect: before the browser's own focus fixup moves focus off the
  // newly disabled button.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const active = document.activeElement;
    if (controlsDisabled) {
      if (active instanceof HTMLButtonElement && active.disabled && row.contains(active)) {
        parkedRef.current = active;
        row.focus({ preventScroll: true });
      }
      return;
    }
    const parked = parkedRef.current;
    parkedRef.current = null;
    if (active === row && parked?.isConnected && !parked.disabled) parked.focus();
  }, [controlsDisabled, rowRef]);

  /**
   * Park focus on a control in this row after a decision (see above). A
   * request, carried out in an effect after the commit it lands in: that
   * commit also unmounts a closing ConfirmDialog, whose own restore (to the
   * control that opened it, possibly disabled now) runs first, so this word
   * is the last one. A timer raced that unmount.
   */
  const [focusRequest, setFocusRequest] = useState<{ selector: string; seq: number } | null>(null);
  const focusInRow = (selector: string) =>
    setFocusRequest((r) => ({ selector, seq: (r?.seq ?? 0) + 1 }));
  useEffect(() => {
    if (!focusRequest) return;
    const row = rowRef.current;
    if (!row) return;
    const control = row.querySelector<HTMLButtonElement>(focusRequest.selector);
    if (!control) return;
    if (!control.disabled) {
      parkedRef.current = null;
      control.focus();
      return;
    }
    parkedRef.current = control;
    row.focus({ preventScroll: true });
  }, [focusRequest, rowRef]);
  const focusTrigger = () => focusInRow(PICKER_TRIGGER_SELECTOR);
  const focusNoTeamToggle = () => focusInRow(NO_TEAM_TOGGLE_SELECTOR);

  const save = async (
    next: Array<Id<"teams">>,
    preview: TeamCascadePreview | null,
    asNoTeam = false,
  ) => {
    setBusy(true);
    try {
      // Every key written out (never a conditional spread): a renamed server
      // arg must fail to compile. `undefined` is dropped on the wire.
      await setSelectorOptionTeams({
        selectorOptionId,
        teamIds: next,
        noTeam: asNoTeam ? true : undefined,
      });
      onSaved(
        asNoTeam
          ? NO_TEAM_SAVED_TOAST
          : next.length === 0
            ? noTeam
              ? NO_TEAM_CLEARED_TOAST
              : "Cleared Team · cards unchanged"
            : teamSavedToast(preview),
      );
    } catch (e) {
      // Same rule as the feature rows: only a ConvexError's `data` is text a
      // backend chose for a person; anything else is the fallback. The
      // server's "Still applying the last team change…" refusal is one such
      // and reads as it was written.
      onFailed(userFacingMessage(e, "Could not save Team"));
    } finally {
      setBusy(false);
      setPending(null);
      setPendingNoTeam(null);
      setPendingEmpty(false);
    }
  };

  const handleChange = async (next: Array<Id<"teams">>) => {
    if (busy || inFlight) return;
    // NEO-556: a team picked over No Team (stored or pending) replaces it.
    // From a stored No Team the ordinary path below is the right one: the
    // server's preview compares against the stored No Team, so the teamless
    // cards it would fill are the ones reported as following.
    setPendingNoTeam(null);
    if (sameTeamIds(next, teamIds)) {
      // Includes re-adding the stored team from the pending-empty state:
      // that is "Keep", spelled with the picker.
      setPending(null);
      setPendingEmpty(false);
      return;
    }
    const seq = ++seqRef.current;
    setPending(next);

    if (next.length === 0) {
      // Never a save. The stored value stands until the operator says
      // "Clear team", "Keep …", or picks a replacement.
      setPendingEmpty(true);
      focusTrigger();
      return;
    }
    setPendingEmpty(false);

    let preview: TeamCascadePreview;
    let names: string;
    try {
      const [p, rows] = await Promise.all([
        convex.query(api.selectorOptions.getSelectorOptionTeamCascadePreview, {
          selectorOptionId,
          teamIds: next,
        }),
        convex.query(api.teams.getManyByIds, { ids: next }),
      ]);
      preview = p;
      names = joinLabels(rows.map((t) => teamFullName(t)));
    } catch (e) {
      if (seq !== seqRef.current) return;
      setPending(null);
      onFailed(userFacingMessage(e, "Could not save Team"));
      return;
    }
    // A later pick has taken over; this answer is about a value the picker
    // no longer shows.
    if (seq !== seqRef.current) return;

    if (preview.cardsFollowing === 0) {
      await save(next, preview);
      return;
    }
    setConfirm({
      kind: "apply",
      next,
      preview,
      ...teamCascadeConfirmCopy({
        teamNames: names,
        levelLabel: LEVEL_LABEL[level],
        preview,
      }),
    });
  };

  /**
   * NEO-556 — the No Team toggle. Pressed: preview the row as No Team, and
   * ask only when the answer reaches past the row (`setNoTeamConfirmCopy`).
   * Withdrawn from a stored No Team: saved straight away as a clear, which
   * patches the row only, like clearing a team (rows beneath and cards keep
   * what they have). Withdrawn from a pending No Team: the picker reads the
   * row again.
   */
  const handleNoTeam = async (next: boolean) => {
    if (busy || inFlight) return;
    const seq = ++seqRef.current;
    setPendingEmpty(false);
    if (!next) {
      setPending(null);
      if (!noTeam) {
        setPendingNoTeam(null);
        return;
      }
      setPendingNoTeam(false);
      await save([], null);
      focusNoTeamToggle();
      return;
    }
    if (noTeam) {
      setPending(null);
      setPendingNoTeam(null);
      return;
    }
    setPending([]);
    setPendingNoTeam(true);
    let preview: TeamCascadePreview;
    try {
      preview = await convex.query(
        api.selectorOptions.getSelectorOptionTeamCascadePreview,
        { selectorOptionId, teamIds: [], noTeam: true },
      );
    } catch (e) {
      if (seq !== seqRef.current) return;
      setPending(null);
      setPendingNoTeam(null);
      onFailed(userFacingMessage(e, "Could not save Team"));
      return;
    }
    if (seq !== seqRef.current) return;
    if (preview.nodesFollowing === 0 && preview.cardsCarryingCurrent === 0) {
      await save([], preview, true);
      focusNoTeamToggle();
      return;
    }
    setConfirm({
      kind: "noTeam",
      next: [],
      preview,
      ...setNoTeamConfirmCopy({
        levelLabel: LEVEL_LABEL[level],
        preview,
        currentTeamNames: storedNames,
      }),
    });
  };

  const handleClear = async () => {
    if (busy || inFlight) return;
    const seq = ++seqRef.current;
    setBusy(true);
    let preview: TeamCascadePreview;
    try {
      preview = await convex.query(
        api.selectorOptions.getSelectorOptionTeamCascadePreview,
        { selectorOptionId, teamIds: [] },
      );
    } catch (e) {
      setBusy(false);
      if (seq !== seqRef.current) return;
      onFailed(userFacingMessage(e, "Could not save Team"));
      return;
    }
    if (seq !== seqRef.current) {
      setBusy(false);
      return;
    }
    if (preview.cardsCarryingCurrent === 0) {
      await save([], null);
      focusTrigger();
      return;
    }
    setBusy(false);
    setConfirm({
      kind: "clear",
      next: [],
      preview,
      ...teamClearConfirmCopy({
        teamNames: storedNames ?? "the team",
        levelLabel: LEVEL_LABEL[level],
        cardsCarryingCurrent: preview.cardsCarryingCurrent,
      }),
    });
  };

  const handleKeep = () => {
    if (busy) return;
    seqRef.current++;
    setPending(null);
    setPendingEmpty(false);
    focusTrigger();
  };

  const showPendingActions = pendingEmpty && !inFlight;
  // What the No Team toggle shows: a pending team pick over a stored No Team
  // shows it off; a pending No Team shows it on. The hint follows it.
  const noTeamShown = inFlight
    ? noTeam
    : (pendingNoTeam ?? (pending !== null && pending.length > 0 ? false : noTeam));

  return (
    <div
      ref={rowRef}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={hintId}
      // Focusable by script only: where focus rests while the row's controls
      // are disabled (`focusInRow`).
      tabIndex={-1}
      className="flex flex-col gap-1 p-2 rounded border text-xs border-rule-strong bg-raised-deep/30 focus-outline"
    >
      <span
        id={labelId}
        className="text-[10px] uppercase tracking-wide text-ink-3"
      >
        Team
      </span>
      <TeamPicker
        value={inFlight ? teamIds : (pending ?? teamIds)}
        onChange={(next) => void handleChange(next)}
        noTeam={{
          value: noTeamShown,
          onChange: (next) => void handleNoTeam(next),
          label: NO_TEAM_LABELS.everyCard,
          describedBy: noTeamHintId,
        }}
        sportId={sportId}
        disabled={busy || inFlight}
        labels={SET_TEAM_PICKER_LABELS}
        ariaDescribedBy={hintId}
        // NEO-331: the row being edited is the set context — its league and
        // year order the candidates.
        contextOptionId={selectorOptionId}
      />
      {inFlight && (
        // Next to the control it describes, not only in the toast: this is
        // the state the operator will find the row in after a save, and a
        // disabled picker with no sentence beside it is a question.
        <p role="status" className="text-[10px] text-neon-green-text">
          Applying to cards…
        </p>
      )}
      {showPendingActions && (
        // The two honest answers to "the chip is gone — now what?". Text
        // buttons in the panel's own weight, the clear in the pink every
        // remove in this app wears on hover, the keep in the green every
        // affirm wears — the colour says which way each one leans before the
        // word is read. Neither is a default: reflexive Enter here does
        // nothing, because focus went to the trigger.
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleClear()}
            disabled={busy}
            className="text-[11px] text-ink-2 underline decoration-dotted underline-offset-2 hover:text-neon-pink-text focus:text-neon-pink-text focus-outline disabled:opacity-50"
          >
            Clear team
          </button>
          <button
            type="button"
            onClick={handleKeep}
            disabled={busy}
            className="text-[11px] text-ink-2 underline decoration-dotted underline-offset-2 hover:text-neon-green-text focus:text-neon-green-text focus-outline disabled:opacity-50"
          >
            Keep {storedNames ?? "current team"}
          </button>
        </div>
      )}
      {/* NEO-569 (Jason: "too much text on the screen"): no visible hint.
          What the screen does not show is that the save reaches every card
          beneath the row, so a reader hears that one sentence and nothing
          more (with No Team on, the sentence for that answer). The confirm
          dialog says how many cards before any change lands. */}
      <span id={hintId} className="sr-only">
        {teamHintCopy(level, noTeamShown)}
      </span>
      {/* The No Team toggle's own description: the sentence above says what a
          picked team reaches, which misdescribes the toggle while it is off. */}
      <span id={noTeamHintId} className="sr-only">
        {noTeamToggleHintCopy(level, noTeamShown)}
      </span>
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          description={confirm.description}
          confirmLabel={
            confirm.kind === "clear"
              ? "Yes, clear"
              : confirm.kind === "noTeam"
                ? "Yes, set No Team"
                : "Yes, apply"
          }
          busyLabel={
            confirm.kind === "clear"
              ? "Clearing…"
              : confirm.kind === "noTeam"
                ? "Saving…"
                : "Applying…"
          }
          // Only a clear takes something away (pink yes, cyan Cancel). An
          // apply or a No Team adds an answer: the green yes beside a pink
          // Cancel, the same pair NoTeamCardsControl's confirm shows.
          confirmVariant={confirm.kind === "clear" ? "negative" : "primary"}
          busy={busy}
          onConfirm={() => {
            if (busy) return;
            const { next, preview, kind } = confirm;
            void save(next, preview, kind === "noTeam").finally(() => {
              setConfirm(null);
              if (kind === "noTeam") focusNoTeamToggle();
              else focusTrigger();
            });
          }}
          onCancel={() => {
            if (busy) return;
            setConfirm(null);
            if (confirm.kind === "clear") {
              // Still pending-empty; the dialog hands focus back to the
              // "Clear team" button it opened from, which is still here.
              return;
            }
            setPending(null);
            setPendingNoTeam(null);
            if (confirm.kind === "noTeam") focusNoTeamToggle();
            else focusTrigger();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NEO-219 — the one sanctioned delete
// ---------------------------------------------------------------------------

/**
 * "Sets are fixed, never deleted" holds, with ONE exception agreed 2026-09-03:
 * a row with nothing below it — no child rows, no cards anywhere in its
 * subtree, no cross-listings, and at sport level no players/teams/leagues —
 * may be removed. That is the whole rule, and it is checked SERVER-side; this
 * control only mirrors it so the operator is not offered an action that will
 * be refused.
 *
 * Two states, both stated in words rather than colour:
 *   • holdings exist → the button is `aria-disabled` and names what is below
 *     it ("Holds 3 sets and 220 cards — delete what is below it first").
 *     Clicking reveals that sentence visually, because "why is this greyed
 *     out?" is the question a disabled control always raises and a permanent
 *     line of it under every row in the Set Builder is noise. The sentence is
 *     in the DOM at all times as the button's `aria-describedby` target, so a
 *     screen reader hears the reason without the reveal.
 *   • nothing below it → a ConfirmDialog, Cancel-focused (decision 3), which
 *     additionally says the row may come back if it carries a marketplace id:
 *     an empty SYNCED row deleted today is re-inserted by the next Sync Sets,
 *     which is harmless but surprising if unannounced.
 *
 * A `SELECTOR_ROW_NOT_EMPTY` refusal is a real race, not a bug: the holdings
 * query and the click are separated by however long the operator read the
 * dialog. It renders the server's own `holds` inside the dialog rather than
 * closing, so the answer arrives where the question was asked.
 */

/** One thing standing in the way of a delete, as the server reports it. */
type SelectorHolding = {
  kind: string;
  count: number;
  /**
   * On `kind: "rows"`, the level of the children being counted — OMITTED when
   * they are mixed (a variantType holding both inserts and parallels). Absent
   * therefore means "no single right noun exists", not "look it up": deriving
   * one from the parent's level would confidently name the wrong thing in
   * exactly the case the server declined to name.
   */
  level?: SelectorLevel;
  examples?: string[];
};

type SelectorHoldings = {
  holds: SelectorHolding[];
  /** `refusesValueRename` on the server — a structural row, never deletable. */
  protected: boolean;
};

/**
 * Singular/plural nouns for every non-row holding kind that is a COUNT NOUN —
 * i.e. every kind whose remedy is the sentence's own "delete what is below it
 * first". `review` deliberately has no entry here; see `reviewClause`.
 */
const HOLD_NOUN: Record<string, readonly [string, string]> = {
  cards: ["card", "cards"],
  crossListings: ["cross-listing", "cross-listings"],
  "cross-listings": ["cross-listing", "cross-listings"],
  players: ["player", "players"],
  teams: ["team", "teams"],
  leagues: ["league", "leagues"],
};

function holdPhrase(hold: SelectorHolding): string {
  if (hold.kind === "rows") {
    // No level means the children are MIXED (inserts and parallels under one
    // variantType), so there is no single right noun. "3 rows" is the honest
    // answer; deriving one from the parent would name the wrong thing in
    // precisely the case the server declined to name.
    return hold.level
      ? `${hold.count} ${levelNoun(hold.level, hold.count)}`
      : `${hold.count} ${hold.count === 1 ? "row" : "rows"}`;
  }
  const noun = HOLD_NOUN[hold.kind];
  if (!noun) return `${hold.count} ${hold.kind}`;
  return `${hold.count} ${hold.count === 1 ? noun[0] : noun[1]}`;
}

/**
 * An in-flight checklist review on this row.
 *
 * NOT a `HOLD_NOUN` entry, because it is not the same kind of statement as the
 * others. "Holds 1 checklist review — delete what is below it first" would give
 * the operator the wrong instruction: a review is not a thing below the row
 * waiting to be deleted, it is work in progress on the row itself, and the way
 * out is to finish or cancel it. So it gets its own clause with its own remedy.
 */
function reviewClause(count: number): string {
  return count === 1
    ? "a checklist review is in progress here — finish or cancel it first"
    : `${count} checklist reviews are in progress here — finish or cancel them first`;
}

/**
 * "Holds 3 sets and 220 cards — delete what is below it first."
 *
 * Exported shape shared by the disabled reason and the server's refusal, so
 * the operator reads the same sentence whichever side produced it.
 *
 * Two clauses at most, because there are two different remedies: everything
 * countable below the row is deleted, and an in-flight review is finished or
 * cancelled. Both can be true at once, so both are said.
 */
export function selectorHoldsMessage(
  holds: readonly SelectorHolding[],
): string {
  const present = holds.filter((h) => h.count > 0);
  const countable = present.filter((h) => h.kind !== "review");
  const reviewCount = present
    .filter((h) => h.kind === "review")
    .reduce((total, h) => total + h.count, 0);

  const clauses: string[] = [];
  if (countable.length > 0) {
    clauses.push(
      `Holds ${joinLabels(countable.map(holdPhrase))} — delete what is below it first`,
    );
  }
  if (reviewCount > 0) {
    const clause = reviewClause(reviewCount);
    // Leading clause starts a sentence; a trailing one continues one.
    clauses.push(
      clauses.length === 0
        ? clause.charAt(0).toUpperCase() + clause.slice(1)
        : clause,
    );
  }
  return clauses.join("; ");
}

/**
 * The server's delete refusals, matched STRUCTURALLY rather than with
 * `instanceof ConvexError` — same reasoning as RenameEntityControl's
 * `refusalMessage`: a mocked or rethrown error in a test, or a version skew in
 * the convex client, must still surface the server's own answer.
 */
function deleteRefusalMessage(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const data = (e as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const { code, holds, message } = data as {
    code?: unknown;
    holds?: unknown;
    message?: unknown;
  };
  if (code === "SELECTOR_ROW_NOT_EMPTY") {
    const list = Array.isArray(holds) ? (holds as SelectorHolding[]) : [];
    return (
      selectorHoldsMessage(list) ||
      "Something is below it now — it can't be deleted."
    );
  }
  if (code === "SELECTOR_ROW_PROTECTED") {
    return typeof message === "string" && message.length > 0
      ? message
      : "This row can't be deleted.";
  }
  return null;
}

function DeleteSelectorRowControl({
  id,
  row,
  level,
  isBase = false,
  onDeleted,
  onOpenChange,
}: {
  id: Id<"selectorOptions">;
  row: Pick<SlotBearingRow, "platformData"> & { value: string };
  level: SelectorLevel;
  /**
   * NEO-306 — the row is the set's base. The role and the row are one thing,
   * so deleting this row is how a set loses its base, and the confirm says so.
   * Same control, same emptiness check, same refusal as any other row.
   */
  isBase?: boolean;
  onDeleted?: (level: SelectorLevel) => void;
  /**
   * NEO-569 — told `true` while the confirm is open (busy included) and
   * `false` when it is not (and on unmount). The panel stays open and makes
   * its toggle inert meanwhile.
   */
  onOpenChange?: (open: boolean) => void;
}) {
  // NEO-400: the holdings are read ONCE, on click, never subscribed. The
  // subscribed form re-read every row and card below the selection on every
  // write to the set (thousands of documents, over a hundred re-runs while
  // the wizard added cards), and because the Convex client releases a
  // mutation's promise only when the next Transition arrives, every save in
  // the tab waited for it. Deleting is the rare act here (NEO-219), so the
  // cost belongs on the click. The server re-checks in its own transaction
  // regardless (`SELECTOR_ROW_NOT_EMPTY`), so this read is only the answer
  // the operator sees before the dialog, not the gate.
  const convex = useConvex();
  const deleteSelectorOption = useMutation(
    api.selectorOptions.deleteSelectorOption,
  );

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The one-shot check is in flight. */
  const [checking, setChecking] = useState(false);
  /** What the last check said is below the row; "" means nothing. */
  const [reason, setReason] = useState<string | null>(null);
  /** The check itself failed — not a refusal, so the control stays live. */
  const [checkError, setCheckError] = useState<string | null>(null);
  const reasonId = useId();

  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });
  useEffect(() => {
    onOpenChangeRef.current?.(open);
  }, [open]);
  useEffect(() => () => onOpenChangeRef.current?.(false), []);

  const blocked = reason !== null && reason.length > 0;

  const linkedSides = ALL_SIDES.filter(
    (side) => slotIds(row, side).length > 0,
  ).map((side) => SIDE_LABEL[side]);

  const description =
    "Nothing is below it. This cannot be undone." +
    (isBase
      ? " The set will have no base set until you rename a type to Base."
      : "") +
    (linkedSides.length > 0
      ? ` It is linked to ${joinLabels(
          linkedSides,
        )}; the next sync may add it back.`
      : "");

  const handleClick = async () => {
    if (checking || busy) return;
    setChecking(true);
    setError(null);
    setCheckError(null);
    try {
      const holdings: SelectorHoldings = await convex.query(
        api.selectorOptions.getSelectorOptionHoldings,
        { id },
      );
      const next = selectorHoldsMessage(holdings.holds);
      setReason(next);
      if (next.length === 0) setOpen(true);
    } catch (e) {
      // The check failing is not a refusal; say what happened and leave the
      // control alone so the next click tries again. Only a ConvexError's own
      // text is for a person (`userFacingMessage`); anything else is the
      // fallback, never a request id.
      setReason(null);
      setCheckError(
        userFacingMessage(e, "Couldn't check what is below it — try again."),
      );
    } finally {
      setChecking(false);
    }
  };

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSelectorOption({ id });
      setOpen(false);
      onDeleted?.(level);
    } catch (e) {
      setError(
        deleteRefusalMessage(e) ??
          (e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        // aria-disabled, not `disabled`: the reason is the whole point of the
        // control in this state, and a natively disabled button cannot be
        // focused to hear it. A second click re-checks, so a row emptied in
        // the meantime becomes deletable without leaving it.
        aria-disabled={blocked || undefined}
        aria-busy={checking || undefined}
        aria-describedby={blocked || checking ? reasonId : undefined}
        aria-label={`Delete ${row.value}`}
        title={`Delete ${row.value}`}
        // min-w-6 min-h-6: a bare 16x16 icon is under WCAG 2.5.8's 24x24
        // minimum target. NEO-306: the panel's one focus ring, and otherwise
        // as low-key as it was — a grey icon, pink only on hover — because
        // deleting is the rare act here (NEO-219), and a chip would advertise
        // it beside every name.
        className="shrink-0 inline-flex items-center justify-center min-w-6 min-h-6 rounded text-ink-3 hover:text-neon-pink-text focus-outline aria-disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:hover:text-ink-3"
      >
        <TrashIcon className="w-4 h-4" aria-hidden="true" />
      </button>
      {/* Always mounted (empty when idle): a live region inserted with its
          text is not reliably announced; a text change on a mounted node is.
          Routine states (checking, the reason) are `status`; a failed check is
          the separate `alert` below, because it is not a refusal. */}
      <span
        id={reasonId}
        // aria-live rather than role="status": the panel's own save toast is
        // its one `status` landmark, and this node must not become a second.
        aria-live="polite"
        aria-atomic="true"
        className={
          blocked || checking ? "w-full text-[10px] text-ink-3" : "sr-only"
        }
      >
        {checking ? "Checking what is below it…" : blocked ? reason : ""}
      </span>
      {checkError && (
        <span role="alert" className="w-full text-[10px] text-neon-pink-text">
          {checkError}
        </span>
      )}
      {open && (
        <ConfirmDialog
          title={
            isBase
              ? `Delete base set "${row.value}"?`
              : `Delete ${LEVEL_SINGULAR[level]} "${row.value}"?`
          }
          description={description}
          confirmLabel="Yes, delete"
          busyLabel="Deleting…"
          busy={busy}
          error={error}
          onConfirm={() => void handleConfirm()}
          onCancel={() => {
            if (busy) return;
            setError(null);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
