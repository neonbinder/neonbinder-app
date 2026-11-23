/**
 * NEO-92: unit tests for `convex/entityReviewQueue.ts` — the CRUD backing
 * the step-through "new players & teams" review wizard that replaced the
 * old single-screen `UnknownEntitiesDialog` checkbox list.
 *
 * Covers the public/internal surface directly (raw `ctx.db.insert` fixtures
 * for entityReviewQueue rows, per the minimal-fixture convention in
 * convex/featurePropagation.test.ts's `seedSubtree` — no need to route
 * through the real `fetchCardChecklist` action just to get rows into the
 * table):
 *   - startBatch: one row per name, resumes (doesn't delete/recreate) an
 *     in-progress batch, schedules the Wikidata pool enqueue
 *     (NEO-99: wikidataPool.enqueueEntityReviewLookups, not the removed
 *     per-batch processEntityReviewQueue chain).
 *   - getBatch: scoped correctly by (selectorOptionId, batchId).
 *   - recordDecision: patches `decision` on exactly the targeted row,
 *     including NEO-212's "skip" action and `excludedCareerTeamNames`.
 *   - recordAllRemainingAsSkip: NEO-212's bulk counterpart to
 *     recordAllRemainingAsCreate.
 *   - cancelBatch: deletes all rows for a batch, touches nothing else.
 *   - cleanupBatch: deletes all rows for a batch (same shape as cancelBatch,
 *     but internal — this is what commitCardChecklist schedules post-commit).
 *
 * Every PUBLIC function here (getBatch/recordDecision/cancelBatch) is
 * admin-gated via `requireAdmin`, matching every other public function in
 * selectorOptions.ts — tests call these through `asAdmin` (an identity with
 * `role: "admin"`). startBatch/getInternal/applyLookupResult/cleanupBatch
 * are internal (no client-reachable auth check), called via bare `t.mutation`.
 *
 * The pool work item `runEntityReviewLookup` (a single row's lookup + patch)
 * and `lookupPlayerEnrichment`/`lookupTeamEnrichment`'s pure-lookup behavior are
 * covered separately in convex/wikidataEntityReviewQueue.test.ts (that file
 * needs real Wikidata-shaped SPARQL fetch fixtures; this one only needs to
 * prove startBatch's scheduling WIRING, not the lookup's own behavior). The
 * actual `wikidataPool.enqueueAction` call cannot run under convex-test — the
 * workpool component is not mounted — so startBatch tests assert the SCHEDULED
 * enqueue rather than draining it (the same constraint the placeholder pool's
 * tests work under).
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { Id } from "./_generated/dataModel";
// NEO-294 — the bulk paths' page sizes, so a multi-page batch can be built
// from the real numbers rather than a hard-coded guess.
import {
  ENTITY_REVIEW_BULK_PAGE,
  ENTITY_REVIEW_DELETE_PAGE,
  ENTITY_REVIEW_START_OPS,
} from "./entityReviewQueue";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN_IDENTITY = {
  subject: "user_review_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|user_review_001",
  role: "admin",
};

async function seedSelectorOption(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"selectorOptions">> {
  return t.run(async (ctx) =>
    ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      sportConfig: {
        skuCode: "BB",
        league: "MLB",
        espn: { path: "baseball/mlb", leagueName: "Major League Baseball" },
        wikidata: { sportQid: "Q5369", hallOfFameQid: "Q1194380" },
      },
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    }),
  );
}

async function insertRow(
  t: ReturnType<typeof convexTest>,
  opts: {
    selectorOptionId: Id<"selectorOptions">;
    batchId: string;
    kind: "player" | "team";
    name: string;
    sportId: Id<"selectorOptions">;
    status?: "pending" | "ready" | "error";
    /** NEO-236: the bulk fast path reads `enrichment.location` to pre-fill. */
    enrichment?: Record<string, unknown>;
  },
) {
  return t.run(async (ctx) =>
    ctx.db.insert("entityReviewQueue", {
      selectorOptionId: opts.selectorOptionId,
      batchId: opts.batchId,
      createdByUserId: "user_review_001",
      kind: opts.kind,
      name: opts.name,
      sportId: opts.sportId,
      status: opts.status ?? "pending",
      ...(opts.enrichment ? { enrichment: opts.enrichment as never } : {}),
    }),
  );
}

