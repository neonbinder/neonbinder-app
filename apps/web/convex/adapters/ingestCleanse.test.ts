/**
 * NEO-643 — every name or label an adapter ingests is cleansed as it comes in,
 * and every id, slug and `platformRef` stays byte-identical.
 *
 * BSC replaces an accented letter with a backslash ("Wilmer R\ios" for Ríos,
 * "B\eisbol" for Béisbol). Jason, 2026-11-21: "as we get a name from any
 * external source it should be cleansed" — so this is source-agnostic: the
 * SportLots, Wikidata, ESPN and preprocess ingest points are pinned here too.
 *
 * The real adapter actions run with `fetch` stubbed and the credential reads
 * mocked (the `marketplaceFetchFailure.adapters.test.ts` pattern). The module
 * glob reaches up one level because this file sits under convex/adapters/.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { __resetEspnTeamListCache, fetchEspnTeamInfo, fetchEspnTeamList } from "./espn";
import { parsePlayersField, parseVariationDescription } from "./buysportscards";
import {
  lookupLeagueEnrichmentLive,
  lookupPlayerEnrichmentLive,
  type SportEnrichmentContext,
} from "./wikidata";

// convex-test finds the functions directory from the keys, which must read
// "./<module>" as they do for a test at the convex/ root. A glob from here
// yields "../<module>" for the convex/ files and "./<file>" for the sibling
// adapters; the loaders are already bound to the real files, so re-keying them
// relative to convex/ is safe.
const modules = Object.fromEntries(
  Object.entries(
    (import.meta as unknown as {
      glob: (pattern: string) => Record<string, () => Promise<unknown>>;
    }).glob("../**/*.*s"),
  ).map(([key, load]) => [
    key.startsWith("../") ? `./${key.slice(3)}` : `./adapters/${key.slice(2)}`,
    load,
  ]),
);

const ADMIN = {
  subject: "admin_neo643_cleanse",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_neo643_cleanse",
  role: "admin",
};

vi.mock("../credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../credentials")>();
  const { internalAction } = await import("../_generated/server");
  const { v } = await import("convex/values");
  const getSiteToken = internalAction({
    args: { site: v.string() },
    returns: v.any(),
    handler: async (_ctx, args) => ({
      token: args.site === "sportlots" ? "PHPSESSID=neo643" : "bsc-token-neo643",
    }),
  });
  return {
    ...actual,
    getSiteToken,
    siteTokenForCurrentUser: (ctx: unknown, site: string) =>
      (getSiteToken as unknown as { _handler: (c: unknown, a: { site: string }) => unknown })._handler(ctx, { site }),
    authenticateBsc: internalAction({
      args: { userId: v.optional(v.string()), tokenRefused: v.optional(v.boolean()) },
      returns: v.any(),
      handler: async () => ({ success: true }),
    }),
    authenticateSportlots: internalAction({
      args: {},
      returns: v.any(),
      handler: async () => ({ success: true }),
    }),
  };
});

// Warm the mocked module once so concurrent first imports cannot race.
await import("../credentials");

beforeEach(() => {
  __resetEspnTeamListCache();
  for (const m of ["log", "warn", "error", "info"] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetEspnTeamListCache();
});

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("BSC selector labels", () => {
  test("a label with BSC's backslash is cleansed; its slug and the request are unchanged", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    // The second slug carries junk on purpose: a slug is a key BSC reads back,
    // so it must come out exactly as it went in.
    const junkSlug = "liga\\mexicana\u00AD-stickers";
    vi.stubGlobal("fetch", (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: String(init?.body ?? "") });
      return jsonResponse({
        aggregations: {
          setName: [
            { label: "2026 Panini Liga Mexicana de B\\eisbol Stickers", slug: "2026-panini-liga-mexicana-de-beisbol-stickers", count: 4 },
            { label: "Zero\u200Bwidth\u00ADSet", slug: junkSlug, count: 2 },
            { label: "\\", slug: "only-junk-label", count: 1 },
          ],
        },
      });
    }) as unknown as typeof fetch);

    const t = convexTest(schema, modules);
    const result = await t.withIdentity(ADMIN).action(api.adapters.buysportscards.fetchBscSelectorOptions, {
      level: "setName",
      parentFilters: { sport: "Baseball", year: "2026" },
      platformFilters: { sport: ["baseball"], year: ["2026"] },
    });

    expect(result.success).toBe(true);
    expect(result.options).toEqual([
      {
        value: "2026 Panini Liga Mexicana de Beisbol Stickers",
        platformValue: "2026-panini-liga-mexicana-de-beisbol-stickers",
      },
      { value: "ZerowidthSet", platformValue: junkSlug },
    ]);
    // The slug survives byte for byte (and the label that was only junk is
    // gone: an empty label is no option).
    expect(result.options[1].platformValue).toBe(junkSlug);
    expect(requests.length).toBeGreaterThan(0);
  });
});

