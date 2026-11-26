/**
 * NEO-592 — the review gate (`resolveChecklistEntities`) must answer exactly
 * what it answered before it read concurrently and batched its hops.
 *
 * ## What the golden is
 *
 * `GOLDEN_*` below were RECORDED by running origin/main's `convex/` against
 * `lib/testing/neo592-gate-fixture.ts` (the same seed, the same cards) and
 * writing down what it returned; the branch was run on the same fixture in the
 * same session and the two were compared field for field (queued unknowns,
 * ambiguity, auto-link count, title context, every `entityReviewQueue` row's
 * kind / status / decision / preselect, the stored name resolutions). They
 * were identical, so this file pins the branch to the old answer without
 * keeping a copy of the old code around.
 *
 * It also pins the cost the change exists for: how many functions the action
 * calls, counted from OUTSIDE the product (every query and mutation module
 * export is wrapped in the registry), and that the log line names no one.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizePlayerName } from "./players";
import { normalizeTeamName } from "./teams";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import {
  committedCard,
  node,
  playerRow,
  product,
  seedGateWorld,
  teamRow,
  type FetchedCard,
} from "../lib/testing/neo592-gate-fixture";

const realModules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

/** Every call to a query or mutation, by "module:export", while armed. */
const calls: string[] = [];
let armed = false;

/**
 * A planted failure: the `nth` armed call (1-based, in the order the calls
 * START) of the function whose "module:export" ends with `fn` rejects with
 * `error`, after `delayMs`. `settled` flips when the rejection is delivered.
 */
type Fault = { fn: string; nth: number; error: Error; delayMs?: number; seen: number; settled: boolean };
const faults: Fault[] = [];
// Captured at load: convex-test swaps `setTimeout` for a thrower while a query
// or mutation handler runs, and a planted delay runs inside one.
const realSetTimeout = globalThis.setTimeout;
function plant(fn: string, nth: number, message: string, delayMs = 0): Fault {
  const fault: Fault = { fn, nth, error: new Error(message), delayMs, seen: 0, settled: false };
  faults.push(fault);
  return fault;
}

/**
 * The registry with each registered query/mutation wrapped so the test can see
 * which functions the action called. The wrapper copies the registered
 * function's own properties (convex-test reads them), and counts nothing
 * unless `armed`.
 */
function countingModules() {
  const modules: Record<string, () => Promise<unknown>> = {};
  for (const [path, load] of Object.entries(realModules)) {
    modules[path] = async () => {
      const real = (await load()) as Record<string, any>;
      const wrapped: Record<string, any> = { ...real };
      for (const [name, fn] of Object.entries(real)) {
        if (typeof fn !== "function" || !(fn.isQuery || fn.isMutation) || !fn._handler) continue;
        wrapped[name] = Object.assign(() => undefined, fn, {
          _handler: (ctx: unknown, args: unknown) => {
            const id = `${path.replace(/^\.\//, "").replace(/\.[jt]s$/, "")}:${name}`;
            if (armed) calls.push(id);
            const fault = armed
              ? faults.find((f) => id.endsWith(f.fn) && ++f.seen === f.nth)
              : undefined;
            if (fault) {
              return (async () => {
                if (fault.delayMs) await new Promise((r) => realSetTimeout(r, fault.delayMs));
                fault.settled = true;
                throw fault.error;
              })();
            }
            return fn._handler(ctx, args);
          },
        });
      }
      return wrapped;
    };
  }
  return modules;
}

const ADMIN = {
  subject: "admin_neo592_golden_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_neo592_golden_001",
  name: "Admin User",
  role: "admin",
};

type T = ReturnType<typeof convexTest>;
type Sel = Id<"selectorOptions">;

const live: T[] = [];
function newT(): T {
  const t = convexTest(schema, countingModules());
  live.push(t);
  return t;
}
afterEach(async () => {
  armed = false;
  calls.length = 0;
  faults.length = 0;
  for (const t of live.splice(0)) await cancelScheduled(t);
  vi.restoreAllMocks();
});

