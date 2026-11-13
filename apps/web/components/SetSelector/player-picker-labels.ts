/**
 * Every accessible name (and the few visible strings) a `PlayerPicker`
 * instance can be given, and the named sets the screens use.
 *
 * A pure module on purpose: component tests mock `./PlayerPicker` with only a
 * `default` export, so a constant exported from the component file would be
 * `undefined` in every test that renders one of its callers.
 *
 * ## The rule every set below keeps
 *
 * Each string shares NO case-insensitive substring with the default it
 * replaces, in either direction, and none with any other set that can be on
 * the same page. Playwright's `name:` and `getByLabel` match a substring by
 * default, so a label that merely CONTAINS another ("Remove player X from
 * also pictured") would make a spec's `Remove player X` find two elements.
 * Reworded whole, never suffixed. Pinned in `PlayerPicker.test.tsx`
 * (NEO-220 for the container labels, NEO-528 for the rest).
 */

export type PlayerPickerLabels = {
  /** The chip row's own name. Default "Player picker". */
  root: string;
  /** The "+ Add player" trigger's accessible name. Default "Add player". */
  trigger: string;
  /** The popover's search input. Default "Search players". */
  search: string;
  /** The popover listbox. Default "Player typeahead results". */
  results: string;
  /**
   * NEO-528 — the trigger's VISIBLE text, drawn after a "+". Default "Add
   * player". Keep it inside `trigger` (SC 2.5.3, label in name).
   */
  triggerText?: string;
  /** NEO-528 — the search box's placeholder. Default "Search or add a player...". */
  placeholder?: string;
  /** NEO-528 — the line under an empty search box. Default "Type a player name…". */
  emptyHint?: string;
  /** NEO-528 — a chip's name. Default `Player: <name>`. */
  chip?: (name: string) => string;
  /** NEO-528 — a chip's × button. Default `Remove player <name>`. */
  remove?: (name: string) => string;
  /** NEO-528 — a typeahead row (and a fragment-panel pick). Default `Add <name>`. */
  option?: (name: string) => string;
  /** NEO-528 — the "+ Create" row. Default `Create player <typed>`. */
  create?: (typed: string) => string;
  /** NEO-528 — the popover's sport switch. Default "Sport to search for players". */
  sportSwitch?: string;
};

/** Every field filled: what a picker given no `labels` renders. */
export type ResolvedPlayerPickerLabels = Required<PlayerPickerLabels>;

export const DEFAULT_PLAYER_PICKER_LABELS: ResolvedPlayerPickerLabels = {
  root: "Player picker",
  trigger: "Add player",
  search: "Search players",
  results: "Player typeahead results",
  triggerText: "Add player",
  placeholder: "Search or add a player...",
  emptyHint: "Type a player name…",
  chip: (name) => `Player: ${name}`,
  remove: (name) => `Remove player ${name}`,
  option: (name) => `Add ${name}`,
  create: (typed) => `Create player ${typed}`,
  sportSwitch: "Sport to search for players",
};

/** A partial set, with every field it leaves out taken from the defaults. */
export function resolvePlayerPickerLabels(
  labels: PlayerPickerLabels | undefined,
): ResolvedPlayerPickerLabels {
  if (!labels) return DEFAULT_PLAYER_PICKER_LABELS;
  return { ...DEFAULT_PLAYER_PICKER_LABELS, ...labels };
}

/**
 * NEO-528 — the card drawer's second picker, "Also pictured": players on the
 * card who are not its subject. Mounted right under the drawer's own
 * default-labelled Players picker, so every field is reworded.
 */
export const ALSO_PICTURED_PICKER_LABELS: ResolvedPlayerPickerLabels = {
  root: "Also pictured on this card",
  trigger: "Add someone also pictured",
  search: "Find someone also pictured",
  results: "Also-pictured matches",
  triggerText: "Add someone",
  placeholder: "Who else is in the shot?",
  emptyHint: "Type a name…",
  chip: (name) => `Also pictured: ${name}`,
  remove: (name) => `Take ${name} off also pictured`,
  option: (name) => `Include ${name}`,
  create: (typed) => `Create and include ${typed}`,
  sportSwitch: "Sport for the also-pictured search",
};

/**
 * NEO-528 — the Attributes panel's bulk control: ONE player to add to (or
 * take off) every card of a checklist and its parallels. On the Set Builder
 * page beside the quick-add form's picker, with the card drawer able to open
 * over both, so it is worded apart from the defaults, the drawer's
 * also-pictured picker and the quick-add set alike.
 */
export const BULK_ALSO_PICTURED_PICKER_LABELS: ResolvedPlayerPickerLabels = {
  root: "Whole-checklist cameo",
  trigger: "Choose who to change on every card",
  search: "Find who to change on every card",
  results: "Whole-checklist cameo choices",
  triggerText: "Choose who",
  placeholder: "Who's on every card?",
  emptyHint: "Type a name…",
  chip: (name) => `Chosen for every card: ${name}`,
  remove: (name) => `Clear ${name} as the choice`,
  option: (name) => `Choose ${name}`,
  create: (typed) => `Create and choose ${typed}`,
  sportSwitch: "Sport for the whole-checklist search",
};
