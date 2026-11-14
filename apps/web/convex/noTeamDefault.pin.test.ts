/**
 * NEO-556 — adversarial pass: source pins and cross-writer invariants for the
 * set-level "No Team" default (`selectorOptions.noTeamDefault`) and the card
 * stamp it leads to (`teamNoneConfirmedAt`).
 *
 *  1. SOURCE PINS. Every `insert("selectorOptions"` site copies the parent's
 *     team default through the helpers (so a new site that forgets it fails
 *     here, not in a user's set), `inheritedTeamIds` stays deleted, and the
 *     only places that can CREATE a `teamNoneConfirmedAt` value are listed.
 *  2. INVARIANT 8 across the writers. A stamp is never written on a card that
 *     has a team, a pending team name, a listing team, or a lookup that is
 *     outstanding or gave up. The commit is also checked against the client's
 *     `setDefaultSettlesNewRow` (the wizard may only err toward asking).
 *  3. NEVER BOTH. After every `setSelectorOptionTeams` transition and every
 *     copy-down, no row carries `teamIds` and `noTeamDefault` together.
 *  4. Q3 / Q4, the server-stamped `updateCard({ teamNone })`, and the
 *     operator's run agreeing with `noTeamCardVerdict`.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { teamRowFields } from "./lib/teamRow";
import { noTeamCardVerdict } from "./lib/selectorTeams";
import { insertTestCard } from "../lib/testing/card-row";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import { setDefaultSettlesNewRow } from "../components/SetSelector/teams-on-cards";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

beforeEach(() => {
  vi.stubGlobal("fetch", (async (url: string | URL) => {
    throw new Error(`NEO-556: this test file must not reach the network: ${String(url)}`);
  }) as unknown as typeof fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ===========================================================================
// 1. Source pins
// ===========================================================================

const sources = import.meta.glob(["./*.ts", "./lib/*.ts", "./features/*.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const productSources = Object.entries(sources).filter(
  ([path]) => !path.endsWith(".test.ts") && !path.includes("_generated"),
);

/** The text of the `{ ... }` object literal that starts at or after `from`. */
function objectLiteralAfter(text: string, from: number): string {
  const open = text.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced object literal");
}