/**
 * NEO-99: the "module:function" names of the currently-scheduled functions,
 * used to assert startBatch queued the Wikidata pool enqueue WITHOUT running it
 * (running it would reach `wikidataPool.enqueueAction`, which convex-test cannot
 * mount). Same technique as convex/placeholderWarmup.test.ts.
 */
const ENQUEUE_FN = "wikidataPool:enqueueEntityReviewLookups";

/**
 * NEO-221: the ARGUMENTS of every scheduled pool enqueue, in schedule order.
 * The resume path has to prove it enqueues the rows it ADDED and nothing else,
 * which the function name alone cannot show.
 */
async function scheduledEnqueueArgs(
  t: ReturnType<typeof convexTest>,
): Promise<Array<{ rowIds: Array<Id<"entityReviewQueue">> }>> {
  return t.run(async (ctx) => {
    const rows = await (
      ctx as unknown as {
        db: {
          system: {
            query: (n: string) => {
              collect: () => Promise<
                Array<{
                  name: string;
                  args: Array<{ rowIds: Array<Id<"entityReviewQueue">> }>;
                }>
              >;
            };
          };
        };
      }
    ).db.system.query("_scheduled_functions").collect();
    return rows.filter((r) => r.name === ENQUEUE_FN).map((r) => r.args[0]);
  });
}

/**
 * NEO-294 — the continuation `startBatch` schedules for itself when one
 * transaction's write budget runs out. Named here so the tests that drive the
 * chain by hand and the tests that assert a SHORT batch schedules nothing are
 * talking about the same thing.
 */
const START_BATCH_FN = "entityReviewQueue:startBatch";
/** NEO-294 — the tail `cancelBatch` / the sweep hand an oversized delete to. */
const CLEANUP_FN = "entityReviewQueue:cleanupBatch";

async function scheduledNames(
  t: ReturnType<typeof convexTest>,
): Promise<string[]> {
  return t.run(async (ctx) => {
    const rows = await (
      ctx as unknown as {
        db: {
          system: {
            query: (n: string) => { collect: () => Promise<Array<{ name: string }>> };
          };
        };
      }
    ).db.system.query("_scheduled_functions").collect();
    return rows.map((r) => r.name);
  });
}

// ===========================================================================
// startBatch
// ===========================================================================

