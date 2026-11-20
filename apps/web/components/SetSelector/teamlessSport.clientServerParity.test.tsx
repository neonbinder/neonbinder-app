/**
 * NEO-426 — one table, two rules. The wizard's client rule (`autoNoTeamIndexes`,
 * which is `takesNoTeamByDefault` on cards that would save with no team) and
 * the commit's server rule (`sportDefaultNoTeam` for the people, then
 * `noTeamCardVerdict` on the card as it is born) are asked the same question
 * about the same card.
 *
 * The contract: the client may ASK about a card the server would stamp (the
 * operator then answers, nothing is lost), but must NEVER skip a card the
 * server would not stamp: that card would save with no team and nobody asked.
 *
 * The server side is built here from the same case, the way
 * `commitCardChecklistChunk` builds it for a NEW card:
 *  - players: every created / linked / resolved person with an id, plus the
 *    row's default player only when the listing names nobody; an undecided
 *    printed name is a pending player name, a skipped one is nobody;
 *  - team: a printed string not ruled out is a pending team name (it did not
 *    resolve) or, if it resolved, a team id; `settleCardTeamAnswer`'s lookup
 *    bookkeeping (mirrored below, it is not exported) gives `bscTeamName` and
 *    `teamCheckDoneAt/Outcome`; the hint is the real `commitTeamHint`.
 *
 * Two forms: a named table (documents each ruling, both sides pinned) and an
 * exhaustive sweep of the dimensions (proves the implication everywhere).
 */

import { describe, expect, test } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { normalizeEntityName } from "../../convex/lib/entityNearMatch";
import { noTeamCardVerdict } from "../../convex/lib/selectorTeams";
import { sportDefaultNoTeam, type TeamlessSport } from "../../convex/lib/teamlessSport";
import { commitTeamHint } from "../../convex/selectorOptions";
import {
  autoNoTeamIndexes,
  storedPeople,
  type PreviewCardForTeams,
  type TeamsReviewRow,
} from "./teams-on-cards";

const NONE = "sport_none";
const BALL = "sport_ball";
const STAMP: TeamlessSport = { setAt: 1, setByUserId: "admin" };

type How =
  | "created" // review row, create, born in his sport
  | "linked" // review row, link to an existing player
  | "linkedUnloaded" // linked, but the client has not read his sport yet
  | "resolved" // no row: resolved before the sitting (fetch's teamlessPlayerNames)
  | "undecided" // review row with no decision
  | "skipped"; // review row ruled "not a person"
type Person = { name: string; how: How; teamless: boolean };
type Lookup = "answered" | "failed" | "checklist" | undefined;

type Case = {
  name: string;
  people: Person[];
  /** The row's "Player on every card": used only when the listing names nobody. */
  defaultPlayer?: { teamless: boolean; loaded?: boolean };
  teams?: string[];
  /** Printed team strings the operator ruled "not a team". */
  ruledOutTeams?: string[];
  /** Printed team strings that resolve to a team (a create/link row). */
  resolvedTeams?: string[];
  rawTeamName?: string;
  bsc?: boolean;
  teamLookup?: Lookup;
  existing?: boolean;
};

const p = (name: string, how: How, teamless = true): Person => ({ name, how, teamless });

let seq = 0;
const norm = normalizeEntityName;