describe("NEO-556 source pins", () => {
  test("every insert(\"selectorOptions\") spreads the parent's team default through the helpers", () => {
    const sites: string[] = [];
    for (const [path, text] of productSources) {
      const re = /insert\(\s*"selectorOptions"\s*,/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const literal = objectLiteralAfter(text, m.index + m[0].length - 1);
        const spreads = [...literal.matchAll(/\.\.\.\s*([A-Za-z_]\w*)\b(\()?/g)].map((s) => ({
          name: s[1],
          call: s[2] === "(",
        }));
        const ok = spreads.some(({ name, call }) => {
          if (call) return name === "inheritedTeamDefault" || name === "teamDefaultFields";
          // A variable: it must be declared from one of the helpers in this file.
          return new RegExp(
            `\\b${name}\\b[^;=]*=\\s*(?:await\\s+)?(?:inheritedTeamDefault|teamDefaultFields)\\(`,
          ).test(text) || new RegExp(`\\b${name}\\b\\s*=\\s*[^;]*\\binheritedTeamDefault\\(`).test(text);
        });
        const line = text.slice(0, m.index).split("\n").length;
        sites.push(`${path}:${line}`);
        expect(ok, `${path}:${line} does not spread inheritedTeamDefault / teamDefaultFields`).toBe(true);
      }
    }
    // The sweep is not vacuous: the ten sites the builder found.
    expect(sites.length).toBeGreaterThanOrEqual(10);
  });

  test("the old inheritedTeamIds export is gone, so tsc lists any site that still wants it", () => {
    for (const [path, text] of productSources) {
      if (path === "./lib/selectorTeams.ts") continue; // names it in a comment
      expect(text, path).not.toMatch(/\binheritedTeamIds\b/);
    }
    expect(sources["./lib/selectorTeams.ts"]).not.toMatch(/export function inheritedTeamIds/);
  });

  test("a selectorOptions patch never writes teamIds without going through teamDefaultPatch", () => {
    // `teamIds:` in a ctx.db.patch / replace on selectorOptions must come from
    // the one patch builder, or the other state survives next to it.
    for (const [path, text] of productSources) {
      const re = /ctx\.db\.(?:patch|replace)\(\s*(?:row|node|root|leaf|option)\w*\.?_?id?\w*\s*,\s*\{/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const literal = objectLiteralAfter(text, m.index + m[0].length - 1);
        if (/\bnoTeamDefault\s*:/.test(literal) || /\bteamIds\s*:/.test(literal)) {
          expect(literal, `${path}: a patch writes a team default by hand`).toMatch(/teamDefaultPatch\(/);
        }
      }
    }
  });

  test("the only code that can create a teamNoneConfirmedAt value is stampNoTeam, confirmCardNoTeam and settleCardTeamAnswer", () => {
    const fresh: string[] = [];
    for (const [path, text] of productSources) {
      for (const line of text.split("\n")) {
        const code = line.replace(/\/\/.*$/, "").trim();
        if (/^(\*|\/\*)/.test(line.trim())) continue;
        const m =
          /\bteamNoneConfirmedAt\s*:\s*([^,}]+)/.exec(code) ??
          /\bteamNoneConfirmedAt\s*=\s*([^;]+);?\s*$/.exec(code);
        if (!m) continue;
        if (/^(number|undefined|=)/.test(m[1].trim())) continue; // type position / clear / comparison
        if (/\.teamNoneConfirmedAt\b/.test(m[1])) continue; // a carry from another row
        if (/\?:/.test(code) || /v\.optional/.test(code)) continue;
        fresh.push(`${path} => ${m[1].trim()}`);
      }
    }
    expect(fresh.sort()).toEqual(
      [
        // stampNoTeam itself: `{ teamNoneConfirmedAt: now, ... }`
        "./lib/selectorTeams.ts => now",
        // NEO-102's confirmCardNoTeam (server clock + this admin)
        "./cardChecklist.ts => Date.now()",
        // NEO-335's operator pre-save answer; NOT via stampNoTeam (pre-existing),
        // gated on `a.operatorUserId` inside settleCardTeamAnswer.
        "./selectorOptions.ts => a.now",
      ].sort(),
    );
    // And the User-id half is never taken from an argument anywhere new.
    const userIdWrites = productSources.flatMap(([path, text]) =>
      text
        .split("\n")
        .map((l) => l.replace(/\/\/.*$/, "").trim())
        .filter((l) => /\bteamNoneConfirmedByUserId\s*:/.test(l) && !/\?:|v\.optional/.test(l))
        .map((l) => `${path} => ${l.replace(/\s+/g, " ")}`),
    );
    expect(userIdWrites.sort()).toEqual(
      [
        "./cardChecklist.ts => teamNoneConfirmedByUserId: userId,",
        "./cardRowCreate.ts => ? { teamNoneConfirmedByUserId: carried.teamNoneConfirmedByUserId }",
        "./lib/selectorTeams.ts => ): { teamNoneConfirmedAt: number; teamNoneConfirmedByUserId: string } {",
        "./lib/selectorTeams.ts => return { teamNoneConfirmedAt: now, teamNoneConfirmedByUserId: userId };",
        "./parallelChecklistBuild.ts => teamNoneConfirmedByUserId:",
        "./selectorOptions.ts => teamNoneConfirmedByUserId: a.operatorUserId,",
        "./selectorOptions.ts => teamNoneConfirmedByUserId: undefined,",
      ].sort(),
    );
  });

  test("every call to stampNoTeam passes a server clock, never a value read from args", () => {
    for (const [path, text] of productSources) {
      if (path === "./lib/selectorTeams.ts") continue;
      let from = 0;
      for (;;) {
        const at = text.indexOf("stampNoTeam(", from);
        if (at === -1) break;
        from = at + 1;
        let depth = 0;
        let end = at + "stampNoTeam".length;
        for (; end < text.length; end++) {
          if (text[end] === "(") depth++;
          else if (text[end] === ")" && --depth === 0) break;
        }
        const call = text.slice(at + "stampNoTeam(".length, end).replace(/\s+/g, " ").trim();
        if (!call.includes(",")) continue; // an import or a prose mention
        const secondArg = call.slice(call.lastIndexOf(",") + 1).trim();
        expect(["now", "Date.now()", "a.now"], `${path}: stampNoTeam(${call})`).toContain(secondArg);
        // The user id is never a bare property of the request args.
        expect(call, `${path}: stampNoTeam(${call})`).not.toMatch(/^args\.(?!operatorUserId \?\?)/);
      }
    }
  });
});

// ===========================================================================
// Fixtures
// ===========================================================================

const ADMIN = {
  subject: "admin_pin_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_pin_001",
  name: "Admin User",
  role: "admin",
};
const ADMIN_2 = { ...ADMIN, subject: "admin_pin_002", tokenIdentifier: "clerk|admin_pin_002" };
const SETTER = "admin_setter_999";
const NO_TEAM = { setAt: 1_600_000_000_000, setByUserId: SETTER };

type T = ReturnType<typeof convexTest>;
type RowId = Id<"selectorOptions">;
type Default = { teamIds?: Array<Id<"teams">>; noTeamDefault?: typeof NO_TEAM };

async function seedSport(t: T): Promise<RowId> {
  return t.run(async (ctx) =>
    ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      sportConfig: { skuCode: "BB", league: "MLB" },
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    }),
  );
}

async function seedTeam(t: T, sportId: RowId, name: string): Promise<Id<"teams">> {
  return t.run(async (ctx) =>
    ctx.db.insert("teams", { ...teamRowFields({ name, location: "Somewhere" }), sportId, lastUpdated: Date.now() }),
  );
}

