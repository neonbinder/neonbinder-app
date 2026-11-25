/**
 * NEO-673 — which parallel the others copy from, for a set with no Base.
 *
 * A Parallel variant type's base parallels are built from the set's Base
 * (`sourceOfParallelType`). A set with no Base (Pulse Premier) has nothing to
 * copy from until the operator names one of the type's own parallels (Silver).
 * The pick is stored on the Parallel variant type row (`parallelSourceId`) and
 * is read only while the set has zero Bases: a real Base always wins, and the
 * pick then stays stored but inert. The same mutation changes a pick.
 *
 * The mutation does not look for a Base and does not lock against a running
 * build: `insertParallelCardsPage` re-resolves the source on every page and
 * stops on `sourceMoved` when it changed.
 */
import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireAdmin } from "./auth";
import { variantTypeKind } from "./variantRole";

export const NOT_A_PARALLEL_TYPE =
  "That isn't a Parallel type, so there's nothing for it to copy from.";
export const PARALLEL_SOURCE_GONE =
  "That parallel is gone — it may have just been deleted.";
export const PARALLEL_SOURCE_NOT_HERE =
  "That parallel isn't under this Parallel type, so the others can't copy from it.";

export const setParallelTypeSource = mutation({
  args: {
    parallelTypeId: v.id("selectorOptions"),
    sourceId: v.id("selectorOptions"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const type = await ctx.db.get(args.parallelTypeId);
    if (
      !type ||
      type.level !== "variantType" ||
      variantTypeKind(type) !== "parallel"
    ) {
      throw new ConvexError(NOT_A_PARALLEL_TYPE);
    }
    const source = await ctx.db.get(args.sourceId);
    if (!source) throw new ConvexError(PARALLEL_SOURCE_GONE);
    if (source.level !== "insert" || source.parentId !== type._id) {
      throw new ConvexError(PARALLEL_SOURCE_NOT_HERE);
    }
    if (type.parallelSourceId !== source._id) {
      await ctx.db.patch(type._id, { parallelSourceId: source._id });
    }
    return null;
  },
});