describe("startBatch", () => {

  // =========================================================================
  // NEO-221 — resume RECONCILES the batch against the incoming names
  //
  // "Touch nothing" was right while the only way back into a resumed batch was
  // an identical re-fetch. NEO-220's "Back to matching" makes a second Confirm
  // with a DIFFERENT name set a normal thing to do, and a frozen batch would
  // then ask about names no card carries while never asking about the new
  // ones — leaving a real name with no decision, which is the failure the
  // whole ticket exists to remove.
  // =========================================================================

  test("resume stamps a surviving row's lastTouchedAt — re-entering a batch is proof of life", async () => {
    // What keeps the abandoned-batch sweep off a session an operator has just
    // come back to. Without it, a batch created 25 hours ago and resumed a
    // second ago would still read as abandoned.
    //
    // NEO-294 narrowed this from every surviving row to ONE of them — the
    // sweep spares a batch when ANY row is live, so the rest were writes that
    // proved nothing. The "exactly one" half of that contract is pinned in
    // "startBatch is bounded and resumable (NEO-294)" below; this test is
    // about the property that has always mattered, on a single-row batch where
    // the two statements coincide.
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);

    await t.mutation(internal.entityReviewQueue.startBatch, {
      selectorOptionId,
      createdByUserId: "user_review_001",
      sportId: selectorOptionId,
      playerNames: ["Mike Trout"],
      teamNames: [],
    });
    const before = await t.run(async (ctx) =>
      ctx.db.query("entityReviewQueue").collect(),
    );
    expect(before[0].lastTouchedAt).toBeUndefined();

    await t.mutation(internal.entityReviewQueue.startBatch, {
      selectorOptionId,
      createdByUserId: "user_review_001",
      sportId: selectorOptionId,
      playerNames: ["Mike Trout"],
      teamNames: [],
    });

    const after = await t.run(async (ctx) =>
      ctx.db.query("entityReviewQueue").collect(),
    );
    expect(after[0].lastTouchedAt).toBeGreaterThan(0);
  });

  test("resume with an unchanged name set inserts nothing and schedules nothing", async () => {
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);

    await t.mutation(internal.entityReviewQueue.startBatch, {
      selectorOptionId,
      createdByUserId: "user_review_001",
      sportId: selectorOptionId,
      playerNames: ["Mike Trout"],
      teamNames: ["New York Yankees"],
    });
    await t.mutation(internal.entityReviewQueue.startBatch, {
      selectorOptionId,
      createdByUserId: "user_review_001",
      sportId: selectorOptionId,
      playerNames: ["Mike Trout"],
      teamNames: ["New York Yankees"],
    });

    // Still exactly one enqueue: the original one. The common resume (a plain
    // page refresh) must stay as cheap as it was before reconciliation.
    expect(await scheduledEnqueueArgs(t)).toHaveLength(1);
  });

  test("scopes batches per user — two different users fetching the SAME selectorOptionId get separate, non-colliding batches", async () => {
    // Regression coverage for a real bug: concurrent CI workers (each a
    // distinct test user) fetching the same shared real marketplace set
    // used to resume/collide on ONE global batch keyed only by
    // selectorOptionId — causing a dropped Cancel tap (one user's commit
    // collapsed another's wizard footer mid-click) and a wrong-item-shown
    // wizard (one user's unknown name preempted another's in shared queue
    // order). Scoping by (selectorOptionId, createdByUserId) fixes both.
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);

    const batchIdForUserA = await t.mutation(internal.entityReviewQueue.startBatch, {
      selectorOptionId,
      createdByUserId: "user_a",
      sportId: selectorOptionId,
      playerNames: ["Mike Trout"],
      teamNames: [],
    });
    const batchIdForUserB = await t.mutation(internal.entityReviewQueue.startBatch, {
      selectorOptionId,
      createdByUserId: "user_b",
      sportId: selectorOptionId,
      playerNames: ["Aaron Judge"],
      teamNames: [],
    });

    expect(batchIdForUserB).not.toBe(batchIdForUserA);

    const rowsForUserA = await t.run(async (ctx) =>
      ctx.db
        .query("entityReviewQueue")
        .withIndex("by_selector_option_and_batch", (q) =>
          q.eq("selectorOptionId", selectorOptionId).eq("batchId", batchIdForUserA),
        )
        .collect(),
    );
    const rowsForUserB = await t.run(async (ctx) =>
      ctx.db
        .query("entityReviewQueue")
        .withIndex("by_selector_option_and_batch", (q) =>
          q.eq("selectorOptionId", selectorOptionId).eq("batchId", batchIdForUserB),
        )
        .collect(),
    );
    expect(rowsForUserA.map((r) => r.name)).toEqual(["Mike Trout"]);
    expect(rowsForUserB.map((r) => r.name)).toEqual(["Aaron Judge"]);

    // Each user resuming their own fetch gets their OWN batch back, not the
    // other user's.
    const resumedForUserA = await t.mutation(internal.entityReviewQueue.startBatch, {
      selectorOptionId,
      createdByUserId: "user_a",
      sportId: selectorOptionId,
      playerNames: ["Someone New"],
      teamNames: [],
    });
    expect(resumedForUserA).toBe(batchIdForUserA);
  });

  test("schedules the Wikidata pool enqueue for a non-empty name list", async () => {
    // NEO-99: startBatch hands the pending rows to the deployment-wide pool via
    // a scheduled `enqueueEntityReviewLookups` (which then drains them 5-wide),
    // rather than the old per-batch serial chain. The actual enqueue reaches the
    // workpool component and so cannot run under convex-test — the rows-leave-
    // pending behavior is proven directly on `runEntityReviewLookup` in
    // convex/wikidataEntityReviewQueue.test.ts. Here we assert the WIRING: the
    // enqueue is scheduled exactly once for a non-empty batch.
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);

    await t.mutation(internal.entityReviewQueue.startBatch, {
      selectorOptionId,
      createdByUserId: "user_review_001",
      sportId: selectorOptionId,
      playerNames: ["Mike Trout"],
      teamNames: [],
    });

    const scheduled = await scheduledNames(t);
    expect(scheduled.filter((n) => n === ENQUEUE_FN)).toHaveLength(1);
  });

});

// ===========================================================================
// getBatch
// ===========================================================================


// ===========================================================================
// recordDecision
// ===========================================================================