/** sport > setName > variantType > insert > parallel, each with the given default. */
async function seedTree(
  t: T,
  sportId: RowId,
  d: { setName?: Default; variantType?: Default; insert?: Default; parallel?: Default } = {},
) {
  return t.run(async (ctx) => {
    const mk = async (
      level: Doc<"selectorOptions">["level"],
      value: string,
      parentId: RowId,
      extra: Default = {},
    ) => {
      const id = await ctx.db.insert("selectorOptions", {
        level,
        value,
        platformData: {},
        features: { season: "2024", manufacturer: "Topps" },
        parentId,
        children: [],
        ...extra,
        lastUpdated: Date.now(),
      });
      const parent = await ctx.db.get(parentId);
      await ctx.db.patch(parentId, { children: [...(parent!.children ?? []), id] });
      return id;
    };
    const setNameId = await mk("setName", "2024 Topps", sportId, d.setName);
    const variantTypeId = await mk("variantType", "Base", setNameId, d.variantType);
    const insertId = await mk("insert", "Stars", variantTypeId, d.insert);
    const parallelId = await mk("parallel", "Gold", insertId, d.parallel);
    return { setNameId, variantTypeId, insertId, parallelId };
  });
}

let seq = 0;
async function seedCard(t: T, leaf: RowId, extra: Partial<Doc<"cardChecklist">> = {}) {
  seq++;
  return t.run(async (ctx) =>
    insertTestCard(ctx, {
      selectorOptionId: leaf,
      cardNumber: String(seq),
      cardName: `Card ${seq}`,
      platformData: {},
      sortOrder: seq,
      lastUpdated: 1_700_000_000_000,
      ...extra,
    }),
  );
}

const getCard = (t: T, id: Id<"cardChecklist">) => t.run(async (ctx) => ctx.db.get(id));
const getRow = (t: T, id: RowId) => t.run(async (ctx) => ctx.db.get(id));
async function settle(t: T) {
  await drainScheduled(t);
  await cancelScheduled(t);
}

async function allSelectorRows(t: T): Promise<Array<Doc<"selectorOptions">>> {
  return t.run(async (ctx) => ctx.db.query("selectorOptions").collect());
}
function expectNeverBoth(rows: Array<Doc<"selectorOptions">>, label: string) {
  for (const r of rows) {
    expect(
      r.teamIds !== undefined && r.noTeamDefault !== undefined,
      `${label}: ${r.level} "${r.value}" carries teamIds AND noTeamDefault`,
    ).toBe(false);
    // An empty array is never stored.
    expect(r.teamIds?.length === 0, `${label}: ${r.level} "${r.value}" stores an empty teamIds`).toBe(false);
  }
}

// ===========================================================================
// 2. Invariant 8 across the writers
// ===========================================================================

function wireCard(o: {
  cardNumber: string;
  bscRef?: string;
  teams?: string[];
  teamLookup?: "answered" | "failed" | "checklist";
  rawTeamName?: string;
}) {
  return {
    cardNumber: o.cardNumber,
    cardName: `Card ${o.cardNumber}`,
    teams: o.teams ?? [],
    players: [],
    platformData: o.bscRef !== undefined ? { bsc: { ref: o.bscRef } } : {},
    ...(o.teamLookup ? { teamLookup: o.teamLookup } : {}),
    ...(o.rawTeamName !== undefined ? { rawTeamName: o.rawTeamName } : {}),
  };
}

