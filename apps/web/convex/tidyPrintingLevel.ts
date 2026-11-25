/**
 * NEO-656 (D7) — "Apply to all": which leaves print the same names.
 *
 * A set's cards sit on its leaves: the Base on the Base variant type, an
 * insert's on the insert row, a parallel's on the parallel row. The parallels
 * are COPIES of the card they are built from (`parallelChecklistBuild`), so the
 * copies of one printing all carry the same names. This walks from the open
 * card's leaf UP to the row nothing is built from (`resolveBuildSource`, the one
 * function the parallel build uses), then DOWN the way `getParallelsForBuild`
 * lists them:
 *
 *   - an insert row: its `parallel`-level children;
 *   - the Base variant type: the `insert`-level rows of every Parallel-kind
 *     sibling variant type (the base parallels), and their `parallel` children;
 *   - NEO-673: a chosen source parallel (the insert a Parallel type with no
 *     Base copies from): its own `parallel` children, then the type's other
 *     `insert`-level rows and their `parallel` children.
 *
 * Nothing is stored; the leaf set is read once, when the operator clicks.
 */

import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  MAX_PARALLELS_PER_INSERT,
  MAX_VARIANT_TYPES_PER_SET,
  resolveBuildSource,
  sourceOfParallelType,
} from "./parallelChecklistBuild";
import { variantTypeKind } from "./variantRole";

/** The most leaves one Apply to all writes across. */
export const MAX_PRINTING_LEAVES = MAX_PARALLELS_PER_INSERT;

/** How many `resolveBuildSource` hops up are followed (a copy of a copy has two). */
const MAX_SOURCE_HOPS = 4;

type Row = Doc<"selectorOptions">;

async function childrenOf(
  ctx: Pick<QueryCtx, "db">,
  level: "insert" | "parallel",
  parentId: Id<"selectorOptions">,
): Promise<Row[]> {
  const found = await ctx.db
    .query("selectorOptions")
    .withIndex("by_level_and_parent", (q) => q.eq("level", level).eq("parentId", parentId))
    .take(MAX_PARALLELS_PER_INSERT);
  return found;
}

/**
 * The leaf ids that print what `leafId` prints: the root source, then its
 * copies. Always includes `leafId`. Capped at `MAX_PRINTING_LEAVES`.
 */
export async function printingLevelLeaves(
  ctx: Pick<QueryCtx, "db">,
  leafId: Id<"selectorOptions">,
): Promise<Array<Id<"selectorOptions">>> {
  const leaf = await ctx.db.get(leafId);
  if (!leaf) return [];

  // Up: the row nothing is built from.
  let root: Row = leaf;
  for (let hop = 0; hop < MAX_SOURCE_HOPS; hop++) {
    const resolved = await resolveBuildSource(ctx, root);
    if (resolved.status !== "ok") break;
    root = resolved.source;
  }

  // Down: the root, then its copies.
  const ids: Array<Id<"selectorOptions">> = [root._id];
  if (root.level === "insert") {
    for (const parallel of await childrenOf(ctx, "parallel", root._id)) ids.push(parallel._id);
    // NEO-673 — the insert the others copy from: so are its siblings.
    const type = root.parentId ? await ctx.db.get(root.parentId) : null;
    if (type && type.level === "variantType" && variantTypeKind(type) === "parallel") {
      const found = await sourceOfParallelType(ctx, type);
      if ("source" in found && found.kind === "chosenParallel" && found.source._id === root._id) {
        for (const insert of await childrenOf(ctx, "insert", type._id)) {
          if (insert._id === root._id) continue;
          ids.push(insert._id);
          for (const parallel of await childrenOf(ctx, "parallel", insert._id)) {
            ids.push(parallel._id);
          }
          if (ids.length >= MAX_PRINTING_LEAVES) break;
        }
      }
    }
  } else if (root.level === "variantType" && variantTypeKind(root) === "base" && root.parentId) {
    const setNameId = root.parentId;
    const siblings = await ctx.db
      .query("selectorOptions")
      .withIndex("by_level_and_parent", (q) =>
        q.eq("level", "variantType").eq("parentId", setNameId),
      )
      .take(MAX_VARIANT_TYPES_PER_SET);
    for (const type of siblings) {
      if (variantTypeKind(type) !== "parallel") continue;
      for (const insert of await childrenOf(ctx, "insert", type._id)) {
        ids.push(insert._id);
        for (const parallel of await childrenOf(ctx, "parallel", insert._id)) {
          ids.push(parallel._id);
        }
        if (ids.length >= MAX_PRINTING_LEAVES) break;
      }
      if (ids.length >= MAX_PRINTING_LEAVES) break;
    }
  }
  // The open card's own leaf is always in, even past the cap.
  const capped = ids.slice(0, MAX_PRINTING_LEAVES);
  if (!capped.includes(leafId)) capped.push(leafId);
  return capped;
}
