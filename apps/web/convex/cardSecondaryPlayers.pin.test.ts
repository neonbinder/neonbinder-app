/**
 * NEO-528 — one writer for a card's "Also pictured" players, the twin of
 * `cardTeamLinks.pin.test.ts`.
 *
 * `cardChecklist.secondaryPlayerIds` is the truth; `cardSecondaryPlayerLinks`
 * is the same fact stored flat so a smart binder's player walk has an index.
 * Two copies of one fact can disagree, and silently: a card written without
 * its rows never shows up in a cameo binder. And the field must stay out of
 * everything that reads a card's own players (listing titles, the sync diff,
 * entity review, team suggestions, collector search, the admin
 * cards-for-player list), so who READS it is pinned too.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const CONVEX_DIR = __dirname;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "_generated" || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
    out.push(full);
  }
  return out;
}

const read = (name: string) => readFileSync(join(CONVEX_DIR, name), "utf8");
const isFile = (file: string, name: string) => file.endsWith(join("convex", name));
const relative = (file: string) => file.split(`${join("apps", "web", "convex")}/`).pop()!;

/** The text of every `ctx.db.<method>(...)` call in `src`, matched to its closing paren. */
function dbCalls(src: string, method: "patch" | "insert" | "replace"): string[] {
  const out: string[] = [];
  const needle = `ctx.db.${method}(`;
  for (let at = src.indexOf(needle); at !== -1; at = src.indexOf(needle, at + 1)) {
    let depth = 0;
    let end = at + needle.length - 1;
    for (; end < src.length; end++) {
      const ch = src[end];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(at, end + 1));
  }
  return out;
}