async function gate(t: T, selectorOptionId: Sel, sportId: Sel, cards: FetchedCard[]) {
  calls.length = 0;
  armed = true;
  try {
    return await t
      .withIdentity(ADMIN)
      .action(api.selectorOptions.resolveChecklistEntities, { selectorOptionId, sportId, cards });
  } finally {
    armed = false;
  }
}

function logLines(spy: ReturnType<typeof vi.spyOn>) {
  const out: Array<Record<string, any>> = [];
  for (const [first] of spy.mock.calls) {
    if (typeof first !== "string" || !first.startsWith("{")) continue;
    try {
      out.push(JSON.parse(first));
    } catch {
      /* not a JSON log line */
    }
  }
  return out;
}

/**
 * NEO-656 — the gate writes nothing, so its per-name facts are READ, the way
 * the Tidy Up walk reads them: once the commit lands, the names the gate could
 * not settle are pending names on the set's cards, and `tidyLeafFacts` asks
 * the same derivation about them. This stands in for that commit by putting
 * the gate's unknown names on one card of the leaf, then returns the facts.
 */
async function factRows(
  t: T,
  selectorOptionId: Sel,
  unknown: { unknownPlayers: string[]; unknownTeams: string[] },
) {
  await committedCard(t, selectorOptionId, "PENDING-1", {
    pendingPlayerNames: unknown.unknownPlayers,
    pendingTeamNames: unknown.unknownTeams,
  });
  const facts = await t
    .withIdentity(ADMIN)
    .action(api.selectorOptions.tidyLeafFacts, { selectorOptionId });
  return facts.gateItems;
}

const card = (n: number, players: string[], teams: string[] = []): FetchedCard => ({
  cardNumber: `I-${n}`,
  cardName: "Card",
  players,
  teams,
  platformData: {},
});

// ─── The golden, recorded from origin/main ──────────────────────────────────

const GOLDEN_UNKNOWN_PLAYERS = [
  "Bob Allen",
  "Stranger Alpha",
  // NEO-656 — the three names origin/main left out because an operator had
  // ruled them "not an entity" (`entityReviewSkips`). No ruling is stored or
  // read any more, so they are asked about like every other name.
  "Skipped Person",
  "Dual Name",
  "Other Set Skip",
  "Bo Jackson",
  "Dan Marino",
  "Pat Twin",
  "Stranger Beta",
  "Amy Early",
  "Guest Mid",
  "Tie Home",
  "Tie Guest",
  "Zed Late",
];
const GOLDEN_UNKNOWN_TEAMS = [
  "Skipped Team",
  "Dual Name",
  "Fictional Whalers",
  "Pending Team A",
  "Pending Team Guest",
  "Pending Team Tie Home",
  "Pending Team Z",
];
/**
 * kind | name | auto-link origin | preselect reason. The first three columns of
 * origin/main's per-name rows, minus the row's `status` and its existing
 * candidates, which were storage details (`tidyNames`) the walk now reads
 * for itself. The same names, the same auto-link, the same preselects.
 */