// ===========================================================================
// cancelBatch
// ===========================================================================

// ===========================================================================
// recordAllRemainingAsCreate
//
// NEO-110: this mutation had ZERO coverage, which is why a suspected bug here
// cost a full investigation to exonerate. CI run 30505189226 showed a bulk tap
// on a button reading "(3)" leaving the wizard at "1 of 3 reviewed", and the
// backend was the prime suspect. It was innocent — the tap had landed on "Add
// as New Player" after a reflow (see EntityReviewWizard.tsx's NEO-110 comment)
// — but nothing here proved that. These tests are that proof, kept permanently.
//
// The load-bearing property: this mutation decides every undecided SETTLED row
// in one transaction.
//
// NEO-221 changed the second half of that sentence. It used to decide rows
// whose Wikidata lookup was still in flight too; it now skips them. Deciding a
// `pending` row "create" throws its enrichment away — commit seeds the new
// player/team from `enrichment`, and `enqueueEnrichment` is creation-only, so
// there is no path back — which meant one bulk tap could mint dozens of
// permanently bare rows for players Wikidata knows perfectly well. The wizard
// re-calls this as lookups land, which is why the return value (rows decided
// by THIS call) matters more than it used to.
// ===========================================================================


// ===========================================================================
// recordAllRemainingAsSkip (NEO-212)
//
// The mirror image of the create fast path, for a set whose surfaced "new
// names" are mostly not entities at all (subset/parallel labels, checklist
// headers). Both mutations share one private `decideAllRemaining` helper, so
// these tests are as much about the two NOT drifting — same batch scoping,
// same already-decided rule, same count — as about skip itself.
// ===========================================================================


// ===========================================================================
// applyLookupResult — NEO-189 decided-row guard
// ===========================================================================

/**
 * The seed job's `commitCardChecklist` died on a Convex optimistic-concurrency
 * conflict: its prelude reads a whole `entityReviewQueue` batch, and stragglers
 * from the Wikidata pool kept patching those same rows through
 * `applyLookupResult` — on every internal retry, so the commit never won.
 *
 * convex-test runs mutations serially and therefore cannot reproduce a real OCC
 * conflict. So the fix is tested where it actually lives: the WRITER no longer
 * writes once the operator has ruled. (The bounded retry behind it is a plain
 * function, unit-tested in lib/errors/occ-retry.test.ts.)
 */
