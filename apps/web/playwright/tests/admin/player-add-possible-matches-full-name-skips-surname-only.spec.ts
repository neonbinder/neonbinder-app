// NEO-578: a FULL player name's "Possible matches" never offers a player filed
// under the surname alone. "Jonah W<token>" is not the same man as a stored
// "W<token>", so that row is left out; a real close spelling ("J. W<token>")
// and the same-name row still show. A ONE-word name is unchanged (NEO-463): typing
// the surname alone still lists the fuller names and the surname row.
//
// WHERE: Player Management's add form (/admin/players), not the set builder's
// Tidy-up wizard. Both render the same NearMatchPanel from the same
// `players.nearMatches` query, which is where the rule lives. The wizard step
// opens only from a marketplace checklist fetch, whose names are real people
// (R7a); there a surname-only fixture would have to be a real surname that
// collides across attempts and with the NEO-463 fragment refusal, so a
// minted-name proof is only possible here.
//
// FIXTURE (through the product, no seed): three players in this worker's custom
// sport, all on ONE minted surname token. The custom sport has no Wikidata
// mapping, so no create here reaches a lookup (GUIDE "Enrichment fixtures").
// Created surname first: once a fuller name is on file, a bare surname create
// is refused as a fragment (NEO-463). Each create has no same-name match, so
// the form's primary stays `Create player <name>`. ATTEMPT_TOKEN is fresh per
// test and per project, so nothing here meets an earlier run's rows.
//
// NOT VACUOUS (R2): the full-name absence is asserted only after the panel has
// rendered its two expected rows (count pinned at 2, which an extra surname row
// breaks), and the same surname locator is then shown to MATCH (count 1) once
// the surname alone is typed, so it cannot be a locator that matches nothing.
//
// No Back step: the add form is not a URL view, and the Players screen selects
// with a replace, so Back is an exit from it (see the describe-each-player spec).
// No axe check: this is the Possible matches panel state the describe-each-player
// spec already checks, with fewer rows.
import { test, expect, LAUNCH_GATE } from "../../support/fixtures";
import { emptyListAndPickSport, expectPlayersLoaded } from "../../support/players";
import { customSport, drillToCustom, escapeRe, setBuilderReady } from "../../support/set-builder";

test(
  "Player Management — a full name's Possible matches never offer a surname-only player, while a close spelling still shows",
  { tag: ["@admin"] },
  async ({ page, signIn, env }) => {
    const sport = customSport(env);
    const surname = `W${env.ATTEMPT_TOKEN}`;
    const fullName = `Jonah ${surname}`;
    const initialled = `J. ${surname}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });
    // The worker's own custom sport (hand-made, idempotent), then the list.
    await drillToCustom(page, { sport });
    await page.goto("/admin/players");
    // A full page load pays the app launch and Clerk handshake again.
    await expectPlayersLoaded(page, LAUNCH_GATE);
    await emptyListAndPickSport(page, sport);

    const addButton = page.getByRole("button", { name: "Add player" });
    const newName = page.getByRole("textbox", { name: "New player name" });
    const addPlayer = async (name: string) => {
      await addButton.click();
      await expect(page.getByRole("heading", { name: "Add a player" })).toBeVisible();
      await newName.fill(name);
      await page.getByRole("button", { name: `Create player ${name}`, exact: true }).click();
      await expect(page.getByText(`Added ${name}.`)).toBeVisible();
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    };

    // ── FIXTURE: the surname-only player, a close spelling, the full name ──
    await addPlayer(surname);
    await addPlayer(initialled);
    await addPlayer(fullName);

    // ── THE FEATURE: type the full name into a fresh add form ──
    await addButton.click();
    await expect(page.getByRole("heading", { name: "Add a player" })).toBeVisible();
    await newName.fill(fullName);

    const panel = page.getByRole("list", { name: "Possible player matches" });
    // Every panel row's name starts "Open <name>", so this anchored pattern is
    // the surname-only row and no other ("Open J. W…", "Open Jonah W…" differ).
    const surnameOnlyRow = panel.getByRole("button", { name: new RegExp(`^Open ${escapeRe(surname)}\\b`) });

    // Positive anchors first: the same-name row and the close spelling.
    await expect(
      panel.getByRole("button", { name: `Open ${fullName} — same name`, exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole("button", { name: `Open ${initialled}`, exact: true })).toBeVisible();
    // Exactly those two: a surname-only row would make it three.
    await expect(panel.getByRole("listitem")).toHaveCount(2);
    await expect(surnameOnlyRow).toHaveCount(0);

    // ── ONE-WORD NAME UNCHANGED (NEO-463): the surname alone still lists the
    // fuller names, and the surname row the locator above looked for ──
    await newName.fill(surname);
    // The full name is now a close match (no "same name" tag): the new answer.
    await expect(panel.getByRole("button", { name: `Open ${fullName}`, exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: `Open ${initialled}`, exact: true })).toBeVisible();
    await expect(surnameOnlyRow).toHaveCount(1);
    await expect(surnameOnlyRow).toHaveAccessibleName(`Open ${surname} — same name`);
    await expect(panel.getByRole("listitem")).toHaveCount(3);
  },
);