const GOLDEN_QUEUE: Array<[string, string, string | null, string | null]> = [
  ["player", "Bob Allen", null, null],
  ["player", "Stranger Alpha", null, null],
  ["player", "Skipped Person", null, null],
  ["player", "Dual Name", null, null],
  ["player", "Other Set Skip", null, null],
  ["player", "Bo Jackson", null, "onlyNamesake"],
  ["player", "Dan Marino", null, "priorYearProduct"],
  ["player", "Pat Twin", null, null],
  ["player", "Stranger Beta", null, null],
  ["player", "Amy Early", null, null],
  ["player", "Guest Mid", null, null],
  ["player", "Tie Home", null, null],
  ["player", "Tie Guest", null, null],
  ["player", "Zed Late", null, null],
  ["team", "Skipped Team", null, null],
  ["team", "Dual Name", null, null],
  ["team", "Fictional Whalers", null, null],
  ["team", "Pending Team A", null, null],
  ["team", "Pending Team Guest", null, null],
  ["team", "Pending Team Tie Home", null, null],
  ["team", "Pending Team Z", null, null],
  ["team", "St. Louis Browns", "careerTeam", null],
];
const GOLDEN_TITLE_CONTEXT = {
  manufacturerBrandUnknown: false,
  players: [
    { name: "Mike Trout", printed: "Mike Trout" },
    { name: "Vincent Edward Jackson", printed: "Ricky Alias" },
    { name: "Browns Veteran", printed: "Browns Veteran" },
  ],
  setNameValue: "Series 1",
  setPlayerNames: [],
  setTeamNames: [],
  sportValue: "Baseball",
  // NEO-606 — the resolved teams' Location / Name splits (first-seen order),
  // and the level the leaf names. Both came back in the reads the gate
  // already made: the hop count below is unchanged.
  teamSplits: [
    { location: "Boston", name: "Red Sox" },
    { location: "Winnipeg", name: "Jets" },
    { location: "St. Louis", name: "Browns" },
  ],
  titleLevels: [{ name: "Insert" }],
  teams: [
    { name: "Boston Red Sox", printed: "Boston Red Sox" },
    { name: "Boston Red Sox", printed: "Bosox" },
    { name: "Winnipeg Jets", printed: "Winnipeg Jets" },
    { name: "St. Louis Browns", printed: "St. Louis Browns" },
  ],
};

describe("resolveChecklistEntities on the representative fixture equals origin/main", () => {
  test("queued unknowns, ambiguity, auto-link count and title context", async () => {
    const t = newT();
    const w = await seedGateWorld(t);
    const result = await gate(t, w.selectorOptionId, w.sportId, w.cards);
    expect(result.unknownPlayers).toEqual(GOLDEN_UNKNOWN_PLAYERS);
    expect(result.unknownTeams).toEqual(GOLDEN_UNKNOWN_TEAMS);
    expect(result.ambiguousPlayers).toEqual(["Bob Allen"]);
    expect(result.autoLinkedCount).toBe(1);
    expect(result.titleContext).toEqual(GOLDEN_TITLE_CONTEXT);
  });

  test("every name's facts: kind, auto-link, preselect and candidates", async () => {
    const t = newT();
    const w = await seedGateWorld(t);
    const result = await gate(t, w.selectorOptionId, w.sportId, w.cards);
    // The automatic link the gate made is RETURNED (nothing is written).
    expect(result.gateLinks).toEqual([
      expect.objectContaining({
        kind: "team",
        name: "St. Louis Browns",
        teamId: w.ids.browns.early,
        origin: "careerTeam",
      }),
    ]);
    // Every other name is a fact the walk reads for itself: the unknown names,
    // asked about as the leaf's pending names, come out as origin/main's rows.
    const items = await factRows(t, w.selectorOptionId, result);
    const byKey = new Map(items.map((i) => [`${i.kind}|${i.name}`, i]));
    for (const [kind, name, origin, reason] of GOLDEN_QUEUE) {
      const item = byKey.get(`${kind}|${name}`);
      // The auto-linked name is an answered name: it is returned as a link
      // above, never as a pending-name fact.
      if (origin !== null) {
        expect(item).toBeUndefined();
        continue;
      }
      expect(item?.auto).toBeUndefined();
      expect(item?.preselect?.reason ?? null).toBe(reason);
    }
    expect(byKey.get("player|Bo Jackson")?.preselect?.playerId).toBe(w.ids.boFootball);
    expect(byKey.get("player|Dan Marino")?.preselect?.playerId).toBe(w.ids.marino);
    expect(result.ambiguousPlayers).toEqual(["Bob Allen"]);
  });

  test("the stored name resolutions are the players the gate settled, in card order", async () => {
    const t = newT();
    const w = await seedGateWorld(t);
    await gate(t, w.selectorOptionId, w.sportId, w.cards);
    const [stored] = await t.run((ctx) => ctx.db.query("checklistNameResolutions").collect());
    expect(stored.players).toEqual([
      { nameNormalized: normalizePlayerName("Mike Trout"), playerId: w.ids.trout },
      { nameNormalized: normalizePlayerName("Ricky Alias"), playerId: w.ids.vincent },
      { nameNormalized: normalizePlayerName("Browns Veteran"), playerId: w.ids.veteran },
    ]);
  });
});