describe("applyLookupResult — decided-row guard (NEO-189)", () => {
  test("skips the patch entirely on a row that already carries a decision", async () => {
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);
    const id = await insertRow(t, {
      selectorOptionId, sportId: selectorOptionId, batchId: "b", kind: "player", name: "Decided", status: "pending",
    });
    await t.run(async (ctx) =>
      ctx.db.patch(id, { decision: { action: "create" } }),
    );

    // A straggler lookup lands after the operator hit "Add All Remaining".
    await t.mutation(internal.entityReviewQueue.applyLookupResult, {
      id,
      status: "ready",
      enrichment: { wikidataId: "Q42", isHallOfFame: true },
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    // No write happened at all — which is the point: a write here is what
    // invalidated the commit prelude's read set.
    expect(row!.status).toBe("pending");
    expect(row!.enrichment).toBeUndefined();
    expect(row!.decision).toEqual({ action: "create" });
  });

  test("skips the patch on a row decided 'skip' (NEO-212) as well as 'create'", async () => {
    // The guard branches on the PRESENCE of a decision, not its action, so
    // NEO-212's new action inherits it — asserted rather than assumed, since a
    // straggler lookup writing here is exactly what broke the seed commit.
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);
    const id = await insertRow(t, {
      selectorOptionId, sportId: selectorOptionId, batchId: "b", kind: "player", name: "Checklist", status: "pending",
    });
    await t.run(async (ctx) =>
      ctx.db.patch(id, { decision: { action: "skip" } }),
    );

    await t.mutation(internal.entityReviewQueue.applyLookupResult, {
      id,
      status: "ready",
      enrichment: { wikidataId: "Q42", isHallOfFame: true },
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.status).toBe("pending");
    expect(row!.enrichment).toBeUndefined();
    expect(row!.decision).toEqual({ action: "skip" });
  });

  test("does not downgrade a decided row that had already resolved", async () => {
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);
    const id = await insertRow(t, {
      selectorOptionId, sportId: selectorOptionId, batchId: "b", kind: "player", name: "Both", status: "ready",
    });
    await t.run(async (ctx) =>
      ctx.db.patch(id, {
        decision: { action: "create" },
        enrichment: { wikidataId: "Q1" },
      }),
    );

    await t.mutation(internal.entityReviewQueue.applyLookupResult, {
      id,
      status: "error",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.status).toBe("ready");
    expect(row!.enrichment?.wikidataId).toBe("Q1");
  });

  test("still patches an UNDECIDED pending row — the wizard depends on it", async () => {
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);
    const id = await insertRow(t, {
      selectorOptionId, sportId: selectorOptionId, batchId: "b", kind: "player", name: "Waiting", status: "pending",
    });

    await t.mutation(internal.entityReviewQueue.applyLookupResult, {
      id,
      status: "ready",
      enrichment: { wikidataId: "Q7", isHallOfFame: false },
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    // Undecided rows are the ones the wizard blocks on: the guard must not
    // touch them, or the review step never becomes reviewable.
    expect(row!.status).toBe("ready");
    expect(row!.enrichment?.wikidataId).toBe("Q7");
  });

  test("still resolves an UNDECIDED row whose lookup found nothing", async () => {
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);
    const id = await insertRow(t, {
      selectorOptionId, sportId: selectorOptionId, batchId: "b", kind: "team", name: "NoMatch", status: "pending",
    });

    await t.mutation(internal.entityReviewQueue.applyLookupResult, {
      id,
      status: "error",
    });

    expect((await t.run(async (ctx) => ctx.db.get(id)))!.status).toBe("error");
  });

  test("no-ops on a row a Cancel deleted while the lookup was draining", async () => {
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);
    const id = await insertRow(t, {
      selectorOptionId, sportId: selectorOptionId, batchId: "b", kind: "player", name: "Gone", status: "pending",
    });
    await t.run(async (ctx) => ctx.db.delete(id));

    await expect(
      t.mutation(internal.entityReviewQueue.applyLookupResult, {
        id,
        status: "ready",
      }),
    ).resolves.toBeNull();
  });
});


// ===========================================================================
// cleanupBatch
// ===========================================================================

describe("cleanupBatch", () => {

  test("no-ops cleanly when the batch has already been cleaned up (or never existed)", async () => {
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);

    await expect(
      t.mutation(internal.entityReviewQueue.cleanupBatch, {
        selectorOptionId,
        batchId: "never-existed",
      }),
    ).resolves.toBeNull();
  });
});

// ===========================================================================
// clearDecision (NEO-221)
//
// The other half of "an operator can change their mind". `recordDecision`
// already overwrites, which covers "I meant link, not create"; this puts a row
// back to being an open question, which is what the wizard's Back / decided
// list needs — the review UI only ever presents an UNDECIDED row.
// ===========================================================================


// ===========================================================================
// Per-session ownership (NEO-221)
//
// Batches are scoped per user on purpose (see startBatch and schema.ts): two
// admin sessions — or two Maestro CI workers, each a distinct admin test
// account — hold separate batches over the SAME set at once. `requireAdmin` is
// the real gate; these are the second layer, and they exist because a row id
// or batchId from the wrong session is far likelier to be a stale client than
// an attack, and either way silently overwriting a colleague's in-progress
// review is the wrong answer.
// ===========================================================================

// NEO-236 — the operator's Location + Name rides on the create decision
//
// A `teams` row born out of this queue is built from `decision.create` and
// nothing else; the prelude has no fallback to `row.name`. So what
// recordDecision stores here IS what gets created, and these tests pin the
// validation that stands between an operator's typing and a `teams` insert.
// ===========================================================================




// ===========================================================================
// NEO-236 security review, finding 3 — text the operator never typed must not
// be able to abort an action
//
// Two paths feed the Location + Name validator strings nobody chose: the bulk
// fast path pre-fills from `row.name`, a raw and unbounded marketplace string,
// and the wizard defaults each career-team pair to a raw Wikidata P54 label.
// Both are now fail-soft. Only the wizard's own two inputs still refuse, and
// they refuse readably.
// ===========================================================================