describe("BSC checklist rows", () => {
  test("a player field with the backslash comes out cleansed; the card id is untouched", async () => {
    const cardId = "bsc\\id\u00AD-1";
    vi.stubGlobal("fetch", (async () =>
      jsonResponse([
        {
          id: cardId,
          cardNo: "12",
          players: "Wilmer R\\ios",
          setName: "topps-chrome",
          playerAttributeDesc: "VAR: Act\\ion shot",
        },
        {
          id: "bsc-2",
          cardNo: "13",
          players: "National League Leaders RBI (Wilmer R\\ios, Jos\\e Ram\\irez) LL",
          setName: "topps-chrome",
        },
      ])) as unknown as typeof fetch);

    const t = convexTest(schema, modules);
    const result = await t.withIdentity(ADMIN).action(api.adapters.buysportscards.fetchBscChecklist, {
      parentFilters: {},
      facetFilters: {
        sport: ["baseball"],
        year: ["2024"],
        setName: ["topps-chrome"],
        variant: ["parallel"],
        variantName: ["gold-refractor"],
      },
      sourceFacet: "variantName",
    });

    expect(result.success).toBe(true);
    const single = result.cards.find((c) => c.cardNumber === "12");
    expect(single).toMatchObject({
      cardName: "Wilmer Rios",
      players: ["Wilmer Rios"],
      cardVariation: "Action shot",
    });
    // The id is the marketplace's key: byte-identical.
    expect(single?.platformRef).toBe(cardId);

    const insert = result.cards.find((c) => c.cardNumber === "13");
    expect(insert?.players).toEqual(["Wilmer Rios", "Jose Ramirez"]);
    expect(insert?.cardName).toBe("National League Leaders RBI LL (Wilmer Rios / Jose Ramirez)");
    expect(insert?.platformRef).toBe("bsc-2");
  });

  test("parsePlayersField cleanses its input before it splits or reads a team-card suffix", () => {
    expect(parsePlayersField("Wilmer R\\ios")).toEqual({ players: ["Wilmer Rios"], teams: [] });
    expect(parsePlayersField("Kansas C\\ity Royals TC")).toEqual({
      players: ["Kansas City Royals"],
      teams: ["Kansas City Royals"],
    });
  });

  test("parseVariationDescription cleanses the text, and the marker is still read", () => {
    expect(parseVariationDescription("VAR: Act\\ion  shot")).toEqual({
      marker: "VAR",
      text: "Action shot",
      isVariety: true,
    });
    expect(parseVariationDescription("\\")).toBeUndefined();
  });
});

describe("BSC card-listing team value", () => {
  test("the raw and the split team are cleansed", async () => {
    vi.stubGlobal("fetch", (async () =>
      jsonResponse({ teamName: "Le\\on, Mexico C\\ity Red Devils" })) as unknown as typeof fetch);

    const { skipBscGateWaits } = await import("../../lib/testing/bsc-gate-stub");
    const restore = skipBscGateWaits();
    try {
      const t = convexTest(schema, modules);
      const result = await t.action(internal.adapters.buysportscards.fetchBscCardTeamNames, {
        bscCardIds: ["bsc-1"],
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        bscCardId: "bsc-1",
        rawTeamName: "Leon, Mexico City Red Devils",
        teamNames: ["Leon", "Mexico City Red Devils"],
      });
    } finally {
      restore();
    }
  });
});