// ─── Round trips ────────────────────────────────────────────────────────────

describe("the gate's round trips (the 200-name, 32-team shape)", () => {
  async function bigSet(t: T) {
    const sportId = await node(t, { level: "sport", value: "Baseball" });
    const p = await product(t, sportId, { year: "2024" });
    const cards: FetchedCard[] = [];
    // 232 candidate names.
    for (let i = 0; i < 200; i++) {
      const c = String.fromCharCode(97 + (i % 26));
      const d = String.fromCharCode(97 + (Math.floor(i / 26) % 26));
      const team = i < 32 ? [`City${c}${d} Squad${c}${d}`] : [];
      cards.push(card(i + 1, [`Rookie Person${c}${d}${i < 26 ? "" : "z"}`], team));
    }
    // Every printed team exists, so the team batch answers all 32 from rows.
    await t.run(async (ctx) => {
      for (let i = 0; i < 32; i++) {
        const c = String.fromCharCode(97 + (i % 26));
        const d = String.fromCharCode(97 + (Math.floor(i / 26) % 26));
        await ctx.db.insert("teams", {
          location: `City${c}${d}`,
          name: `Squad${c}${d}`,
          nameNormalized: normalizeTeamName(`City${c}${d} Squad${c}${d}`),
          sportId,
          lastUpdated: 1,
        });
      }
    });
    await playerRow(t, sportId, "Somebody Else");
    return { sportId, p, cards };
  }

  test("at most 16 child calls, with the player slices and the teams batch as one call each", async () => {
    const t = newT();
    const { sportId, p, cards } = await bigSet(t);
    const names = new Set(cards.flatMap((c) => c.players));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await gate(t, p.insert, sportId, cards);
    expect(result.unknownPlayers).toHaveLength(names.size);
    expect(result.unknownTeams).toEqual([]);

    const countOf = (suffix: string) => calls.filter((c) => c.endsWith(suffix)).length;
    expect(countOf(":reviewGatePrelude")).toBe(1);
    expect(countOf(":resolveNamesForReview")).toBe(Math.ceil(names.size / 25));
    expect(countOf(":findManyByNameAndSport")).toBe(1);
    expect(countOf(":findByNameAndSport")).toBe(0);
    expect(countOf(":getCardChecklist")).toBe(0);
    // NEO-656: 19 -> 16. The gate writes no name rows: the `upsertFromGatePage`
    // pages (2) and the `resetForRefetch` call (1) are gone; every read is
    // unchanged.
    expect(countOf(":upsertFromGatePage")).toBe(0);
    expect(countOf(":resetForRefetch")).toBe(0);
    expect(calls.length).toBeLessThanOrEqual(16);

    // The product's own tally agrees with the count taken from outside.
    const timing = logLines(log).find((l) => l.msg === "review_gate_timing")!;
    expect(timing.hops).toBe(calls.length);
  });

  test("the gate is one prelude call whatever the number of candidate names", async () => {
    for (const n of [5, 400]) {
      const t = newT();
      const sportId = await node(t, { level: "sport", value: "Baseball" });
      const p = await product(t, sportId, { year: "2024" });
      const cardsN = Array.from({ length: n }, (_, i) =>
        card(i + 1, [`Candidate Name${String.fromCharCode(97 + (i % 26))}${Math.floor(i / 26)}`]),
      );
      await gate(t, p.insert, sportId, cardsN);
      expect(calls.filter((c) => c.endsWith(":reviewGatePrelude"))).toHaveLength(1);
    }
  });

  test("a card-less call with nothing to ask makes only the prelude, the resolution write and the title reads", async () => {
    const t = newT();
    const sportId = await node(t, { level: "sport", value: "Baseball" });
    const p = await product(t, sportId, { year: "2024" });
    await gate(t, p.insert, sportId, []);
    expect(calls.filter((c) => c.endsWith(":resolveNamesForReview"))).toHaveLength(0);
    expect(calls.filter((c) => c.endsWith(":findManyByNameAndSport"))).toHaveLength(0);
    expect(calls.filter((c) => c.endsWith(":reviewGatePrelude"))).toHaveLength(1);
  });
});