/** The client's inputs for a case. */
function clientInputs(c: Case) {
  const rows: TeamsReviewRow[] = [];
  const playerSportIds = new Map<string, string>();
  const resolvedNames: string[] = [];
  for (const person of c.people) {
    seq += 1;
    const id = `row_${seq}`;
    const sport = person.teamless ? NONE : BALL;
    switch (person.how) {
      case "created":
        rows.push({ _id: id, kind: "player", name: person.name, sportId: sport, decision: { action: "create" } });
        break;
      case "linked":
      case "linkedUnloaded": {
        const playerId = `pl_${person.name}`;
        rows.push({ _id: id, kind: "player", name: person.name, decision: { action: "link", linkedPlayerId: playerId } });
        if (person.how === "linked") playerSportIds.set(playerId, sport);
        break;
      }
      case "resolved":
        if (person.teamless) resolvedNames.push(person.name);
        break;
      case "undecided":
        rows.push({ _id: id, kind: "player", name: person.name, decision: null });
        break;
      case "skipped":
        rows.push({ _id: id, kind: "player", name: person.name, decision: { action: "skip" } });
        break;
    }
  }
  for (const t of c.ruledOutTeams ?? []) {
    seq += 1;
    rows.push({ _id: `row_${seq}`, kind: "team", name: t, decision: { action: "skip" } });
  }
  for (const t of c.resolvedTeams ?? []) {
    seq += 1;
    rows.push({ _id: `row_${seq}`, kind: "team", name: t, decision: { action: "create" } });
  }
  // Teams that are neither ruled out nor resolved: a row still undecided
  // (a string with no row would read as resolved before the sitting).
  for (const t of c.teams ?? []) {
    if ((c.ruledOutTeams ?? []).includes(t) || (c.resolvedTeams ?? []).includes(t)) continue;
    seq += 1;
    rows.push({ _id: `row_${seq}`, kind: "team", name: t, decision: null });
  }
  let defaultWire;
  if (c.defaultPlayer) {
    const playerId = "pl_default" as Id<"players">;
    defaultWire = { playerId, name: "Default Dan", positions: [0] };
    if (c.defaultPlayer.loaded !== false) {
      playerSportIds.set(playerId, c.defaultPlayer.teamless ? NONE : BALL);
    }
  }
  const card: PreviewCardForTeams = {
    cardNumber: "1",
    cardName: "Card 1",
    players: c.people.map((x) => x.name),
    ...(c.teams ? { teams: c.teams } : {}),
    ...(c.rawTeamName !== undefined ? { rawTeamName: c.rawTeamName } : {}),
    ...(c.bsc ? { platformData: { bsc: { ref: "ref-1" } } } : {}),
    ...(c.teamLookup ? { teamLookup: c.teamLookup } : {}),
  };
  const stored = storedPeople(undefined, undefined, undefined, defaultWire, {
    teamlessSportIds: [NONE],
    playerSportIds,
    teamlessPlayerNames: resolvedNames,
    existingIndexes: c.existing ? [0] : [],
  });
  return { card, rows, stored };
}

/** `settleCardTeamAnswer`'s lookup bookkeeping for a card with no team and no ruling. */
function settled(c: Case, hasPendingTeam: boolean, hint: string) {
  const hasBscRef = !!c.bsc;
  if (!hasBscRef) {
    return {
      bscTeamName: c.teamLookup === "answered" && !hasPendingTeam && hint ? hint : undefined,
    };
  }
  if (c.teamLookup === "checklist") {
    return { teamCheckDoneAt: 1, teamCheckOutcome: "checklist" as const };
  }
  if (c.teamLookup === "answered") {
    return {
      teamCheckDoneAt: 1,
      teamCheckOutcome: "answered" as const,
      bscTeamName: hasPendingTeam || !hint ? undefined : hint,
    };
  }
  return {}; // failed / none recorded: enqueued, no bookkeeping
}

/** Would the commit stamp this NEW card "No team" by the sport default? */
function serverStamps(c: Case): boolean {
  if (c.existing) return false; // the re-sync branch reads stored bookkeeping
  const named = c.people.length > 0;
  const bornIds = c.people
    .filter((x) => x.how === "created" || x.how === "linked" || x.how === "linkedUnloaded" || x.how === "resolved")
    .map((x) => `id_${x.name}`);
  if (!named && c.defaultPlayer) bornIds.push("id_default");
  const truth = new Map<string, boolean>();
  for (const x of c.people) truth.set(`id_${x.name}`, x.teamless);
  if (c.defaultPlayer) truth.set("id_default", c.defaultPlayer.teamless);
  const pendingPlayerNameCount = c.people.filter((x) => x.how === "undecided").length;
  const vouched = sportDefaultNoTeam({
    playerIds: bornIds,
    pendingPlayerNameCount,
    homeSport: (id) => (truth.get(id) ? STAMP : undefined),
  });

  const ruled = new Set((c.ruledOutTeams ?? []).map(norm));
  const printed = (c.teams ?? []).filter((t) => !ruled.has(norm(t)));
  const resolved = new Set((c.resolvedTeams ?? []).map(norm));
  const teamOnCardIds = printed.filter((t) => resolved.has(norm(t))).map((t) => `team_${t}`);
  const pendingTeamNames = printed.filter((t) => !resolved.has(norm(t)));
  const hint = commitTeamHint(c.rawTeamName, c.teams ?? [], ruled) ?? "";
  const verdict = noTeamCardVerdict({
    teamOnCardIds: teamOnCardIds as unknown as Id<"teams">[],
    pendingTeamNames,
    ...settled(c, pendingTeamNames.length > 0, hint),
    platformData: c.bsc ? { bsc: { ref: "ref-1" } } : {},
  });
  return vouched !== undefined && verdict.verdict === "stamp";
}

