/** NEO-645 — `rememberAliasesOnTeam`, the one writer behind "Remember as a name for this team". */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { rememberAliasesOnTeam } from "./rememberTeamAliases";
import { MAX_TEAM_ALIASES, MAX_TEAM_ALIAS_LENGTH } from "./teams";
import { addTeam, seedTidyWorld } from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

afterEach(() => vi.restoreAllMocks());

async function setup(extra: Record<string, unknown> = {}) {
  const t = convexTest(schema, modules);
  const teamId = await t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx);
    return addTeam(ctx, w, "Boston", "Red Sox", extra);
  });
  const remember = (names: string[]) =>
    t.run(async (ctx) => {
      const team = (await ctx.db.get(teamId))!;
      await rememberAliasesOnTeam(ctx, team, names, "test");
    });
  const aliases = async () => (await t.run((ctx) => ctx.db.get(teamId)))!.aliases ?? [];
  return { t, teamId: teamId as Id<"teams">, remember, aliases };
}

describe("rememberAliasesOnTeam", () => {
  test("adds a new alias", async () => {
    const { remember, aliases } = await setup();
    await remember(["BoSox"]);
    expect(await aliases()).toEqual(["BoSox"]);
  });

  test("does not duplicate an alias it already holds, nor the team's own name", async () => {
    const { remember, aliases } = await setup({ aliases: ["BoSox"] });
    await remember(["bosox", "  BoSox ", "Boston Red Sox"]);
    expect(await aliases()).toEqual(["BoSox"]);
  });

  test("a string over the length limit is skipped with a warning that omits the string", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { remember, aliases } = await setup();
    const long = "x".repeat(MAX_TEAM_ALIAS_LENGTH + 1);
    await remember([long, "BoSox"]);
    expect(await aliases()).toEqual(["BoSox"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain(long);
  });

  test("a team already at the cap takes no more and does not throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const full = Array.from({ length: MAX_TEAM_ALIASES }, (_, i) => `Nickname${String.fromCharCode(97 + (i % 26))}${"q".repeat(Math.floor(i / 26))}`);
    const { remember, aliases } = await setup({ aliases: full });
    await remember(["One More"]);
    expect(await aliases()).toHaveLength(MAX_TEAM_ALIASES);
    expect(await aliases()).not.toContain("One More");
    expect(warn).toHaveBeenCalled();
  });

  test("another team's primary name with no years is not remembered", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { t, remember, aliases } = await setup();
    await t.run(async (ctx) => {
      const sport = (await ctx.db.query("teams").first())!.sportId;
      await addTeam(ctx, { sport }, "Chicago", "Cubs");
    });
    await remember(["Chicago Cubs"]);
    expect(await aliases()).toEqual([]);
  });
});