// ─── The log line ───────────────────────────────────────────────────────────

describe("review_gate_timing", () => {
  test("is emitted once with ids, counts and milliseconds, and names no player or team", async () => {
    const t = newT();
    const w = await seedGateWorld(t);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await gate(t, w.selectorOptionId, w.sportId, w.cards);
    const raw = log.mock.calls
      .map(([first]) => first)
      .filter((first): first is string => typeof first === "string" && first.includes("review_gate_timing"));
    expect(raw).toHaveLength(1);
    const line = JSON.parse(raw[0]);
    expect(Object.keys(line).sort()).toEqual(
      [
        "autoLinked",
        "cards",
        "hops",
        "msg",
        "phasesMs",
        "playerNames",
        "selectorOptionId",
        "sportId",
        "teamNames",
        "totalMs",
        "unknownPlayers",
        "unknownTeams",
      ].sort(),
    );
    expect(line).toMatchObject({
      msg: "review_gate_timing",
      selectorOptionId: w.selectorOptionId,
      sportId: w.sportId,
      cards: w.cards.length,
      unknownPlayers: GOLDEN_UNKNOWN_PLAYERS.length,
      unknownTeams: GOLDEN_UNKNOWN_TEAMS.length,
      autoLinked: 1,
    });
    expect(typeof line.hops).toBe("number");
    for (const ms of Object.values(line.phasesMs)) expect(typeof ms).toBe("number");

    // Every name the fixture knows, as a player, a team or a pending name.
    const everyName = [
      ...GOLDEN_UNKNOWN_PLAYERS,
      ...GOLDEN_UNKNOWN_TEAMS,
      "Mike Trout",
      "Ricky Alias",
      "Browns Veteran",
      "Boston Red Sox",
      "Bosox",
      "Winnipeg Jets",
      "St. Louis Browns",
      "Skipped Person",
      "Skipped Team",
    ];
    for (const name of everyName) expect(raw[0]).not.toContain(name);
  });
});

// ─── The builder's deviations ───────────────────────────────────────────────

describe("deviations from the old call order change no answer", () => {
  test("a name the prior year settles AND one namesake also answers keeps the prior-year preselect", async () => {
    // The namesake lookup is now asked for every name nobody in the sport
    // answers to, including this one; its answer must never be read.
    const t = newT();
    const w = await seedGateWorld(t);
    const result = await gate(t, w.selectorOptionId, w.sportId, [card(1, ["Dan Marino"])]);
    const rows = await factRows(t, w.selectorOptionId, result);
    const marino = rows.find((r) => r.name === "Dan Marino")!;
    expect(marino.preselect).toMatchObject({
      playerId: w.ids.marino,
      reason: "priorYearProduct",
    });
    expect(rows.filter((r) => r.name === "Dan Marino")).toHaveLength(1);
  });

  test("the prior year picks one player and the lone namesake is a different one: the prior year wins", async () => {
    const t = newT();
    const baseball = await node(t, { level: "sport", value: "Baseball" });
    const football = await node(t, { level: "sport", value: "Football" });
    const prior = await product(t, baseball, { year: "2023" });
    const now = await product(t, baseball, { year: "2024" });
    const vincent = await playerRow(t, baseball, "Vincent Edward Jackson");
    await playerRow(t, football, "Bo Jackson");
    await committedCard(t, prior.base, "1", { printed: [["Bo Jackson", vincent]] });
    const result = await gate(t, now.insert, baseball, [card(1, ["Bo Jackson"])]);
    const [row] = await factRows(t, now.insert, result);
    expect(row.preselect).toMatchObject({ playerId: vincent, reason: "priorYearProduct" });
  });

  test("with a prior-year product but no queued names nothing is scanned, asked or queued", async () => {
    const t = newT();
    const baseball = await node(t, { level: "sport", value: "Baseball" });
    const prior = await product(t, baseball, { year: "2023" });
    const now = await product(t, baseball, { year: "2024" });
    const trout = await playerRow(t, baseball, "Mike Trout");
    await teamRow(t, baseball, "Boston", "Red Sox");
    await committedCard(t, prior.base, "1", { printed: [["Mike Trout", trout]] });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const quiet = await gate(t, now.insert, baseball, [card(1, ["Mike Trout"], ["Boston Red Sox"])]);
    expect(quiet.unknownPlayers).toEqual([]);
    expect(quiet.unknownTeams).toEqual([]);
    expect(quiet.batchId).toBeUndefined();
    expect(logLines(log).some((l) => l.msg === "prior_year_product_scan")).toBe(false);
    expect(calls.filter((c) => c.endsWith(":findOnlyNamesakes"))).toHaveLength(0);
    expect(quiet.gateLinks ?? []).toEqual([]);
  });
});