function clientAuto(c: Case): boolean {
  const { card, rows, stored } = clientInputs(c);
  return autoNoTeamIndexes([card], rows, undefined, stored).includes(0);
}

const TABLE: Array<Case & { client: boolean; server: boolean }> = [
  { name: "one created teamless player, plain card", people: [p("A", "created")], client: true, server: true },
  { name: "a linked teamless player", people: [p("A", "linked")], client: true, server: true },
  { name: "a name resolved before the sitting", people: [p("A", "resolved")], client: true, server: true },
  { name: "two teamless people", people: [p("A", "created"), p("B", "linked")], client: true, server: true },
  { name: "created player in a sport with teams", people: [p("A", "created", false)], client: false, server: false },
  { name: "mixed card", people: [p("A", "created"), p("B", "created", false)], client: false, server: false },
  { name: "linked player, sport not loaded: client asks, server stamps", people: [p("A", "linkedUnloaded")], client: false, server: true },
  { name: "an undecided printed name", people: [p("A", "created"), p("B", "undecided")], client: false, server: false },
  { name: "a name ruled 'not a person' beside a teamless one", people: [p("A", "created"), p("B", "skipped")], client: true, server: true },
  { name: "only a ruled-out name", people: [p("B", "skipped")], client: false, server: false },
  { name: "nobody on the card", people: [], client: false, server: false },
  { name: "default player (NEO-528), teamless", people: [], defaultPlayer: { teamless: true }, client: true, server: true },
  { name: "default player with teams", people: [], defaultPlayer: { teamless: false }, client: false, server: false },
  { name: "default player, sport not loaded: client asks, server stamps", people: [], defaultPlayer: { teamless: true, loaded: false }, client: false, server: true },
  { name: "default player ignored when the listing names someone (ruled out)", people: [p("B", "skipped")], defaultPlayer: { teamless: true }, client: false, server: false },
  { name: "a listing team still waiting on review", people: [p("A", "created")], teams: ["Cubs"], client: false, server: false },
  { name: "a listing team ruled 'not a team'", people: [p("A", "created")], teams: ["Wilson Glove"], ruledOutTeams: ["Wilson Glove"], client: true, server: true },
  { name: "one printed team ruled out, one still claiming", people: [p("A", "created")], teams: ["Wilson Glove", "Cubs"], ruledOutTeams: ["Wilson Glove"], client: false, server: false },
  { name: "a printed team that resolves", people: [p("A", "created")], teams: ["Cubs"], resolvedTeams: ["Cubs"], client: false, server: false },
  { name: "rawTeamName on a BSC card whose lookup answered", people: [p("A", "created")], bsc: true, teamLookup: "answered", rawTeamName: "Cubs", client: false, server: false },
  { name: "rawTeamName ruled out", people: [p("A", "created")], bsc: true, teamLookup: "answered", rawTeamName: "Wilson Glove", ruledOutTeams: ["Wilson Glove"], client: true, server: true },
  { name: "rawTeamName on a card with no BSC ref: client asks, server stamps", people: [p("A", "created")], rawTeamName: "Cubs", client: false, server: true },
  { name: "BSC lookup answered, no listing team", people: [p("A", "created")], bsc: true, teamLookup: "answered", client: true, server: true },
  { name: "BSC lookup failed", people: [p("A", "created")], bsc: true, teamLookup: "failed", client: false, server: false },
  { name: "BSC lookup never recorded", people: [p("A", "created")], bsc: true, client: false, server: false },
  { name: "BSC card settled by the checklist (ruled-out string)", people: [p("A", "created")], bsc: true, teamLookup: "checklist", teams: ["Wilson Glove"], ruledOutTeams: ["Wilson Glove"], client: true, server: true },
  { name: "a card re-syncing a stored row: client asks, server judges its own bookkeeping", people: [p("A", "created")], existing: true, client: false, server: false },
];