// ===========================================================================
// NEO-294 — the bulk fast paths are BOUNDED, resumable walks
//
// The whole-batch version died on CI run 35760682857's seed job: a real 2024
// Topps Chrome sync, 754 rows in the batch, 300 new players, and
// `recordAllRemainingAsCreate` hit Convex's per-transaction system-operation
// ceiling at "119 of 419 reviewed". The operator equivalent is worse than a
// red seed — a full afternoon of review that cannot be committed.
//
// So a call decides at most one page and says whether more remain. What these
// pin is everything that has to stay true once it does: the walk finishes,
// `hasMore` is honest, an interrupted run neither loses a decision nor records
// one twice, a small review is still one round trip, and nothing here disturbs
// the row a human decided one at a time.
// ===========================================================================

describe("bulk decide is bounded and resumable (NEO-294)", () => {
  /** Insert `count` settled player rows in ONE transaction. */
  async function seedRows(
    t: ReturnType<typeof convexTest>,
    selectorOptionId: Id<"selectorOptions">,
    batchId: string,
    count: number,
    kind: "player" | "team" = "player",
  ): Promise<Array<Id<"entityReviewQueue">>> {
    return t.run(async (ctx) => {
      const ids: Array<Id<"entityReviewQueue">> = [];
      for (let i = 0; i < count; i++) {
        ids.push(
          await ctx.db.insert("entityReviewQueue", {
            selectorOptionId,
            batchId,
            createdByUserId: "user_review_001",
            kind,
            name: `Rookie${i}`,
            sportId: selectorOptionId,
            status: "ready",
          }),
        );
      }
      return ids;
    });
  }

  /** One call of whichever path, with the optional cursor omitted when absent. */
  async function callBulk(
    t: ReturnType<typeof convexTest>,
    which: "create" | "skip",
    args: {
      selectorOptionId: Id<"selectorOptions">;
      batchId: string;
      cursor?: number;
    },
  ) {
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    return which === "create"
      ? await asAdmin.action(api.entityReviewQueue.recordAllRemainingAsCreate, args)
      : await asAdmin.action(api.entityReviewQueue.recordAllRemainingAsSkip, args);
  }

  /**
   * The client's walk, as `EntityReviewWizard.drainRemaining` performs it:
   * keep calling with the cursor the server returned until it says stop.
   */
  async function drainBulk(
    t: ReturnType<typeof convexTest>,
    which: "create" | "skip",
    selectorOptionId: Id<"selectorOptions">,
    batchId: string,
  ): Promise<{ calls: number; decided: number }> {
    let cursor: number | null = null;
    let calls = 0;
    let decided = 0;
    for (;;) {
      const result = await callBulk(t, which, {
        selectorOptionId,
        batchId,
        ...(cursor !== null ? { cursor } : {}),
      });
      calls += 1;
      decided += result.decided;
      if (!result.hasMore || result.cursor === null) return { calls, decided };
      cursor = result.cursor;
      // A walk that cannot terminate is the failure mode a cursor introduces;
      // fail loudly rather than hanging the suite.
      if (calls > 100) throw new Error("bulk walk did not terminate");
    }
  }

  async function decisionCount(
    t: ReturnType<typeof convexTest>,
    batchId: string,
  ): Promise<number> {
    return t.run(async (ctx) => {
      const rows = await ctx.db.query("entityReviewQueue").collect();
      return rows.filter((r) => r.batchId === batchId && r.decision).length;
    });
  }

  test("a cursor cannot reach another operator's batch", async () => {
    // The ownership check runs over the page before the first patch, so a
    // resumed call is gated exactly as the first one is.
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);
    await seedRows(t, selectorOptionId, "theirs", 4);
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("entityReviewQueue").collect()) {
        await ctx.db.patch(row._id, { createdByUserId: "user_someone_else" });
      }
    });

    await expect(
      callBulk(t, "create", { selectorOptionId, batchId: "theirs", cursor: 0 }),
    ).rejects.toThrow();
    expect(await decisionCount(t, "theirs")).toBe(0);
  });
});

// ===========================================================================
// NEO-294 — startBatch is bounded, and the bound costs nothing
//
// `startBatch` is the mutation the operator's Confirm blocks on. On the seed
// job's 2024 Topps Chrome sync it was handed 300 new player names and 30 team
// names, and Convex counts one system operation per CALL — so the fresh path
// spent ~930 before a single ambiguous name, and the RESUME path spent one
// WRITE PER EXISTING ROW (~755 on that batch) stamping `lastTouchedAt` before
// it considered a single new one.
//
// What these pin is the contract that replaced it: one transaction writes at
// most ENTITY_REVIEW_START_OPS operations' worth, the rest arrives on a
// continuation scheduled with identical arguments, and running that
// continuation converges — no name gets two rows, no decision is lost, and a
// short batch is still exactly one call that schedules nothing.
// ===========================================================================