// ─── S2: the sport the browser sends is re-validated ────────────────────────

describe("a sportId that is not the set's sport ancestor", () => {
  test("is refused before any name resolution or batch is written", async () => {
    const t = newT();
    const w = await seedGateWorld(t);
    await expect(gate(t, w.selectorOptionId, w.ids.football, w.cards)).rejects.toThrow(
      /not the sport ancestor/,
    );
    expect(await t.run((ctx) => ctx.db.query("checklistNameResolutions").collect())).toEqual([]);
    expect(calls.filter((c) => c.endsWith(":replaceForFetch") || c.endsWith(":startBatch"))).toEqual([]);
    expect(calls.filter((c) => c.endsWith(":resolveNamesForReview"))).toEqual([]);
  });

  test("a chain with no sport row is refused too", async () => {
    const t = newT();
    const sportId = await node(t, { level: "sport", value: "Baseball" });
    const orphan = await node(t, { level: "year", value: "2024" });
    const leaf = await node(t, { level: "setName", value: "Orphan", parentId: orphan });
    await expect(gate(t, leaf, sportId, [card(1, ["Anyone Atall"])])).rejects.toThrow(
      /not the sport ancestor/,
    );
  });
});

// ─── Team names past one slice ──────────────────────────────────────────────

/** "aa", "ab", ... — letters only, so every index normalises to its own name. */
const alpha = (i: number) =>
  String.fromCharCode(97 + (Math.floor(i / 26) % 26)) + String.fromCharCode(97 + (i % 26));
const teamNameAt = (i: number) => `City${alpha(i)} Squad${alpha(i)}`;
const playerNameAt = (i: number) => `Rookie Person${alpha(i)}`;

/** Every table's rows, so "wrote nothing" is checked on the whole database. */
async function snapshotAll(t: T) {
  return t.run(async (ctx) => {
    const out: Record<string, unknown[]> = {};
    for (const table of Object.keys(schema.tables)) {
      out[table] = await ctx.db.query(table as any).collect();
    }
    return out;
  });
}

/** Collects every unhandled rejection the process sees until `stop()`. */
function watchUnhandled() {
  const seen: unknown[] = [];
  const onReject = (reason: unknown) => seen.push(reason);
  process.on("unhandledRejection", onReject);
  return {
    seen,
    stop: () => process.off("unhandledRejection", onReject),
  };
}

