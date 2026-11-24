/**
 * NEO-645 — what the card face at the top of the walk prints about the set,
 * read off the leaf's `getAncestorChain` (root first, the leaf last).
 *
 * The row does not carry these. The set is the `setName` row (not the
 * manufacturer), the season is the year row, and the variant kind is the NB
 * kind of the leaf: a variant type reads its own title (`variantTypeKind`,
 * NEO-334), an insert-level row under a Parallels type is a parallel, a
 * parallel-level row is a parallel. Never a marketplace value.
 */
import { variantTypeKind } from "../../../convex/variantRole";
import type { VariantKind } from "../../../app/collection/final/data/types";

type ChainRow = { level: string; value: string };

export type FaceHeader = {
  setName: string;
  season: string;
  variantName: string | null;
  variantKind: VariantKind;
};

export function faceHeaderFromChain(chain: ReadonlyArray<ChainRow> | null | undefined): FaceHeader {
  const rows = chain ?? [];
  const setName = rows.find((r) => r.level === "setName")?.value.trim() ?? "";
  const season = rows.find((r) => r.level === "year")?.value.trim() ?? "";
  const leaf = rows.at(-1);
  const type = rows.find((r) => r.level === "variantType");
  const typeKind = variantTypeKind(type);
  if (!leaf) return { setName, season, variantName: null, variantKind: "other" };
  if (leaf.level === "variantType") {
    const kind: VariantKind = typeKind ?? "other";
    return { setName, season, variantName: kind === "base" ? null : leaf.value.trim(), variantKind: kind };
  }
  if (leaf.level === "parallel") {
    return { setName, season, variantName: leaf.value.trim(), variantKind: "parallel" };
  }
  if (leaf.level === "insert") {
    return {
      setName,
      season,
      variantName: leaf.value.trim(),
      variantKind: typeKind === "parallel" ? "parallel" : "insert",
    };
  }
  return { setName, season, variantName: null, variantKind: "other" };
}