describe("NEO-528: only cardSecondaryPlayers.ts writes the cameo list and its index", () => {
  test("no other module inserts into or queries cardSecondaryPlayerLinks, but the reset drain", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(CONVEX_DIR)) {
      if (isFile(file, "cardSecondaryPlayers.ts")) continue;
      const src = readFileSync(file, "utf8");
      if (/\.insert\(\s*"cardSecondaryPlayerLinks"/.test(src)) {
        offenders.push(`${file}: insert`);
        continue;
      }
      const queries = src.match(/query\(\s*"cardSecondaryPlayerLinks"/g) ?? [];
      if (queries.length === 0) continue;
      if (isFile(file, "selectorOptions.ts")) {
        const drain = src.indexOf("export const resetCardSecondaryPlayerLinksBatch");
        if (drain !== -1 && queries.length === 1 && src.indexOf('query("cardSecondaryPlayerLinks"') > drain) continue;
      }
      offenders.push(`${file}: query`);
    }
    expect(offenders).toEqual([]);
  });

  test("the module has one insert, inside setCardSecondaryPlayers", () => {
    const src = read("cardSecondaryPlayers.ts");
    expect(src.match(/ctx\.db\.insert\("cardSecondaryPlayerLinks"/g) ?? []).toHaveLength(1);
    const writer = src.slice(
      src.indexOf("export async function setCardSecondaryPlayers"),
      src.indexOf("export async function deleteCardSecondaryPlayerLinks"),
    );
    expect(writer).toContain('ctx.db.insert("cardSecondaryPlayerLinks"');
    expect(writer).toMatch(/ctx\.db\.patch\(card\._id, \{ secondaryPlayerIds:/);
  });

  test("no other module writes secondaryPlayerIds in a patch, insert or replace", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(CONVEX_DIR)) {
      if (isFile(file, "cardSecondaryPlayers.ts")) continue;
      const src = readFileSync(file, "utf8");
      for (const method of ["patch", "insert", "replace"] as const) {
        for (const call of dbCalls(src, method)) {
          if (/secondaryPlayerIds/.test(call)) offenders.push(`${relative(file)}: ${method}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("removeCardRow deletes a card's rows before the card, and nothing else calls the delete helper", () => {
    const helper = read("cardRowDelete.ts");
    const fn = helper.slice(helper.indexOf("export async function removeCardRow"));
    const indexDelete = fn.indexOf("deleteCardSecondaryPlayerLinks(ctx, card._id)");
    expect(indexDelete).toBeGreaterThan(0);
    expect(fn.indexOf("ctx.db.delete(card._id)")).toBeGreaterThan(indexDelete);
    const callers = sourceFiles(CONVEX_DIR).filter(
      (file) =>
        !isFile(file, "cardSecondaryPlayers.ts") &&
        !isFile(file, "cardRowDelete.ts") &&
        /deleteCardSecondaryPlayerLinks\(/.test(readFileSync(file, "utf8")),
    );
    expect(callers).toEqual([]);
  });

  test("a card born with cameos gets them in its insert literal and its index rows right after, through the writer", () => {
    // NEO-528 round 3 — the shared insert: the field comes from the writer's
    // born-with helper (never named here), and the index rows follow the
    // insert through `bornSecondaryPlayers`.
    const create = read("cardRowCreate.ts");
    const build = create.slice(
      create.indexOf("export function buildCardRowForInsert"),
      create.indexOf("export async function insertCardRow"),
    );
    expect(build).toContain("...bornSecondaryPlayerFields(card, cameos.map((c) => c.playerId)),");
    expect(build).toMatch(/generateListingDescription\(listingInputs, \{\s*cameoNames: cameos\.map/);
    const insert = create.slice(create.indexOf("export async function insertCardRow"));
    const inserted = insert.indexOf('ctx.db.insert("cardChecklist", row)');
    expect(inserted).toBeGreaterThan(0);
    expect(insert.indexOf("await bornSecondaryPlayers(ctx, id, row, names)")).toBeGreaterThan(inserted);

    // The parallel build hands each copy's cameos (its source's, then the
    // parallel's defaults) to that insert.
    const parallel = read("parallelChecklistBuild.ts");
    const insertAt = parallel.indexOf("const newId = await insertCardRow(");
    expect(insertAt).toBeGreaterThan(0);
    expect(parallel.slice(insertAt, insertAt + 1500)).toContain("cameos: born.cameos,");
    expect(parallel).not.toMatch(/setCardSecondaryPlayers\(/);

    // The commit chunk's insert branch does too.
    const commit = read("selectorOptions.ts");
    const chunk = commit.slice(commit.indexOf("export const commitCardChecklistChunk"));
    const chunkInsert = chunk.indexOf("const newCardId = await insertCardRow(");
    expect(chunkInsert).toBeGreaterThan(0);
    expect(chunk.slice(chunkInsert, chunkInsert + 1000)).toContain("cameos: born.cameos,");

    // `addCustomCard` inserts by hand: the field by the spread, the rows after.
    const add = commit.slice(commit.indexOf("export const addCustomCard"), commit.indexOf("export const updateCard"));
    const addInsert = add.indexOf('ctx.db.insert("cardChecklist", {');
    expect(addInsert).toBeGreaterThan(0);
    expect(add.indexOf("...cameoFields,")).toBeGreaterThan(addInsert);
    expect(add.indexOf("await bornSecondaryPlayers(")).toBeGreaterThan(addInsert);

    // Nobody else calls the born-with helpers.
    const callers = sourceFiles(CONVEX_DIR)
      .filter((file) => !isFile(file, "cardSecondaryPlayers.ts"))
      .filter((file) => /bornSecondaryPlayer(s|Fields)\(/.test(readFileSync(file, "utf8")))
      .map(relative)
      .sort();
    expect(callers).toEqual(["cardRowCreate.ts", "selectorOptions.ts"]);
  });
});

describe("NEO-528: the cameo list stays out of everything that reads a card's own players", () => {
  test("a re-sync never writes it: it is not one of the NB content fields the commit applies", () => {
    const src = read("selectorOptions.ts");
    const start = src.indexOf("const NB_CONTENT_FIELDS = [");
    const list = src.slice(start, src.indexOf("] as const;", start));
    expect(start).toBeGreaterThan(0);
    expect(list).toContain('"playerIds"');
    expect(list).not.toContain("secondaryPlayerIds");
  });

  test("only these modules mention the field", () => {
    // A new reader (a listing title, the sync diff, entity review, team
    // suggestions, player search) fails here, and has to make the case that
    // a cameo belongs in it.
    const readers = sourceFiles(CONVEX_DIR)
      .filter((file) => /secondaryPlayerIds/.test(readFileSync(file, "utf8")))
      .map(relative)
      .sort();
    expect(readers).toEqual(
      [
        "binderRules.ts",
        // NEO-528 round 2: the "Player on every card" add reads a card's
        // cameos to promote one; its cameo writes go through the writer.
        "cardPlayersBulk.ts",
        "cardSecondaryPlayers.ts",
        // NEO-528 round 3: the pure per-card planners read a card's cameos to
        // add the set-level defaults to them; they write nothing.
        "lib/cardPlayerDefaults.ts",
        "lib/catalogView.ts",
        "parallelChecklistBuild.ts",
        "schema.ts",
        "selectorOptions.ts",
      ].sort(),
    );
  });

  test("the listing TITLE never sees a cameo; only the description names them, from names it is handed", () => {
    // The title helpers never mention the field, so no title can be built
    // from it (the allowlist above already keeps them out; this says why).
    for (const name of ["storedCardTitle.ts", "features/generateListing.ts", "features/listingInputs.ts"]) {
      expect(read(name), name).not.toMatch(/secondaryPlayerIds/);
    }
    // The generator takes cameos as a separate argument of the DESCRIPTION
    // only; the title's inputs have no cameo field.
    const gen = read("features/generateListing.ts");
    const inputsType = gen.slice(gen.indexOf("export type ListingCardInputs"), gen.indexOf("\n};", gen.indexOf("export type ListingCardInputs")));
    expect(inputsType).not.toMatch(/cameo/i);
    const titleFn = gen.slice(gen.indexOf("export function assessListingTitle"), gen.indexOf("export function generateListingTitle"));
    expect(titleFn).not.toMatch(/cameo/i);
    expect(gen).toMatch(/export function generateListingDescription\(\s*inputs: ListingCardInputs,\s*extras: \{ cameoNames\?/);
  });

  test("every cameo write path refreshes the description through the writer (it is never written elsewhere from cameos)", () => {
    // The writer refreshes by default. Only the bulk player add opts out,
    // because it writes the description itself beside the player.
    const callers = sourceFiles(CONVEX_DIR)
      .filter((file) => !isFile(file, "cardSecondaryPlayers.ts"))
      .filter((file) => /description: "leave"/.test(readFileSync(file, "utf8")))
      .map(relative);
    expect(callers).toEqual(["cardPlayersBulk.ts"]);
    const bulk = read("cardPlayersBulk.ts");
    const fn = bulk.slice(bulk.indexOf("async function putPlayerOnCard"), bulk.indexOf("export async function runBulkPage"));
    expect(fn).toMatch(/listingDescription = generateListingDescription\(after\.inputs, \{\s*cameoNames:/);
  });

  test("the round-1 remove-from-checklist mutation and its target query are gone", () => {
    for (const file of sourceFiles(CONVEX_DIR)) {
      const src = readFileSync(file, "utf8");
      expect(src, relative(file)).not.toMatch(
        /removeSecondaryPlayerFromVariant|addSecondaryPlayerToVariant|secondaryPlayerBulkTargets/,
      );
    }
  });

  test("selectorOptions.ts names it once, in getCardChecklist's returns, for the Set Builder drawer", () => {
    const src = read("selectorOptions.ts");
    expect(src.match(/secondaryPlayerIds/g) ?? []).toHaveLength(1);
    const start = src.indexOf("export const getCardChecklist = query(");
    const handler = src.indexOf("handler:", start);
    const at = src.indexOf("secondaryPlayerIds");
    expect(at).toBeGreaterThan(start);
    expect(at).toBeLessThan(handler);
  });
});