describe("startBatch is bounded and resumable (NEO-294)", () => {
  /**
   * Operations one unambiguous player name costs: the two index reads
   * `sameNamePlayers` performs (`players` by name, `playerAliases` by alias)
   * plus the insert. Stated here rather than imported because the point of the
   * test is to build a batch that PROVABLY exceeds one page, and a helper that
   * derived the same number from the same source could agree with a bug.
   */
  const OPS_PER_NEW_PLAYER = 3;

  /** Enough distinct names that one transaction cannot afford them all. */
  function overflowingPlayerNames(): string[] {
    const count =
      Math.floor(ENTITY_REVIEW_START_OPS / OPS_PER_NEW_PLAYER) + 25;
    return Array.from({ length: count }, (_, i) => `Rookie Number${i}`);
  }

  async function rowsOf(
    t: ReturnType<typeof convexTest>,
    batchId: string,
  ): Promise<Array<{ name: string; kind: string; decision?: unknown }>> {
    return t.run(async (ctx) => {
      const rows = await ctx.db.query("entityReviewQueue").collect();
      return rows
        .filter((r) => r.batchId === batchId)
        .map((r) => ({ name: r.name, kind: r.kind, decision: r.decision }));
    });
  }

  /**
   * The continuation, run by hand.
   *
   * `startBatch` schedules ITSELF with identical arguments, so re-invoking it
   * with the same arguments IS the continuation — which is the whole reason it
   * needs no cursor. Driving it this way rather than draining the scheduler
   * keeps the Wikidata pool enqueue unrun; that one reaches the workpool
   * component, which convex-test cannot mount (see this file's header).
   */
  async function runStartBatch(
    t: ReturnType<typeof convexTest>,
    selectorOptionId: Id<"selectorOptions">,
    playerNames: string[],
    teamNames: string[] = [],
  ): Promise<string> {
    return t.mutation(internal.entityReviewQueue.startBatch, {
      selectorOptionId,
      createdByUserId: "user_review_001",
      sportId: selectorOptionId,
      playerNames,
      teamNames,
    });
  }

  test("a name list larger than one page writes a page, schedules itself, and converges", async () => {
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);
    const names = overflowingPlayerNames();

    const batchId = await runStartBatch(t, selectorOptionId, names);

    const afterFirst = await rowsOf(t, batchId);
    // The point: NOT all of them, in one transaction.
    expect(afterFirst.length).toBeGreaterThan(0);
    expect(afterFirst.length).toBeLessThan(names.length);
    expect(await scheduledNames(t)).toContain(START_BATCH_FN);

    // The continuation, and however many more it needs.
    let guard = 0;
    while ((await rowsOf(t, batchId)).length < names.length) {
      const resumed = await runStartBatch(t, selectorOptionId, names);
      // Same batch throughout — the client is already holding this id.
      expect(resumed).toBe(batchId);
      if (++guard > 20) throw new Error("startBatch chain did not converge");
    }

    const all = await rowsOf(t, batchId);
    expect(all).toHaveLength(names.length);
    // Exactly one row per name: the continuation re-runs the SAME reconciliation
    // and `existingKeys` suppresses everything the earlier page already wrote.
    expect(new Set(all.map((r) => r.name)).size).toBe(names.length);
  });

  test("the continuation it schedules is tagged with the batch it belongs to", async () => {
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);
    const names = overflowingPlayerNames();

    const batchId = await runStartBatch(t, selectorOptionId, names);

    const armed = await t.run(async (ctx) => {
      const rows = await (
        ctx as unknown as {
          db: {
            system: {
              query: (n: string) => {
                collect: () => Promise<
                  Array<{
                    name: string;
                    args: Array<{ continueBatchId?: string }>;
                  }>
                >;
              };
            };
          };
        }
      ).db.system.query("_scheduled_functions").collect();
      return rows
        .filter((r) => r.name === START_BATCH_FN)
        .map((r) => r.args[0].continueBatchId);
    });
    expect(armed).toEqual([batchId]);
  });

  test("a batch that fits in one page is one call and schedules no continuation", async () => {
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);

    const batchId = await runStartBatch(
      t,
      selectorOptionId,
      ["Mike Trout", "Aaron Judge"],
      ["Los Angeles Angels"],
    );

    expect(await rowsOf(t, batchId)).toHaveLength(3);
    // The Wikidata enqueue is scheduled; a continuation of this mutation is not.
    expect(await scheduledNames(t)).toContain(ENQUEUE_FN);
    expect(await scheduledNames(t)).not.toContain(START_BATCH_FN);
  });

  test("a truncated first page keeps every row it wrote — the chain is additive, never rolled back", async () => {
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);
    const names = overflowingPlayerNames();

    const batchId = await runStartBatch(t, selectorOptionId, names);
    const written = (await rowsOf(t, batchId)).map((r) => r.name).sort();
    expect(written.length).toBeGreaterThan(0);

    // The tab closes; the continuation never runs. Nothing is lost, and the
    // next Confirm (the same call, the same arguments) picks up where it
    // stopped rather than starting over.
    await runStartBatch(t, selectorOptionId, names);
    const after = (await rowsOf(t, batchId)).map((r) => r.name);
    for (const name of written) expect(after).toContain(name);
    expect(new Set(after).size).toBe(after.length);
  });

  test("a resume stamps ONE row, not one per row in the batch", async () => {
    // The write that used to dominate the resume path: 754 patches proving
    // something the sweep only needs one row to know. See the sweep's own test
    // file for the rule this relies on — ANY live row spares the batch.
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);
    const names = ["Mike Trout", "Aaron Judge", "Shohei Ohtani"];

    const batchId = await runStartBatch(t, selectorOptionId, names);
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.query("entityReviewQueue").collect()).filter(
          (r) => r.lastTouchedAt !== undefined,
        ).length,
      ),
    ).toBe(0);

    await runStartBatch(t, selectorOptionId, names);

    const stamped = await t.run(async (ctx) =>
      (await ctx.db.query("entityReviewQueue").collect()).filter(
        (r) => r.batchId === batchId && r.lastTouchedAt !== undefined,
      ),
    );
    expect(stamped).toHaveLength(1);
    expect(stamped[0].lastTouchedAt).toBeGreaterThan(0);
  });

});