describe("NEO-556 invariant 8 — the commit's insert branch, against the client's prediction", () => {
  test("whatever the wizard calls 'settled' the commit stamps; whatever carries a team claim is never stamped", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId, { variantType: { noTeamDefault: NO_TEAM } });

    const refs: Array<string | undefined> = [undefined, "BREF"];
    const lookups: Array<"answered" | "failed" | "checklist" | undefined> = [
      undefined,
      "answered",
      "failed",
      "checklist",
    ];
    const raws: Array<string | undefined> = [undefined, "", "   ", "Padres"];
    const teamLists: string[][] = [[], ["   "], ["Padres"]];

    const cards: Array<{ wire: ReturnType<typeof wireCard>; predictsSettled: boolean }> = [];
    let n = 0;
    for (const ref of refs)
      for (const teamLookup of lookups)
        for (const rawTeamName of raws)
          for (const teams of teamLists) {
            n++;
            const wire = wireCard({ cardNumber: String(n), bscRef: ref, teamLookup, rawTeamName, teams });
            const predictsSettled = setDefaultSettlesNewRow(
              {
                cardNumber: wire.cardNumber,
                cardName: wire.cardName,
                teams: wire.teams,
                platformData: wire.platformData,
                ...(teamLookup ? { teamLookup } : {}),
                ...(rawTeamName !== undefined ? { rawTeamName } : {}),
              },
              "noTeam",
            );
            cards.push({ wire, predictsSettled });
          }

    await t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: tree.variantTypeId,
      sportId,
      cards: cards.map((c) => c.wire),
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", tree.variantTypeId))
        .collect(),
    );
    const byNumber = new Map(rows.map((r) => [r.cardNumber, r]));
    expect(byNumber.size).toBe(cards.length);

    let predictedSettled = 0;
    for (const { wire, predictsSettled } of cards) {
      const row = byNumber.get(wire.cardNumber)!;
      const stamped = row.teamNoneConfirmedAt !== undefined;
      const label = JSON.stringify(wire);
      if (predictsSettled) {
        predictedSettled++;
        // The wizard skipped asking: the commit MUST have stamped, or the card
        // saves teamless with nobody asked.
        expect(stamped, `client says settled but the commit did not stamp: ${label}`).toBe(true);
      }
      if (stamped) {
        // Invariant 8 on the row itself.
        expect(row.teamOnCardIds ?? [], label).toEqual([]);
        expect(row.pendingTeamNames ?? [], label).toEqual([]);
        expect((row.bscTeamName ?? "").trim(), label).toBe("");
        expect(row.teamCheckOutcome === "gaveUp", label).toBe(false);
        expect(row.teamNoneConfirmedByUserId, label).toBe(ADMIN.subject);
        // Not awaiting a lookup it still has to run.
        if (row.platformData.bsc) expect(row.teamCheckDoneAt, label).toBeDefined();
      }
      // `rawTeamName` is only read by the server beside an ANSWERED lookup (it
      // is BSC's value); alone it is ignored, so only that pairing is a claim.
      const claimsTeam =
        wire.teams.some((x) => x.trim() !== "") ||
        ((wire as { teamLookup?: string }).teamLookup === "answered" && (wire.rawTeamName ?? "").trim() !== "");
      // An "answered" lookup with no BSC ref is a malformed claim (a lookup is
      // BY ref); see the dedicated test below for what the server does with it.
      const malformed = !wire.platformData.bsc && (wire as { teamLookup?: string }).teamLookup === "answered";
      if (claimsTeam && !malformed) {
        expect(stamped, `a card that names a team was stamped: ${label}`).toBe(false);
      }
    }
    // Not vacuous.
    expect(predictedSettled).toBeGreaterThan(5);
    await settle(t);
  });
});

describe("NEO-556 invariant 8 — a malformed commit claim", () => {
  // FAILING ON PURPOSE (adversarial finding, NEO-556): `settleCardTeamAnswer`
  // returns before it keeps the "Listed as:" hint when the card has no BSC ref
  // (`if (!a.hasBscRef || a.teamCheckDone) return`), so a wire card that says
  // `teamLookup: "answered"` with a `rawTeamName` but NO bsc ref is stamped No
  // Team under a No Team leaf although the listing named a team. The real SPA
  // never sends this (an answered lookup is by BSC ref, and the wizard asks
  // about the card), so it is a server-side guard gap against a malformed or
  // hostile client rather than a user-reachable bug. Fix = verdict-gate on the
  // raw name regardless of ref, or refuse `answered` without a ref.
  test("an 'answered' lookup carrying a listing team but no BSC ref is not stamped No Team", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId, { variantType: { noTeamDefault: NO_TEAM } });
    await t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: tree.variantTypeId,
      sportId,
      cards: [wireCard({ cardNumber: "1", teamLookup: "answered", rawTeamName: "Padres" })],
    });
    const row = (await t.run(async (ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", tree.variantTypeId))
        .collect(),
    ))[0];
    expect(row.teamNoneConfirmedAt).toBeUndefined();
    await settle(t);
  });
});

describe("NEO-556 invariant 8 — addCustomCard", () => {
  test("a leaf that somehow carries BOTH states is a set team: the card gets the team, never a stamp", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, "Bulls");
    const tree = await seedTree(t, sportId, {
      variantType: { teamIds: [bulls], noTeamDefault: NO_TEAM },
    });
    const id = await t.withIdentity(ADMIN).mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: tree.variantTypeId,
      cardNumber: "1",
      cardName: "Card 1",
    });
    const card = await getCard(t, id);
    expect(card!.teamOnCardIds).toEqual([bulls]);
    expect(card!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("only the LEAF's default is read: a No Team set above an unset leaf stamps nothing", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId, { setName: { noTeamDefault: NO_TEAM } });
    const id = await t.withIdentity(ADMIN).mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: tree.variantTypeId,
      cardNumber: "1",
      cardName: "Card 1",
    });
    expect((await getCard(t, id))!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("blank typed team names are no claim: the card is stamped, with nothing left in pendingTeamNames", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId, { variantType: { noTeamDefault: NO_TEAM } });
    const id = await t.withIdentity(ADMIN).mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: tree.variantTypeId,
      cardNumber: "1",
      cardName: "Card 1",
      teams: ["   ", ""],
    });
    const card = await getCard(t, id);
    expect(card!.teamNoneConfirmedByUserId).toBe(ADMIN.subject);
    expect(card!.pendingTeamNames ?? []).toEqual([]);
  });

  test("teamNone with an explicitly empty teamOnCardIds / blank names is accepted and stamped once", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId);
    const id = await t.withIdentity(ADMIN).mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: tree.variantTypeId,
      cardNumber: "1",
      cardName: "Card 1",
      teamNone: true,
      teamOnCardIds: [],
      teams: ["  "],
    });
    expect((await getCard(t, id))!.teamNoneConfirmedByUserId).toBe(ADMIN.subject);
  });
});

