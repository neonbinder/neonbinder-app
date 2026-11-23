import { getFunctionName } from "convex/server";
import { describe, expect, test } from "vitest";
import crons from "./crons";
import { internal } from "./_generated/api";

// NEO-370: the sales poll is what turns a marketplace order into a removed
// box copy (BuySportsCards, and eBay since NEO-415). A rename or a dropped
// registration would stop it silently.
describe("crons", () => {
  test("polls marketplace sales every 15 minutes through listingSales.pollAll", () => {
    const job = crons.crons["poll marketplace sales"];
    expect(job).toBeDefined();
    expect(job.schedule).toEqual({ type: "interval", minutes: 15 });
    expect(getFunctionName(job.name)).toBe(
      getFunctionName(internal.listingSales.pollAll),
    );
    expect(job.args).toEqual([{}]);
  });
});

// NEO-645: a name lookup's output is working state; without the reaper it
// would be kept forever.
describe("crons: tidy name lookups", () => {
  test("forgets expired name lookup output hourly through tidyNames.sweepExpiredLookupOutput", () => {
    const job = crons.crons["forget expired name lookup output"];
    expect(job).toBeDefined();
    expect(job.schedule).toEqual({ type: "interval", hours: 1 });
    expect(getFunctionName(job.name)).toBe(
      getFunctionName(internal.tidyNames.sweepExpiredLookupOutput),
    );
    expect(job.args).toEqual([{}]);
  });
});
