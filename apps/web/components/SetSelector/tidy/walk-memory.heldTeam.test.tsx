/**
 * NEO-656 — a team lookup that is asked again for the SAME key carries the
 * partial answer the walk already holds (ESPN's half), so `lookupTidyName`
 * overlays the new result on it instead of replacing it (NEO-301). The server
 * half is `wikidata.lookupTidyName.test.ts` (`withHeldTeamAnswer`).
 */
import { describe, expect, it, vi } from "vitest";
import { WalkMemory, type LookupRunner } from "./walk-memory";

const ESPN_HALF = { league: "MLB", location: "Washington", espnId: "20" };
const ids = { cardId: "c1" as never, sportId: "sport-1" as never };
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function runner(...results: Array<Awaited<ReturnType<LookupRunner>> | Error>) {
  const run = vi.fn<LookupRunner>();
  for (const result of results) {
    if (result instanceof Error) run.mockRejectedValueOnce(result);
    else run.mockResolvedValueOnce(result);
  }
  return run;
}

describe("WalkMemory.retry passes a held team answer", () => {
  it("sends the held ESPN half as heldEnrichment on the second ask, and not on the first", async () => {
    const m = new WalkMemory();
    const run = runner(
      { status: "ready", enrichment: ESPN_HALF },
      { status: "ready", enrichment: { ...ESPN_HALF, wikidataId: "Q1" } },
    );
    m.ask({ ...ids, kind: "team", name: "Nationals" }, run);
    await flush();
    expect(run.mock.calls[0][0]).not.toHaveProperty("heldEnrichment");

    m.retry({ ...ids, kind: "team", name: "Nationals" }, run);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toMatchObject({ kind: "team", name: "Nationals", heldEnrichment: ESPN_HALF });
    expect(m.lookupFor("c1", "team", "Nationals", "sport-1")?.enrichment).toEqual({
      ...ESPN_HALF,
      wikidataId: "Q1",
    });
  });

  it("keeps the held answer when the second try's call fails", async () => {
    const m = new WalkMemory();
    const run = runner({ status: "ready", enrichment: ESPN_HALF }, new Error("down"));
    m.ask({ ...ids, kind: "team", name: "Nationals" }, run);
    await flush();
    m.retry({ ...ids, kind: "team", name: "Nationals" }, run);
    await flush();
    expect(m.lookupFor("c1", "team", "Nationals", "sport-1")).toEqual({
      status: "ready",
      enrichment: ESPN_HALF,
    });
  });

  it("sends no heldEnrichment after an error (nothing is held), and none for a player", async () => {
    const m = new WalkMemory();
    const run = runner(
      { status: "error" },
      { status: "ready" },
      { status: "ready", enrichment: { wikidataId: "Q9" } },
      { status: "ready" },
    );
    m.ask({ ...ids, kind: "team", name: "Nationals" }, run);
    await flush();
    m.retry({ ...ids, kind: "team", name: "Nationals" }, run);
    await flush();
    expect(run.mock.calls[1][0]).not.toHaveProperty("heldEnrichment");

    m.ask({ ...ids, kind: "player", name: "Juan Soto" }, run);
    await flush();
    m.retry({ ...ids, kind: "player", name: "Juan Soto" }, run);
    await flush();
    expect(run.mock.calls[3][0]).not.toHaveProperty("heldEnrichment");
  });

  it("holds the answer per key: another sport's retry carries nothing", async () => {
    const m = new WalkMemory();
    const run = runner({ status: "ready", enrichment: ESPN_HALF }, { status: "ready" });
    m.ask({ ...ids, kind: "team", name: "Nationals" }, run);
    await flush();
    m.retry({ cardId: "c1" as never, sportId: "sport-2" as never, kind: "team", name: "Nationals" }, run);
    await flush();
    expect(run.mock.calls[1][0]).not.toHaveProperty("heldEnrichment");
  });
});
