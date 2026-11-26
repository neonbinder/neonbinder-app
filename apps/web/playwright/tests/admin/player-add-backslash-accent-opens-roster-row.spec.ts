// NEO-643 (R1): a name typed the way BuySportsCards writes an accent, with a
// backslash in the accent's place ("Ronald Acu\na Jr." for Acuña), finds the
// roster player written with the accent: the add form's primary button becomes
// "Open <roster name>", creation is demoted to "Create … anyway", and Open
// lands on the existing row. READ-ONLY.
//
// Why it proves the change: before NEO-643 the identity key turned the
// backslash into a separator ("acu a jr ronald"), so the two spellings keyed
// apart and the form offered to create a second Acuña. The shared fold
// (`foldNameText`, lib/entities/normalize-name.ts) now DELETES the backslash and
// folds the accent, so both spellings key "acuna jr ronald" and the near match
// is "exact" (the only state that swaps the buttons).
//
// DATA DEPENDENCY: the roster row comes from the reference catalogue every
// preview loads before setup, spelled WITH the accent ("Ronald Acuña Jr.",
// probed 2026-11-21: the only Ronald Acuña on file, and no unaccented
// "Acuna" row exists). STEP 1 asserts that row exists and carries the accent
// (a row spelled "Acuna" would match on the old fold too and prove less). If
// the catalogue respells or drops him, STEP 1 fails by name: swap to another
// accented catalogue player, checking the seed rather than guessing.
// Sibling: player-add-spaced-initials-opens-roster-row.spec.ts (NEO-322, the
// same proof for initials).
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { emptyListAndPickSport, expectPlayersLoaded } from "../../support/players";

/** The catalogue's spelling. */
const ROSTER = "Ronald Acuña Jr.";
/** BSC's spelling: the accented letter replaced by a backslash (BSC sends "Wilmer R\ios" for Ríos). */
const TYPED = "Ronald Acu\\na Jr.";

test(
  "Player Management — a name with a backslash for its accent finds the roster player written with the accent",
  { tag: ["@admin"] },
  async ({ page, signIn }) => {
    // The typed spelling really holds a backslash and no accent (a bad escape would make this vacuous).
    expect(TYPED).toContain("\\");
    expect(TYPED).not.toContain("ñ");

    await signIn("/admin/players");
    await expectPlayersLoaded(page, LAUNCH_GATE);

    // STEP 1, precondition: the roster row exists and is spelled WITH the accent.
    await page.getByLabel("Filter players").fill("Acuña");
    await expect(page.getByRole("button", { name: /^Ronald Acuña Jr\./ }).first()).toBeVisible();

    // STEP 2: empty the list, pick Baseball, open the add form.
    await emptyListAndPickSport(page, "Baseball");
    await page.getByRole("button", { name: "Add player" }).click();
    await expect(page.getByRole("heading", { name: "Add a player" })).toBeVisible();

    // BSC's spelling, which no row carries.
    await page.getByLabel("New player name").fill(TYPED);

    // STEP 3, the feature: the demoted control exists only when the keys are equal
    // ("exact" near match); creation is no longer the primary.
    await expect(page.getByRole("button", { name: `Create player ${TYPED} anyway`, exact: true })).toBeVisible();
    const open = page.getByRole("button", { name: `Open ${ROSTER}`, exact: true });
    await expect(open).toBeVisible();
    await expect(page.getByRole("button", { name: `Create player ${TYPED}`, exact: true })).toBeHidden();
    await expectAccessible(page, { label: "Player Management, add form matching a backslash spelling" });

    // STEP 4: Open lands on the existing roster row (the accented spelling), not on a typed-spelling row.
    await open.click();
    await expect(page.getByRole("heading", { name: ROSTER, exact: true })).toBeVisible();
    await expect(page.getByText("Sport: Baseball").first()).toBeVisible();
  },
);