describe("the team batch past one slice of 50", () => {
  /** `count` printed teams on `count` cards; those in `missing` have no team row. */
  async function teamSet(t: T, count: number, missing: number[] = []) {
    const sportId = await node(t, { level: "sport", value: "Baseball" });
    const p = await product(t, sportId, { year: "2024" });
    await t.run(async (ctx) => {
      for (let i = 0; i < count; i++) {
        if (missing.includes(i)) continue;
        await ctx.db.insert("teams", {
          location: `City${alpha(i)}`,
          name: `Squad${alpha(i)}`,
          nameNormalized: normalizeTeamName(teamNameAt(i)),
          sportId,
          lastUpdated: 1,
        });
      }
    });
    const cards = Array.from({ length: count }, (_, i) => card(i + 1, [], [teamNameAt(i)]));
    return { sportId, p, cards };
  }

  /** The per-name answer: what `findByNameAndSport` says for each printed team. */
  async function singleAnswers(t: T, sportId: Sel, count: number) {
    const out: Array<string | null> = [];
    for (let i = 0; i < count; i++) {
      const row = await t
        .withIdentity(ADMIN)
        .query(internal.teams.findByNameAndSport, { name: teamNameAt(i), sportId, setYear: 2024 });
      out.push(row?._id ?? null);
    }
    return out;
  }

  test.each([
    [50, 1],
    [51, 2],
    [100, 2],
    [101, 3],
  ])("%i teams that all exist: none unknown, in %i batch call(s)", async (count, slices) => {
    const t = newT();
    const { sportId, p, cards } = await teamSet(t, count);
    const result = await gate(t, p.insert, sportId, cards);
    expect(result.unknownTeams).toEqual([]);
    expect(calls.filter((c) => c.endsWith(":findManyByNameAndSport"))).toHaveLength(
      Math.ceil(count / 50),
    );
    expect(Math.ceil(count / 50)).toBe(slices);
    // The single-name answer agrees for every team: all of them resolve.
    expect((await singleAnswers(t, sportId, count)).every((id) => id !== null)).toBe(true);
  });

  test.each([
    ["the second slice", 53],
    ["the last name of the first slice", 49],
    ["the first name of the second slice", 50],
    ["the last name of the third slice", 100],
    ["the very first name", 0],
  ])("one team missing from %s is the only unknown, and the per-name answer agrees", async (_where, at) => {
    const t = newT();
    const { sportId, p, cards } = await teamSet(t, 101, [at]);
    const result = await gate(t, p.insert, sportId, cards);
    expect(result.unknownTeams).toEqual([teamNameAt(at)]);
    expect(calls.filter((c) => c.endsWith(":findManyByNameAndSport"))).toHaveLength(3);
    const single = await singleAnswers(t, sportId, 101);
    const unknownBySingle = single.flatMap((id, i) => (id === null ? [teamNameAt(i)] : []));
    expect(unknownBySingle).toEqual(result.unknownTeams);
  });

  test("several teams missing across all three slices are all reported, in card order", async () => {
    const t = newT();
    const missing = [7, 49, 50, 99, 100];
    const { sportId, p, cards } = await teamSet(t, 101, missing);
    const result = await gate(t, p.insert, sportId, cards);
    expect(result.unknownTeams).toEqual(missing.map(teamNameAt));
  });
});

// ─── Failures inside the gate's fan-out ─────────────────────────────────────