describe("client rule against server rule: one table", () => {
  test.each(TABLE)("$name", (c) => {
    expect(clientAuto(c)).toBe(c.client);
    expect(serverStamps(c)).toBe(c.server);
    // The contract itself, for this case.
    if (clientAuto(c)) expect(serverStamps(c)).toBe(true);
  });

  test("the table has both kinds of ruling, so the implication is not vacuous", () => {
    expect(TABLE.some((c) => c.client && c.server)).toBe(true);
    expect(TABLE.some((c) => !c.client && c.server)).toBe(true);
    expect(TABLE.some((c) => !c.client && !c.server)).toBe(true);
    expect(TABLE.some((c) => c.client && !c.server)).toBe(false);
  });
});

describe("client never skips a card the server would not stamp: every combination", () => {
  const HOWS: How[] = ["created", "linked", "linkedUnloaded", "resolved", "undecided", "skipped"];
  const persons: Person[] = [];
  for (const how of HOWS) {
    persons.push(p("A", how, true));
    if (how !== "undecided" && how !== "skipped") persons.push(p("A", how, false));
  }
  const personSets: Person[][] = [[]];
  for (const a of persons) personSets.push([a]);
  for (const a of persons) {
    for (const b of persons) personSets.push([a, { ...b, name: "B" }]);
  }

  const lookups: Lookup[] = [undefined, "answered", "failed", "checklist"];
  const teamShapes: Array<Pick<Case, "teams" | "ruledOutTeams" | "resolvedTeams">> = [
    {},
    { teams: ["Cubs"] },
    { teams: ["Cubs"], ruledOutTeams: ["Cubs"] },
    { teams: ["Cubs"], resolvedTeams: ["Cubs"] },
    { teams: ["Cubs", "Glove"], ruledOutTeams: ["Glove"] },
  ];
  const raws: Array<{ rawTeamName?: string; ruled?: string[] }> = [
    {},
    { rawTeamName: "Cubs" },
    { rawTeamName: "   " },
  ];
  const defaults: Array<Case["defaultPlayer"]> = [
    undefined,
    { teamless: true },
    { teamless: false },
    { teamless: true, loaded: false },
  ];

  test("no combination has the client skipping where the server would not stamp", () => {
    let total = 0;
    let both = 0;
    let clientOnlyAsks = 0;
    const violations: string[] = [];
    for (const people of personSets) {
      for (const bsc of [false, true]) {
        for (const teamLookup of lookups) {
          for (const shape of teamShapes) {
            for (const raw of raws) {
              for (const defaultPlayer of defaults) {
                for (const existing of [false, true]) {
                  const c: Case = {
                    name: "sweep",
                    people,
                    bsc,
                    existing,
                    ...(teamLookup ? { teamLookup } : {}),
                    ...shape,
                    ...(raw.rawTeamName !== undefined ? { rawTeamName: raw.rawTeamName } : {}),
                    ...(defaultPlayer ? { defaultPlayer } : {}),
                  };
                  total += 1;
                  const client = clientAuto(c);
                  const server = serverStamps(c);
                  if (client && server) both += 1;
                  if (!client && server) clientOnlyAsks += 1;
                  if (client && !server) violations.push(JSON.stringify(c));
                }
              }
            }
          }
        }
      }
    }
    expect(violations.slice(0, 3)).toEqual([]);
    // The sweep reaches both agreeing stamps and client-asks-more.
    expect(total).toBeGreaterThan(5000);
    expect(both).toBeGreaterThan(0);
    expect(clientOnlyAsks).toBeGreaterThan(0);
  });
});