describe("NEO-556 invariant 8 — applyBscTeamResolution", () => {
  async function leafWithCard(
    t: T,
    leafDefault: Default | undefined,
    card: Partial<Doc<"cardChecklist">>,
    where: "leaf" | "setNameOnly" = "leaf",
  ) {
    const sportId = await seedSport(t);
    const tree = await seedTree(
      t,
      sportId,
      where === "leaf"
        ? { variantType: leafDefault ?? {} }
        : { setName: leafDefault ?? {} },
    );
    const id = await seedCard(t, tree.variantTypeId, {
      platformData: { bsc: { ref: "bsc-1", src: "b0" } },
      ...card,
    });
    return { id, tree, sportId };
  }
  const empty = (t: T, id: Id<"cardChecklist">) =>
    t.mutation(internal.cardChecklist.applyBscTeamResolution, {
      cardChecklistId: id,
      rawTeamName: "",
      teamNames: [],
    });

  test("BSC's empty answer never stamps a card holding a pending team name", async () => {
    const t = convexTest(schema, modules);
    const { id } = await leafWithCard(t, { noTeamDefault: NO_TEAM }, { pendingTeamNames: ["Gotham"] });
    await empty(t, id);
    const card = await getCard(t, id);
    expect(card!.teamNoneConfirmedAt).toBeUndefined();
    expect(card!.pendingTeamNames).toEqual(["Gotham"]);
    expect(card!.teamCheckDoneAt).toBeTypeOf("number");
  });

  test("BSC's whole claim ruled 'not a team' still never stamps a card holding a pending team name", async () => {
    const t = convexTest(schema, modules);
    const { id, tree } = await leafWithCard(t, { noTeamDefault: NO_TEAM }, { pendingTeamNames: ["Gotham"] });
    await t.run(async (ctx) => {
      await ctx.db.insert("entityReviewSkips", {
        selectorOptionId: tree.variantTypeId,
        kind: "team",
        nameNormalized: "league leaders",
        name: "League Leaders",
        skippedAt: 1,
        skippedByUserId: "skipper",
      });
    });
    await t.mutation(internal.cardChecklist.applyBscTeamResolution, {
      cardChecklistId: id,
      rawTeamName: "League Leaders",
      teamNames: ["League Leaders"],
    });
    expect((await getCard(t, id))!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("only the card's own leaf is asked: a No Team set above an unset leaf stamps nothing", async () => {
    const t = convexTest(schema, modules);
    const { id } = await leafWithCard(t, { noTeamDefault: NO_TEAM }, {}, "setNameOnly");
    await empty(t, id);
    expect((await getCard(t, id))!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("a leaf that carries both states is a set team: BSC's empty answer stamps nothing", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const x = await seedTeam(t, sportId, "Xs");
    const { id } = await leafWithCard(t, { teamIds: [x], noTeamDefault: NO_TEAM }, {});
    await empty(t, id);
    expect((await getCard(t, id))!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("a card that already carries a ruling keeps its stamp and its user", async () => {
    const t = convexTest(schema, modules);
    const { id } = await leafWithCard(
      t,
      { noTeamDefault: NO_TEAM },
      { teamNoneConfirmedAt: 7, teamNoneConfirmedByUserId: "operator_a" },
    );
    await empty(t, id);
    const card = await getCard(t, id);
    expect(card!.teamNoneConfirmedAt).toBe(7);
    expect(card!.teamNoneConfirmedByUserId).toBe("operator_a");
  });

  test("a late empty answer on a card whose lookup had GIVEN UP is a real answer: stamped, outcome becomes answered", async () => {
    const t = convexTest(schema, modules);
    const { id } = await leafWithCard(
      t,
      { noTeamDefault: NO_TEAM },
      { teamCheckDoneAt: 5, teamCheckOutcome: "gaveUp" },
    );
    await empty(t, id);
    const card = await getCard(t, id);
    expect(card!.teamCheckOutcome).toBe("answered");
    expect(card!.teamNoneConfirmedByUserId).toBe(SETTER);
  });
});

// ===========================================================================
// 3. updateCard({ teamNone }) cannot be spoofed
// ===========================================================================

describe("NEO-556 updateCard teamNone — server-stamped only", () => {
  async function plainCard(t: T) {
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId);
    const id = await seedCard(t, tree.variantTypeId);
    return { id, sportId, tree };
  }

  test("a client-supplied timestamp or user id is refused by the validator and nothing is written", async () => {
    const t = convexTest(schema, modules);
    const { id } = await plainCard(t);
    const asAdmin = t.withIdentity(ADMIN);
    await expect(
      asAdmin.mutation(api.selectorOptions.updateCard, { id, teamNone: true, teamNoneConfirmedAt: 1 } as never),
    ).rejects.toThrow();
    await expect(
      asAdmin.mutation(api.selectorOptions.updateCard, {
        id,
        teamNone: true,
        teamNoneConfirmedByUserId: "someone_else",
      } as never),
    ).rejects.toThrow();
    const card = await getCard(t, id);
    expect(card!.teamNoneConfirmedAt).toBeUndefined();
    expect(card!.teamNoneConfirmedByUserId).toBeUndefined();
  });

  test("the stamp is the server's clock and the calling admin, whatever else the call carries", async () => {
    const t = convexTest(schema, modules);
    const { id } = await plainCard(t);
    const before = Date.now();
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.updateCard, {
      id,
      teamNone: true,
      cardName: "Renamed",
    });
    const card = await getCard(t, id);
    expect(card!.teamNoneConfirmedAt).toBeGreaterThanOrEqual(before);
    expect(card!.teamNoneConfirmedAt).toBeLessThanOrEqual(Date.now());
    expect(card!.teamNoneConfirmedByUserId).toBe(ADMIN.subject);
    expect(card!.cardName).toBe("Renamed");
  });

  test("false and absent stamp nothing", async () => {
    const t = convexTest(schema, modules);
    const { id } = await plainCard(t);
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.updateCard, { id, teamNone: false });
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.updateCard, { id, cardName: "X" });
    expect((await getCard(t, id))!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("explicitly empty teams and blank pending names are no team: accepted, and the stamp lands", async () => {
    const t = convexTest(schema, modules);
    const { id } = await plainCard(t);
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.updateCard, {
      id,
      teamNone: true,
      teamOnCardIds: [],
      pendingTeamNames: ["   "],
    });
    expect((await getCard(t, id))!.teamNoneConfirmedByUserId).toBe(ADMIN.subject);
  });

  test("refused beside a real team or a typed name, and the refusal leaves the stored card exactly as it was", async () => {
    const t = convexTest(schema, modules);
    const { id, sportId } = await plainCard(t);
    const bulls = await seedTeam(t, sportId, "Bulls");
    const before = await getCard(t, id);
    await expect(
      t.withIdentity(ADMIN).mutation(api.selectorOptions.updateCard, { id, teamNone: true, teamOnCardIds: [bulls] }),
    ).rejects.toThrow();
    await expect(
      t.withIdentity(ADMIN).mutation(api.selectorOptions.updateCard, {
        id,
        teamNone: true,
        pendingTeamNames: ["Gotham"],
      }),
    ).rejects.toThrow();
    expect(await getCard(t, id)).toEqual(before);
  });

  test("a second admin re-asserting No Team keeps the first admin's stamp and time", async () => {
    const t = convexTest(schema, modules);
    const { id } = await plainCard(t);
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.updateCard, { id, teamNone: true });
    const first = await getCard(t, id);
    await t.withIdentity(ADMIN_2).mutation(api.selectorOptions.updateCard, { id, teamNone: true });
    const second = await getCard(t, id);
    expect(second!.teamNoneConfirmedAt).toBe(first!.teamNoneConfirmedAt);
    expect(second!.teamNoneConfirmedByUserId).toBe(ADMIN.subject);
  });

  test("it is admin-gated", async () => {
    const t = convexTest(schema, modules);
    const { id } = await plainCard(t);
    await expect(
      t.withIdentity({ ...ADMIN, role: "user" }).mutation(api.selectorOptions.updateCard, { id, teamNone: true }),
    ).rejects.toThrow();
    await expect(t.mutation(api.selectorOptions.updateCard, { id, teamNone: true })).rejects.toThrow();
  });
});

// ===========================================================================
// 4. Never both, after every transition and every copy-down
// ===========================================================================

describe("NEO-556 — a selectorOptions row never carries both teamIds and noTeamDefault", () => {
  type Start = "unset" | "teams" | "noTeam";
  type Action = "teams" | "noTeam" | "clear";

  for (const start of ["unset", "teams", "noTeam"] as Start[]) {
    for (const action of ["teams", "noTeam", "clear"] as Action[]) {
      test(`set ${start} -> ${action}: the root and every node hold exactly one state (or none)`, async () => {
        const t = convexTest(schema, modules);
        const sportId = await seedSport(t);
        const a = await seedTeam(t, sportId, "Alphas");
        const b = await seedTeam(t, sportId, "Betas");
        const c = await seedTeam(t, sportId, "Gammas");
        const base: Default =
          start === "teams" ? { teamIds: [a] } : start === "noTeam" ? { noTeamDefault: NO_TEAM } : {};
        // vt inherits; insert is an override; parallel is unset.
        const tree = await seedTree(t, sportId, {
          setName: base,
          variantType: base,
          insert: { teamIds: [c] },
        });
        await seedCard(t, tree.variantTypeId);

        await t.withIdentity(ADMIN).mutation(api.selectorOptions.setSelectorOptionTeams, {
          selectorOptionId: tree.setNameId,
          teamIds: action === "teams" ? [b] : [],
          ...(action === "noTeam" ? { noTeam: true } : {}),
        });
        await settle(t);
        const rows = await allSelectorRows(t);
        expectNeverBoth(rows, `${start} -> ${action}`);

        const root = (await getRow(t, tree.setNameId))!;
        if (action === "teams") expect(root.teamIds).toEqual([b]);
        if (action === "noTeam") expect(root.noTeamDefault).toBeDefined();
        if (action === "clear") {
          expect(root.teamIds).toBeUndefined();
          expect(root.noTeamDefault).toBeUndefined();
        }
        // The override beneath is never rewritten by a cascade.
        expect((await getRow(t, tree.insertId))!.teamIds).toEqual([c]);
        expect((await getRow(t, tree.insertId))!.noTeamDefault).toBeUndefined();
      });
    }
  }

  test("a root saved as No Team over a corrupt both-states node: the node that FOLLOWS ends with one state", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const a = await seedTeam(t, sportId, "Alphas");
    // vt is corrupt (both). It reads as `teams [a]`, equal to the previous root: it follows.
    const tree = await seedTree(t, sportId, {
      setName: { teamIds: [a] },
      variantType: { teamIds: [a], noTeamDefault: NO_TEAM },
    });
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.setSelectorOptionTeams, {
      selectorOptionId: tree.setNameId,
      teamIds: [],
      noTeam: true,
    });
    await settle(t);
    expectNeverBoth(await allSelectorRows(t), "corrupt follower");
    expect((await getRow(t, tree.variantTypeId))!.teamIds).toBeUndefined();
  });

  for (const parentState of ["unset", "teams", "noTeam", "both"] as const) {
    test(`addCustomSelectorOption under a ${parentState} parent births exactly one state`, async () => {
      const t = convexTest(schema, modules);
      const sportId = await seedSport(t);
      const a = await seedTeam(t, sportId, "Alphas");
      const state: Default =
        parentState === "teams"
          ? { teamIds: [a] }
          : parentState === "noTeam"
            ? { noTeamDefault: NO_TEAM }
            : parentState === "both"
              ? { teamIds: [a], noTeamDefault: NO_TEAM }
              : {};
      const tree = await seedTree(t, sportId, { setName: state });
      const childId = await t.withIdentity(ADMIN).mutation(api.selectorOptions.addCustomSelectorOption, {
        level: "variantType",
        value: "Chrome",
        parentId: tree.setNameId,
      });
      const child = (await getRow(t, childId))!;
      expectNeverBoth([child], parentState);
      if (parentState === "noTeam") expect(child.noTeamDefault).toEqual(NO_TEAM);
      if (parentState === "teams" || parentState === "both") expect(child.teamIds).toEqual([a]);
      if (parentState === "unset") {
        expect("teamIds" in child).toBe(false);
        expect("noTeamDefault" in child).toBe(false);
      }
    });
  }
});

// ===========================================================================
// 5. Q3 / Q4
// ===========================================================================

describe("NEO-556 Q4 — leaving No Team", () => {
  test("No Team -> X moves unstamped empty cards, never a stamped one; X -> No Team then moves nothing", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const x = await seedTeam(t, sportId, "Xs");
    const tree = await seedTree(t, sportId, {
      setName: { noTeamDefault: NO_TEAM },
      variantType: { noTeamDefault: NO_TEAM },
    });
    const stamped = await seedCard(t, tree.variantTypeId, {
      teamNoneConfirmedAt: 9,
      teamNoneConfirmedByUserId: "operator_a",
    });
    const awaiting = await seedCard(t, tree.variantTypeId, {
      platformData: { bsc: { ref: "b", src: "b0" } },
    });
    const hinted = await seedCard(t, tree.variantTypeId, { bscTeamName: "Gotham", teamCheckDoneAt: 1 });
    const pending = await seedCard(t, tree.variantTypeId, { pendingTeamNames: ["Gotham"] });

    const asAdmin = t.withIdentity(ADMIN);
    await asAdmin.mutation(api.selectorOptions.setSelectorOptionTeams, {
      selectorOptionId: tree.setNameId,
      teamIds: [x],
    });
    await settle(t);

    const s = (await getCard(t, stamped))!;
    expect(s.teamOnCardIds ?? []).toEqual([]);
    expect(s.teamNoneConfirmedAt).toBe(9);
    expect(s.teamNoneConfirmedByUserId).toBe("operator_a");
    expect((await getCard(t, awaiting))!.teamOnCardIds).toEqual([x]);
    // The pending name is the card's own answer waiting for review.
    expect((await getCard(t, pending))!.teamOnCardIds ?? []).toEqual([]);
    expect((await getCard(t, pending))!.pendingTeamNames).toEqual(["Gotham"]);
    // Nodes followed.
    expect((await getRow(t, tree.variantTypeId))!.teamIds).toEqual([x]);
    expect((await getRow(t, tree.variantTypeId))!.noTeamDefault).toBeUndefined();

    // X -> No Team: no card pass, so the cards that took X keep X.
    await asAdmin.mutation(api.selectorOptions.setSelectorOptionTeams, {
      selectorOptionId: tree.setNameId,
      teamIds: [],
      noTeam: true,
    });
    await settle(t);
    expect((await getCard(t, awaiting))!.teamOnCardIds).toEqual([x]);
    expect((await getCard(t, awaiting))!.teamNoneConfirmedAt).toBeUndefined();
    expect((await getCard(t, hinted))!.teamNoneConfirmedAt).toBeUndefined();
    expectNeverBoth(await allSelectorRows(t), "round trip");
  });
});

describe("NEO-556 Q3 — a set team beats a checklist's No Team, on every birth path", () => {
  test("commit: the card gets team X and no stamp, whether or not its lookup has run", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const x = await seedTeam(t, sportId, "Xs");
    const tree = await seedTree(t, sportId, { variantType: { teamIds: [x] } });
    await t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: tree.variantTypeId,
      sportId,
      cards: [
        { ...wireCard({ cardNumber: "1", bscRef: "B1", teamLookup: "checklist" }), teamNone: true as const },
        { ...wireCard({ cardNumber: "2" }), teamNone: true as const },
      ],
    });
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", tree.variantTypeId))
        .collect(),
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.teamOnCardIds).toEqual([x]);
      expect(r.teamNoneConfirmedAt).toBeUndefined();
    }
    await settle(t);
  });
});