describe("when a concurrent read in the gate fails", () => {
  let watch: ReturnType<typeof watchUnhandled>;
  afterEach(() => watch?.stop());

  /** Let any rejection nobody handled surface before looking. */
  const drainRejections = () => new Promise((resolve) => setTimeout(resolve, 60));

  async function manyNames(t: T, players: number, teamCount: number) {
    const sportId = await node(t, { level: "sport", value: "Baseball" });
    const p = await product(t, sportId, { year: "2024" });
    await playerRow(t, sportId, "Somebody Else");
    const cards = Array.from({ length: Math.max(players, teamCount) }, (_, i) =>
      card(
        i + 1,
        i < players ? [playerNameAt(i)] : [],
        i < teamCount ? [teamNameAt(i)] : [],
      ),
    );
    return { sportId, p, cards };
  }

  test("the 2nd of 3 team slices throwing rejects the gate with that error, writes nothing, leaves nothing unhandled", async () => {
    const t = newT();
    const { sportId, p, cards } = await manyNames(t, 0, 101);
    const before = await snapshotAll(t);
    watch = watchUnhandled();
    plant(":findManyByNameAndSport", 2, "team slice 2 failed");
    await expect(gate(t, p.insert, sportId, cards)).rejects.toThrow("team slice 2 failed");
    await drainRejections();
    expect(watch.seen).toEqual([]);
    // All three slices were started (3 in flight at once) and have settled.
    expect(calls.filter((c) => c.endsWith(":findManyByNameAndSport"))).toHaveLength(3);
    expect(await snapshotAll(t)).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query("checklistNameResolutions").collect())).toEqual([]);
  });

  test("the 2nd of 3 player slices throwing rejects the gate with that error, writes nothing, leaves nothing unhandled", async () => {
    const t = newT();
    const { sportId, p, cards } = await manyNames(t, 60, 0);
    const before = await snapshotAll(t);
    watch = watchUnhandled();
    plant(":resolveNamesForReview", 2, "player slice 2 failed");
    await expect(gate(t, p.insert, sportId, cards)).rejects.toThrow("player slice 2 failed");
    await drainRejections();
    expect(watch.seen).toEqual([]);
    expect(calls.filter((c) => c.endsWith(":resolveNamesForReview"))).toHaveLength(3);
    expect(await snapshotAll(t)).toEqual(before);
  });

  test("a team failure beside a player failure: the gate waits for both to settle and throws the player's (argument order)", async () => {
    const t = newT();
    const { sportId, p, cards } = await manyNames(t, 60, 60);
    const before = await snapshotAll(t);
    watch = watchUnhandled();
    const fast = plant(":findManyByNameAndSport", 1, "team batch failed fast", 3);
    const slow = plant(":resolveNamesForReview", 1, "player batch failed slow", 40);
    await expect(gate(t, p.insert, sportId, cards)).rejects.toThrow("player batch failed slow");
    // `Promise.all` would have thrown the first rejection to arrive while the
    // other read was still running. (convex-test runs handlers one at a time,
    // so which arrives first is not the point: BOTH must be over by now.)
    expect(fast.settled).toBe(true);
    expect(slow.settled).toBe(true);
    await drainRejections();
    expect(watch.seen).toEqual([]);
    expect(await snapshotAll(t)).toEqual(before);
  });

  test("a failing title-context read (set facts) rejects the gate and leaves nothing unhandled", async () => {
    const t = newT();
    const w = await seedGateWorld(t);
    watch = watchUnhandled();
    plant(":titleSetFacts", 1, "title facts failed");
    await expect(gate(t, w.selectorOptionId, w.sportId, w.cards)).rejects.toThrow(
      "title facts failed",
    );
    await drainRejections();
    expect(watch.seen).toEqual([]);
  });

  test("a failing title-context player-name page rejects the gate and leaves nothing unhandled", async () => {
    const t = newT();
    const w = await seedGateWorld(t);
    watch = watchUnhandled();
    plant(":playerNamesByIds", 1, "title page failed");
    await expect(gate(t, w.selectorOptionId, w.sportId, w.cards)).rejects.toThrow(
      "title page failed",
    );
    await drainRejections();
    expect(watch.seen).toEqual([]);
  });

  test("set facts and a name page both failing: the facts error wins (argument order) once the slow page has settled", async () => {
    const t = newT();
    const w = await seedGateWorld(t);
    watch = watchUnhandled();
    plant(":titleSetFacts", 1, "title facts failed", 30);
    const page = plant(":playerNamesByIds", 1, "title page failed");
    await expect(gate(t, w.selectorOptionId, w.sportId, w.cards)).rejects.toThrow(
      "title facts failed",
    );
    expect(page.settled).toBe(true);
    await drainRejections();
    expect(watch.seen).toEqual([]);
  });
});

// keep the unused-import linter honest about fixtures a future test will want
void teamRow;