describe("SportLots", () => {
  const slOptionsHtml = (rows: Array<[string, string]>) =>
    `<select name="sprt">${rows.map(([v, l]) => `<Option value="${v}">${l}`).join("\n")}</select>`;

  test("a selector label is cleansed; the option id is the same", async () => {
    vi.stubGlobal("fetch", (async () =>
      new Response(slOptionsHtml([["BB", "Base\\ball"], ["9\\1", "Hoc\u00ADkey"]]), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })) as unknown as typeof fetch);

    const t = convexTest(schema, modules);
    const result = await t.withIdentity(ADMIN).action(api.adapters.sportlots.fetchSportLotsSelectorOptions, {
      level: "sport",
      parentFilters: {},
    });

    expect(result.success).toBe(true);
    expect(result.options).toEqual([
      { value: "Baseball", platformValue: "BB" },
      { value: "Hockey", platformValue: "9\\1" },
    ]);
  });

  test("a set label (dealsets) is cleansed; the radio id is the same", async () => {
    vi.stubGlobal("fetch", (async () =>
      new Response(
        `<input type="radio" Name="selset" Value="12345"> </td> <td>1  Liga Mexicana de B\\eisbol</td>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      )) as unknown as typeof fetch);

    const t = convexTest(schema, modules);
    const result = await t.withIdentity(ADMIN).action(api.adapters.sportlots.fetchSportLotsSelectorOptions, {
      level: "insert",
      parentFilters: { sport: "Baseball", year: "2026", manufacturer: "Panini" },
      platformFilters: { sport: "BB", year: "2026", manufacturer: "1" },
    });

    expect(result.success).toBe(true);
    expect(result.options).toEqual([
      { value: "Liga Mexicana de Beisbol", platformValue: "12345" },
    ]);
  });

  test("a description with a backslash still parses, comes out cleansed, and platformRef is the raw text", async () => {
    const rawDescription = "2026 Topps #12 Wilmer R\\ios [ VAR Act\\ion ]";
    const html =
      `<td class="smallleft">12</td><td class="smallleft">${rawDescription}</td>` +
      `<td class="smallleft">13</td><td class="smallleft">2026 Topps #13 Jos\\e Ram\\irez|Wilmer R\\ios</td>`;
    vi.stubGlobal("fetch", (async (_url: string | URL | Request, init?: RequestInit) => {
      const start = Number(new URLSearchParams(String(init?.body ?? "")).get("start") ?? "1");
      return new Response(start === 1 ? html : "<html><table></table></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }) as unknown as typeof fetch);

    const t = convexTest(schema, modules);
    const result = await t.withIdentity(ADMIN).action(api.adapters.sportlots.fetchSportLotsChecklist, {
      parentFilters: {},
      platformFilters: { parallel: "309098" },
    });

    expect(result.success).toBe(true);
    const variation = result.cards.find((c) => c.cardNumber === "12");
    expect(variation).toMatchObject({
      isVariation: true,
      cardVariation: "Action",
    });
    expect(variation?.cardName).not.toContain("\\");
    expect(variation?.cardName).toContain("Wilmer Rios");
    expect(variation?.players).toEqual(["Wilmer Rios"]);
    // The identity keys are exactly what SportLots served.
    expect(variation?.platformRef).toBe(rawDescription);
    expect(variation?.sportlotsRef).toBe("12");

    const duo = result.cards.find((c) => c.cardNumber === "13");
    expect(duo?.players).toEqual(["Jose Ramirez", "Wilmer Rios"]);
    expect(duo?.platformRef).toBe("2026 Topps #13 Jos\\e Ram\\irez|Wilmer R\\ios");
  });
});

describe("ESPN", () => {
  const stubTeams = (teams: Array<Record<string, string>>) =>
    vi.stubGlobal("fetch", (async () =>
      jsonResponse({ sports: [{ leagues: [{ teams: teams.map((team) => ({ team })) }] }] })) as unknown as typeof fetch);

  test("displayName and location are cleansed before they are stored; id and colours are untouched", async () => {
    stubTeams([
      {
        id: "1\\9",
        displayName: "Washington Na\u200Btionals",
        location: "Wash\\ington",
        color: "0d2340",
        alternateColor: "ba122b",
      },
    ]);
    const list = await fetchEspnTeamList({ path: "baseball/mlb" });
    expect(list).toEqual([
      {
        id: "1\\9",
        displayName: "Washington Nationals",
        location: "Washington",
        color: "0d2340",
        alternateColor: "ba122b",
      },
    ]);
  });

  test("the team-name lookup folds both sides with the shared matcher", async () => {
    stubTeams([
      { id: "19", displayName: "Montréal Canadiens", location: "Montréal", color: "af1e2d", alternateColor: "192168" },
    ]);
    const hit = await fetchEspnTeamInfo({ path: "hockey/nhl", leagueName: "NHL" }, "Montreal  Canadiens");
    expect(hit).toMatchObject({ espnId: "19", location: "Montréal", league: "NHL" });
  });

  test("a name that folds to nothing finds no team", async () => {
    stubTeams([{ id: "19", displayName: "Montréal Canadiens", location: "Montréal" }]);
    for (const name of ["", "   ", "\\", "\u200B\u00AD", "...", "' \\ ."]) {
      expect(await fetchEspnTeamInfo({ path: "hockey/nhl", leagueName: "NHL" }, name), JSON.stringify(name)).toBeNull();
    }
  });

  test("two teams under one folded name find none (never the first in list order)", async () => {
    stubTeams([
      { id: "19", displayName: "Montréal Canadiens", location: "Montréal" },
      { id: "20", displayName: "Montreal  CANADIENS", location: "Montreal" },
      { id: "21", displayName: "Boston Bruins", location: "Boston" },
    ]);
    expect(await fetchEspnTeamInfo({ path: "hockey/nhl", leagueName: "NHL" }, "Montreal Canadiens")).toBeNull();
    // A name only one team carries still resolves.
    expect(await fetchEspnTeamInfo({ path: "hockey/nhl", leagueName: "NHL" }, "Boston Bruins")).toMatchObject({
      espnId: "21",
    });
  });

  test("no team under the folded name finds none", async () => {
    stubTeams([{ id: "19", displayName: "Montréal Canadiens", location: "Montréal" }]);
    expect(await fetchEspnTeamInfo({ path: "hockey/nhl", leagueName: "NHL" }, "Toronto Maple Leafs")).toBeNull();
  });
});

describe("Wikidata labels", () => {
  const SPORT: SportEnrichmentContext = {
    label: "Baseball",
    wikidata: { sportQid: "Q5369" },
  };

  test("a league's abbreviation and country label are cleansed; the QIDs are untouched", async () => {
    vi.stubGlobal("fetch", (async () =>
      jsonResponse({
        results: {
          bindings: [
            {
              shortName: { type: "literal", value: "LM\u200BB\\" },
              countryLabel: { type: "literal", value: "M\\exico" },
            },
          ],
        },
      })) as unknown as typeof fetch);

    const result = await lookupLeagueEnrichmentLive("Mexican League", "Q5369", "Q1901");

    expect(result).toMatchObject({
      wikidataId: "Q1901",
      abbreviation: "LMB",
      country: "Mexico",
    });
  });

  test("a label that is only junk is no label (never an empty abbreviation or country)", async () => {
    vi.stubGlobal("fetch", (async () =>
      jsonResponse({
        results: {
          bindings: [
            {
              shortName: { type: "literal", value: "\\\u200B" },
              countryLabel: { type: "literal", value: "\u00AD" },
            },
          ],
        },
      })) as unknown as typeof fetch);

    const result = await lookupLeagueEnrichmentLive("Mexican League", "Q5369", "Q1901");

    expect(result?.abbreviation).toBeUndefined();
    expect(result?.country).toBeUndefined();
  });

  test("a player's career-team labels and description are cleansed; the team QID is untouched", async () => {
    vi.stubGlobal("fetch", (async (_url: string | URL | Request, init?: RequestInit) => {
      const query = decodeURIComponent(String(_url)) + String(init?.body ?? "");
      if (query.includes("EntitySearch")) {
        return jsonResponse({
          results: { bindings: [{ player: { type: "uri", value: "http://www.wikidata.org/entity/Q42" } }] },
        });
      }
      return jsonResponse({
        results: {
          bindings: [
            {
              team: { type: "uri", value: "http://www.wikidata.org/entity/Q500" },
              teamLabel: { type: "literal", value: "Chicago Cu\\bs" },
              start: { type: "literal", value: "2010-01-01T00:00:00Z" },
              end: { type: "literal", value: "2015-01-01T00:00:00Z" },
              descr: { type: "literal", value: "American base\\ball\u200B player" },
            },
          ],
        },
      });
    }) as unknown as typeof fetch);

    const result = await lookupPlayerEnrichmentLive("Wilmer Rios", SPORT);

    expect(result?.description).toBe("American baseball player");
    expect(result?.careerTeams).toEqual([
      expect.objectContaining({ name: "Chicago Cubs", wikidataId: "Q500", fromYear: 2010, toYear: 2015 }),
    ]);
  });
});