// ===========================================================================
// 6. The operator's run and the verdict cannot disagree
// ===========================================================================

describe("NEO-556 cardNoTeamBulk.applyNoTeamPage agrees with noTeamCardVerdict on every combination", () => {
  test("a card is stamped iff the verdict says stamp; nothing else is written to a kept card", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const x = await seedTeam(t, sportId, "Xs");
    const tree = await seedTree(t, sportId, { setName: { noTeamDefault: NO_TEAM }, variantType: { noTeamDefault: NO_TEAM } });

    type Spec = Partial<Doc<"cardChecklist">>;
    const bsc = { platformData: { bsc: { ref: "b", src: "b0" } } };
    const specs: Spec[] = [];
    for (const team of [undefined, [x]])
      for (const pending of [undefined, ["Gotham"]])
        for (const hint of [undefined, "Gotham", "   "])
          for (const withBsc of [false, true])
            for (const done of [undefined, 1])
              for (const outcome of [undefined, "answered", "gaveUp", "checklist"] as const)
                specs.push({
                  ...(team ? { teamOnCardIds: team } : {}),
                  ...(pending ? { pendingTeamNames: pending } : {}),
                  ...(hint !== undefined ? { bscTeamName: hint } : {}),
                  ...(withBsc ? bsc : {}),
                  ...(done !== undefined ? { teamCheckDoneAt: done } : {}),
                  ...(outcome ? { teamCheckOutcome: outcome } : {}),
                });
    const ids: Array<Id<"cardChecklist">> = [];
    for (const s of specs) ids.push(await seedCard(t, tree.variantTypeId, s));
    const before = await Promise.all(ids.map((i) => getCard(t, i)));

    let cursor: string | null = null;
    for (let i = 0; i < 100; i++) {
      const page: { cursor: string | null } = await t
        .withIdentity(ADMIN)
        .mutation(api.cardNoTeamBulk.applyNoTeamPage, { selectorOptionId: tree.setNameId, cursor });
      cursor = page.cursor;
      if (cursor === null) break;
    }
    expect(cursor).toBeNull();

    let stampedCount = 0;
    for (let i = 0; i < ids.length; i++) {
      const was = before[i]!;
      const now = (await getCard(t, ids[i]))!;
      const verdict = noTeamCardVerdict({
        teamOnCardIds: was.teamOnCardIds,
        pendingTeamNames: was.pendingTeamNames,
        teamNoneConfirmedAt: was.teamNoneConfirmedAt,
        bscTeamName: was.bscTeamName,
        teamCheckDoneAt: was.teamCheckDoneAt,
        teamCheckOutcome: was.teamCheckOutcome,
        platformData: was.platformData.bsc ? { bsc: { ref: was.platformData.bsc.ref } } : {},
      });
      const label = JSON.stringify(specs[i]);
      if (verdict.verdict === "stamp") {
        stampedCount++;
        expect(now.teamNoneConfirmedAt, label).toBeTypeOf("number");
        expect(now.teamNoneConfirmedByUserId, label).toBe(ADMIN.subject);
      } else {
        expect(now.teamNoneConfirmedAt, label).toBe(was.teamNoneConfirmedAt);
        // A kept card is not touched at all.
        expect(now.teamOnCardIds, label).toEqual(was.teamOnCardIds);
        expect(now.pendingTeamNames, label).toEqual(was.pendingTeamNames);
        expect(now.bscTeamName, label).toBe(was.bscTeamName);
      }
    }
    expect(stampedCount).toBeGreaterThan(3);
    expect(stampedCount).toBeLessThan(ids.length);
    await settle(t);
  });
});