// ===========================================================================
// NEO-294 — deleting a batch is bounded too
//
// Cancel read the whole batch, checked ownership over it, re-read it and then
// deleted it row by row: ~2,300 system operations on the seed job's 754-row
// review, behind a button. The read is now a page, the rows it read are handed
// straight to the delete rather than fetched twice, and anything behind the
// page is a scheduled `cleanupBatch` that chains until the batch is gone.
// ===========================================================================

describe("batch deletion is bounded and chains (NEO-294)", () => {
  /** Insert `count` rows of one batch in ONE transaction. */
  async function seedBatch(
    t: ReturnType<typeof convexTest>,
    selectorOptionId: Id<"selectorOptions">,
    batchId: string,
    count: number,
    createdByUserId = "user_review_001",
  ): Promise<void> {
    await t.run(async (ctx) => {
      for (let i = 0; i < count; i++) {
        await ctx.db.insert("entityReviewQueue", {
          selectorOptionId,
          batchId,
          createdByUserId,
          kind: "player",
          name: `Rookie${i}`,
          sportId: selectorOptionId,
          status: "ready",
        });
      }
    });
  }

  async function remaining(
    t: ReturnType<typeof convexTest>,
    batchId: string,
  ): Promise<number> {
    return t.run(async (ctx) =>
      (await ctx.db.query("entityReviewQueue").collect()).filter(
        (r) => r.batchId === batchId,
      ).length,
    );
  }

  test("cleanupBatch chains itself while rows remain", async () => {
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedSelectorOption(t);
    await seedBatch(t, selectorOptionId, "chain", ENTITY_REVIEW_DELETE_PAGE + 1);

    await t.mutation(internal.entityReviewQueue.cleanupBatch, {
      selectorOptionId,
      batchId: "chain",
    });

    expect(await remaining(t, "chain")).toBe(1);
    expect(await scheduledNames(t)).toContain(CLEANUP_FN);
  });

});
