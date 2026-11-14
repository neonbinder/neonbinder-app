// Origin: .maestro/flows/set-selector/checklist-title-length-limits-and-fixer.yaml (Maestro suite retired in NEO-341; see git history)
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { setBuilderReady, drillToCustom } from "../../support/set-builder";
import { tidyUpName } from "../../support/wizard";

test(
  "Listing length limits — an over-long card title is refused, and an over-long variation is walked to a fix",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env, isMobile }) => {
    const id = env.ATTEMPT_ID;
    const num = `101-${id}`;
    const team = `TLF${env.ATTEMPT_TOKEN}`;
    const set = `tlf-${env.WORKER_INDEX}-${id}`;
    const edit = page.getByRole("button", { name: new RegExp(`^Edit card ${num}(, .*)?$`) });
    const cardName = page.getByRole("textbox", { name: "Card name" });
    const cardTitle = page.getByRole("textbox", { name: "Card title", exact: true });
    const attentionBadge = page.getByRole("img", {
      name: new RegExp(`^Card ${num}(, .*)? needs attention: variation text is over the 65-character limit$`),
    });
    const drawer = page.getByRole("dialog", { name: /^Card #/ });
    const generated = new RegExp(`^2024 Topps .*#${num} ${team} Baseball$`);
    const variationText = "Gold Refractor Image Variation Wearing Sunglasses Holding Bat In Dugout";

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // A hand-made Base insert under the real Baseball / 2024 / Topps.
    await drillToCustom(page, {
      sport: "Baseball",
      year: "2024",
      manufacturer: "Topps",
      set,
      variantType: "Insert",
      variant: "Base",
    });

    // ── A card with a brand-new team, so the generated title has a team in it ──
    await page.getByRole("button", { name: "Open add card form" }).click();
    await page.getByRole("textbox", { name: "Card number" }).fill(num);
    await cardName.fill(`TitleCap${env.ATTEMPT_TOKEN}`);
    await page.getByRole("button", { name: "Add team" }).click();
    const teamSearch = page.getByRole("textbox", { name: "Search teams" });
    await teamSearch.fill(team);
    await teamSearch.press("Enter");
    const newTeam = page.getByRole("dialog", { name: `New team: ${team}` });
    await expect(newTeam).toBeVisible();
    await expect(newTeam.getByRole("textbox", { name: "New team name" })).toHaveValue(team);
    await expectAccessible(page, { within: newTeam, label: "New team dialog" });
    await newTeam.getByRole("button", { name: `Create team ${team}` }).click();
    await expect(page.getByRole("button", { name: `Remove team ${team}` })).toBeVisible();
    // Focusing another field closes the team search.
    await cardName.click();
    await expect(page.getByRole("textbox", { name: "Search teams" })).toBeHidden();
    await page.getByRole("button", { name: "Submit new card" }).click();

    await edit.click();
    await expect(cardName).toBeVisible();

    // ── An over-long listing title is refused ──
    await expect(cardTitle).toBeVisible();
    await cardTitle.fill("NEO101PAD-EXTREMELY-LONG-LISTING-TITLE-SUFFIX-THAT-BLOWS-PAST-THE-EIGHTY-CHARACTER-CAP");
    await expect(page.getByText(/over the 80-character limit/)).toBeVisible();
    const shorten = page.getByText(/Shorten it before saving/);
    await expect(shorten).toBeVisible();
    await expectAccessible(page, { within: drawer, label: "Card detail drawer, over-long title refused" });

    await cardTitle.press("Enter");
    await expect(page.getByText(/Saved Card title/)).toBeHidden();
    await expect(cardName).toBeVisible();
    await expect(cardTitle).toHaveValue(/NEO101PAD/);
    await expect(shorten).toBeVisible();

    // Regenerating asks twice before it replaces typed text, then rebuilds it.
    const regenerate = page.getByRole("button", { name: "Regenerate card title" });
    await regenerate.click();
    await expect(page.getByText(/Regenerate again to replace the title you have typed/)).toBeVisible();
    await regenerate.click();
    await expect(cardTitle).not.toHaveValue(/NEO101PAD/);
    await expect(cardTitle).toHaveValue(generated);
    await expect(shorten).toBeHidden();

    // ── NEO-535: the title is ONE line in a wrapping field ──
    // A line break typed or pasted reads as a space, Enter still saves (it is
    // not a new line here), and the field wraps: on a phone an 80-character
    // title takes two lines or more, so none of it is cut off. (On a desktop
    // drawer 80 characters fit on one line, so its height proves nothing there.)
    const eighty = "Wrap check title ".repeat(5).slice(0, 80);
    expect(eighty).toHaveLength(80);
    await cardTitle.fill(eighty.replace(" Wrap", "\nWrap"));
    await expect(cardTitle).toHaveValue(eighty);
    if (isMobile) {
      const titleBox = await cardTitle.boundingBox();
      const nameBox = await cardName.boundingBox();
      if (!titleBox || !nameBox) throw new Error("the title and the card name fields must be measurable");
      expect(titleBox.height, "the title field wraps: taller than the one-line Card name input").toBeGreaterThan(
        nameBox.height * 1.3,
      );
    }
    await cardTitle.press("Enter");
    await expect(page.getByText(/Saved Card title/)).toBeVisible();
    await expect(cardTitle).toHaveValue(eighty);

    // ── NEO-535: Regenerate rebuilds the Description too, when it reads as the
    // builder's own ──
    // The facts already moved the builder's text along with every edit, so a
    // STALE builder text is made by hand here: the card's own description with
    // one fact line it does not have (a Rookie line). It still reads as the
    // builder's, so Regenerate rebuilds it (and says so); a description an
    // operator wrote in their own words is left alone.
    const description = drawer.getByRole("textbox", { name: "Card description", exact: true });
    const builtDescription = await description.inputValue();
    expect(builtDescription).toContain(`#${num}`);
    await description.fill(`${builtDescription}\nRookie Card (RC).`);
    await cardName.click(); // leaving the field saves it
    await expect(page.getByText(/Saved Card description/)).toBeVisible();
    await regenerate.click();
    await expect(cardTitle).toHaveValue(generated);
    await expect(description).toHaveValue(builtDescription);
    await expect(page.getByText(/Description rebuilt/).first()).toBeVisible();
    await expectAccessible(page, { within: drawer, label: "Card detail drawer, description rebuilt" });

    const handWritten = `Typed by hand for ${id}: not the builder's words.`;
    await description.fill(handWritten);
    await cardName.click();
    await expect(page.getByText(/Saved Card description/)).toBeVisible();
    await regenerate.click();
    // The next write the drawer makes (below) is queued behind Regenerate's
    // own, so once "Saved Variation" shows, a rebuild would have landed.
    const variation = page.getByRole("textbox", { name: "Card variation", exact: true });

    // ── An over-long variation is saved, but flagged ──
    await variation.fill(variationText);
    await expect(page.getByText(/a marketplace that caps this field will reject the value/)).toBeVisible();
    await expectAccessible(page, { within: drawer, label: "Card detail drawer, over-long variation warned" });
    await variation.press("Enter");
    await expect(page.getByText(/Saved Variation/)).toBeVisible();
    await expect(description).toHaveValue(handWritten);
    await expect(page.getByText(/Description rebuilt/)).toHaveCount(0);
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardName).toBeHidden();

    // ── NEO-535: a freshly opened card says what its title left out, and what
    // it was built from, with no Regenerate press ──
    await edit.click();
    await expect(cardName).toBeVisible();
    await expect(drawer.getByText(`Left out to fit: ${variationText}`)).toBeVisible();
    const builtFrom = drawer.getByRole("list", { name: "Title built from" });
    await expect(builtFrom.getByRole("listitem").filter({ hasText: `#${num}` })).toBeVisible();
    await expect(builtFrom.getByRole("listitem").filter({ hasText: team })).toBeVisible();
    // A plain card names no autograph, short print or parallel: none of those
    // is a chip (a chip would claim a fact the card does not have).
    await expect(builtFrom.getByRole("listitem").filter({ hasText: /^(Auto|Short print|Parallel)/ })).toHaveCount(0);
    await expectAccessible(page, { within: drawer, label: "Card detail drawer, opened with what the title left out" });
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardName).toBeHidden();

    // The row carries an attention badge, and the checklist counts it.
    await expect(attentionBadge).toBeVisible();
    // The header's amber pill (NEO-335): singular for one card, and its visible
    // text is its accessible name, so the exact name is the exact count.
    const pill = page.getByRole("button", { name: "1 needs you", exact: true });
    await expect(pill).toBeVisible();
    await expectAccessible(page, { label: "Checklist with an attention badge for an over-long variation" });

    // ── Walk it to a fix: opened by hand from the pill (the walker never opens itself) ──
    await pill.click();
    // NEO-497: named for the checklist it tidies (year and set; the checklist is
    // the Base row under Insert, and a Base checklist's title leaves "Base" out).
    const fixer = page.getByRole("dialog", { name: tidyUpName({ year: "2024", set }), exact: true });
    await expect(fixer).toBeVisible();
    // The walker and the wizard share title and counter; its own Skip control
    // says which this is, and the subtitle names the question.
    await expect(fixer.getByRole("button", { name: `Skip for now, card ${num}` })).toBeVisible();
    await expect(fixer.getByText("Step 1 of 1", { exact: true })).toBeVisible();
    await expect(fixer.getByText("Card titles", { exact: true })).toBeVisible();
    await expect(fixer.getByText("variation text is over the 65-character limit")).toBeVisible();
    await expect(fixer.getByRole("textbox", { name: `Card title for #${num}` })).toHaveValue(generated);
    await expectAccessible(page, { within: fixer, label: "Attention walker, over-long variation" });

    // NEO-535: the fixer's "Left out to fit" note, read from the field's text.
    // Regenerate builds the title with the saved variation in hand: it cannot
    // fit (71 characters) and is the one token left out, so the rebuilt title
    // equals the stored one and the note names the variation. Typing it back
    // takes the note off at once (the stale-note fix); Regenerate restores both.
    const fixerTitle = fixer.getByRole("textbox", { name: `Card title for #${num}` });
    const fixerRegenerate = fixer.getByRole("button", { name: "Regenerate card title" });
    const fixerLeftOut = fixer.getByText(/^Left out to fit: /);
    await fixerRegenerate.click();
    await expect(fixer.getByRole("list", { name: "Title built from" })).toBeVisible();
    await expect(fixerTitle).toHaveValue(generated);
    await expect(fixerLeftOut).toHaveText(`Left out to fit: ${variationText}`);
    await expectAccessible(page, { within: fixer, label: "Attention walker, variation left out of the title" });
    const rebuilt = await fixerTitle.inputValue();
    // A line break typed or pasted reads as a space (one line, NEO-535).
    await fixerTitle.fill(`${rebuilt}\n${variationText}`);
    await expect(fixerTitle).toHaveValue(`${rebuilt} ${variationText}`);
    await expect(fixerLeftOut).toHaveCount(0);
    await fixerRegenerate.click();
    await expect(fixer.getByText("Regenerate again to replace the title you have typed.")).toBeVisible();
    await fixerRegenerate.click();
    await expect(fixerTitle).toHaveValue(rebuilt);
    await expect(fixerLeftOut).toHaveText(`Left out to fit: ${variationText}`);

    await expect(fixer.getByRole("button", { name: /Save \(Enter\)/ })).toBeVisible();
    await fixer.getByRole("textbox", { name: `Card variation for #${num}` }).clear();
    await expect(fixer.getByText(/a marketplace that caps this field will reject the value/)).toBeHidden();
    await fixer.getByRole("button", { name: /Save \(Enter\)/ }).click();

    await expect(fixer.getByText(/All clear.*nothing on this checklist needs attention/)).toBeVisible();
    // No "fixed" count any more (NEO-335 Phase 2): the counter holds y of y, and
    // that the save WROTE is proved on the grid below, where the badge is gone.
    await expect(fixer.getByText("Step 1 of 1", { exact: true })).toBeVisible();
    await expectAccessible(page, { within: fixer, label: "Attention walker, all clear" });
    await fixer.getByRole("button", { name: /Done \(Esc\)/ }).click();
    await expect(fixer).toBeHidden();

    await expect(attentionBadge).toBeHidden();
    await expect(page.getByRole("button", { name: /^[0-9]+ needs? you$/ })).toBeHidden();
    await expect(page.getByText(`#${num}`, { exact: true })).toBeVisible();
  },
);
