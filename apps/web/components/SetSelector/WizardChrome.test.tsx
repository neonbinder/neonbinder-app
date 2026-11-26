/**
 * NEO-335 Phase 2 — the shared "Tidy up …" header. NEO-497 — its title names
 * the set ("Tidy up 2024 Topps Chrome"), never with a trailing "Base".
 * NEO-467 — its only progress indicator is the bar.
 */
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import WizardChrome, {
  progressFraction,
  tidyUpTitle,
  tidyUpTitleFromChain,
  WIZARD_PROGRESS_LABEL,
  WIZARD_TITLE,
} from "./WizardChrome";
import { contrastRatio, tokenHex } from "../../src/theme/tokens";

/** The screen types the Tidy Up walk and other hosts put on the subtitle line. */
const STEP_SUBTITLE: Readonly<Record<string, string>> = {
  team: "New team",
  player: "New player",
  teams: "Cards with no team",
  titles: "Card titles",
  save: "Ready to save",
};

const fill = () => document.querySelector<HTMLElement>("[data-rail-fill]")!;
const bar = () => screen.getByRole("progressbar", { name: WIZARD_PROGRESS_LABEL });

describe("WizardChrome", () => {
  it("titles the screen 'Tidy up this set' by default and exposes the title by id", () => {
    render(<WizardChrome titleId="t-id" done={2} planned={12} subtitle="New team" />);
    const heading = screen.getByRole("heading", { name: WIZARD_TITLE });
    expect(WIZARD_TITLE).toBe("Tidy up this set");
    expect(heading.id).toBe("t-id");
  });

  it("shows the host's title, and lets a long one wrap", () => {
    const long = "Tidy up 2024 Topps Chrome Update Series Gold Wave Refractors";
    render(
      <WizardChrome titleId="t-id" title={long} done={2} planned={12} subtitle="New team" />,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toBe(long);
    expect(heading.id).toBe("t-id");
    expect(screen.queryByText(WIZARD_TITLE)).toBeNull();
    // Wraps (never truncates) and may shrink.
    expect(heading.className).toContain("min-w-0");
    expect(heading.className).toContain("wrap-anywhere");
    expect(heading.className).not.toContain("truncate");
  });

  it("clamps a long title to three lines visually, keeping the full text as its name and title", () => {
    const long =
      "Tidy up 2024 Topps Chrome Update Series Sapphire Edition Future Stars Gold Wave Refractors";
    render(
      <WizardChrome titleId="t-id" title={long} done={2} planned={12} subtitle="New team" />,
    );
    // The accessible name is the WHOLE title: the clamp is CSS only.
    const heading = screen.getByRole("heading", { level: 2, name: long });
    expect(heading.textContent).toBe(long);
    expect(heading.className).toMatch(/(^|\s)line-clamp-3(\s|$)/);
    expect(heading.getAttribute("title")).toBe(long);
  });

  it("is a 'Wizard progress' progressbar whose value text is the subtitle", () => {
    render(<WizardChrome done={3} planned={12} subtitle="Cards with no team" />);
    const progress = bar();
    expect(WIZARD_PROGRESS_LABEL).toBe("Wizard progress");
    expect(progress.getAttribute("aria-valuemin")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("100");
    expect(progress.getAttribute("aria-valuenow")).toBe("25");
    expect(progress.getAttribute("aria-valuetext")).toBe("Cards with no team");
    expect(fill().style.width).toBe("25.000%");
  });

  it("rounds the value to a whole percent", () => {
    render(<WizardChrome done={1} planned={3} subtitle="New player" />);
    expect(bar().getAttribute("aria-valuenow")).toBe("33");
  });

  it("has no step counter and no growth line; the subtitle is the only live region", () => {
    render(<WizardChrome done={3} planned={12} subtitle="New team" />);
    expect(screen.queryByText(/Step \d+ of \d+/)).toBeNull();
    // One polite status, and it is the subtitle: the bar and its percent never speak.
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0].textContent).toBe("New team");
    expect(bar().closest("[aria-live], [role=status]")).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("announces a step change: the status stays mounted and its text moves", () => {
    const { rerender } = render(<WizardChrome done={1} planned={4} subtitle="New team" />);
    const region = screen.getByRole("status");
    rerender(<WizardChrome done={2} planned={4} subtitle="Ready to save" />);
    // The same node, so a screen reader sees a text change rather than a new region.
    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent).toBe("Ready to save");
  });

  it("keeps the status mounted, empty, when there is no subtitle (the expired wizard)", () => {
    const { rerender } = render(<WizardChrome done={1} planned={4} subtitle="" />);
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");
    rerender(<WizardChrome done={1} planned={4} subtitle="New team" />);
    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent).toBe("New team");
  });

  it("paints the fill in the green text role, which meets 3:1 on the track in both themes", () => {
    render(<WizardChrome done={1} planned={2} subtitle="New team" />);
    expect(fill().className).toMatch(/(^|\s)bg-neon-green-text(\s|$)/);
    expect(fill().className).not.toMatch(/(^|\s)bg-neon-green(\s|$)/);
    // The bar's track is `bg-rule`. The bright fill (neon-green) is ~1.5:1 on it in light.
    expect(contrastRatio(tokenHex("neon-green", "light"), tokenHex("rule", "light"))).toBeLessThan(3);
    for (const mode of ["light", "dark"] as const) {
      expect({
        mode,
        ok: contrastRatio(tokenHex("neon-green-text", mode), tokenHex("rule", mode)) >= 3,
      }).toEqual({ mode, ok: true });
    }
    // Dark is unchanged: the text role is the fill itself.
    expect(tokenHex("neon-green-text", "dark")).toBe(tokenHex("neon-green", "dark"));
  });

  it("is empty with no plan, and drops the value text with no subtitle", () => {
    render(<WizardChrome done={0} planned={0} subtitle="" />);
    expect(bar().getAttribute("aria-valuenow")).toBe("0");
    expect(bar().hasAttribute("aria-valuetext")).toBe(false);
    expect(fill().style.width).toBe("0.000%");
    expect(progressFraction(2, 0)).toBe(0);
    expect(progressFraction(5, 4)).toBe(1);
  });

  it("is full when every planned step is done (the Save step)", () => {
    render(<WizardChrome done={7} planned={7} subtitle={STEP_SUBTITLE.save} />);
    expect(bar().getAttribute("aria-valuenow")).toBe("100");
    expect(bar().getAttribute("aria-valuetext")).toBe("Ready to save");
  });

  it.each(Object.entries(STEP_SUBTITLE))(
    "shows the %s subtitle on the line below",
    (_kind, subtitle) => {
      render(<WizardChrome done={1} planned={2} subtitle={subtitle} />);
      const line = screen.getByText(subtitle);
      const heading = screen.getByRole("heading", { name: WIZARD_TITLE });
      // DOCUMENT_POSITION_FOLLOWING: the subtitle comes after the title row.
      expect(heading.compareDocumentPosition(line) & 4).toBe(4);
      expect(line.tagName).not.toMatch(/^H\d$/);
    },
  );

  it("never moves back: a plan that grew, or a step back, holds the bar", () => {
    const { rerender } = render(<WizardChrome done={3} planned={10} subtitle="New player" />);
    expect(bar().getAttribute("aria-valuenow")).toBe("30");

    // The plan grew (3/12 = 25%): the bar stalls at 30.
    rerender(<WizardChrome done={3} planned={12} subtitle="New player" />);
    expect(bar().getAttribute("aria-valuenow")).toBe("30");
    expect(fill().style.width).toBe("30.000%");

    // Back a step: still 30.
    rerender(<WizardChrome done={2} planned={12} subtitle="New team" />);
    expect(bar().getAttribute("aria-valuenow")).toBe("30");
    // The value text still follows the step on screen.
    expect(bar().getAttribute("aria-valuetext")).toBe("New team");

    // Catching up past it moves it on again.
    rerender(<WizardChrome done={6} planned={12} subtitle="New player" />);
    expect(bar().getAttribute("aria-valuenow")).toBe("50");
  });

  it("animates the width only forward, and never under reduced motion", () => {
    const { rerender } = render(<WizardChrome done={1} planned={4} subtitle="New team" />);
    // First paint: nothing to animate from.
    expect(fill().className).toContain("transition-none");

    rerender(<WizardChrome done={2} planned={4} subtitle="New team" />);
    expect(fill().getAttribute("data-rail-forward")).toBe("true");
    expect(fill().className).toContain("transition-[width]");
    // Reduced motion switches the transition off.
    expect(fill().className).toContain("motion-reduce:transition-none");
  });

  it("shares the body's side padding, so the title and the cards have one left edge", () => {
    render(<WizardChrome titleId="t-id" done={1} planned={2} subtitle="2 cards left" />);
    const padded = screen.getByRole("heading", { level: 2 }).parentElement!;
    expect(padded.className).toContain("px-5");
    expect(padded.className).not.toContain("px-6");
  });

  it("renders children under the subtitle row", () => {
    render(
      <WizardChrome done={1} planned={2} subtitle="Cards with no team">
        <p>extra</p>
      </WizardChrome>,
    );
    expect(screen.getByText("extra")).toBeTruthy();
  });
});

void React;

describe("tidyUpTitle (NEO-497)", () => {
  it("joins year, set and variant after 'Tidy up'", () => {
    expect(tidyUpTitle({ year: "2026", setName: "Donruss", variant: "Unleashed" })).toBe(
      "Tidy up 2026 Donruss Unleashed",
    );
  });

  it("drops a trailing whole word 'Base', case-folded", () => {
    expect(tidyUpTitle({ year: "2026", setName: "Donruss Unleashed", variant: "Base" })).toBe(
      "Tidy up 2026 Donruss Unleashed",
    );
    expect(tidyUpTitle({ year: "2026", setName: "Donruss Unleashed", variant: "base" })).toBe(
      "Tidy up 2026 Donruss Unleashed",
    );
    expect(tidyUpTitle({ year: "2026", setName: "Donruss Unleashed", variant: "BASE " })).toBe(
      "Tidy up 2026 Donruss Unleashed",
    );
    // A set's own name ending in Base loses it too: the rule reads the joined name.
    expect(tidyUpTitle({ year: "2024", setName: "Topps Base" })).toBe("Tidy up 2024 Topps");
  });

  it("leaves 'Base' alone when it is not the last whole word", () => {
    expect(tidyUpTitle({ year: "2024", setName: "Topps Chrome", variant: "Baseball" })).toBe(
      "Tidy up 2024 Topps Chrome Baseball",
    );
    expect(tidyUpTitle({ year: "2024", setName: "Topps Chrome", variant: "Base Set Gold" })).toBe(
      "Tidy up 2024 Topps Chrome Base Set Gold",
    );
    expect(tidyUpTitle({ year: "2024", setName: "Topps Chrome", variant: "Rebase" })).toBe(
      "Tidy up 2024 Topps Chrome Rebase",
    );
  });

  it("falls back to 'Tidy up this set' when 'Base' is all there is", () => {
    expect(tidyUpTitle({ variant: "Base" })).toBe(WIZARD_TITLE);
    expect(tidyUpTitle({ year: " ", setName: "", variant: " base " })).toBe(WIZARD_TITLE);
  });

  it("skips the year when the set name already opens with it as its own word", () => {
    expect(tidyUpTitle({ year: "2024", setName: "2024 Topps Chrome", variant: "Refractor" })).toBe(
      "Tidy up 2024 Topps Chrome Refractor",
    );
    expect(tidyUpTitle({ year: " 2024 ", setName: "2024 Topps Chrome" })).toBe(
      "Tidy up 2024 Topps Chrome",
    );
    // A different season, or the year glued to another word, is not a repeat.
    expect(tidyUpTitle({ year: "2024", setName: "2024-25 Hoops" })).toBe(
      "Tidy up 2024 2024-25 Hoops",
    );
    expect(tidyUpTitle({ year: "2024", setName: "2023 Topps Chrome" })).toBe(
      "Tidy up 2024 2023 Topps Chrome",
    );
  });

  it("skips any part that is missing or blank", () => {
    expect(tidyUpTitle({ setName: "Donruss", variant: "Unleashed" })).toBe(
      "Tidy up Donruss Unleashed",
    );
    expect(tidyUpTitle({ year: "2026", setName: null, variant: "Gold" })).toBe("Tidy up 2026 Gold");
    expect(tidyUpTitle({ year: "  ", setName: " Donruss ", variant: "" })).toBe("Tidy up Donruss");
  });

  it("falls back to 'Tidy up this set' when nothing is known", () => {
    expect(tidyUpTitle({})).toBe(WIZARD_TITLE);
    expect(tidyUpTitle({ year: null, setName: undefined, variant: " " })).toBe(WIZARD_TITLE);
  });
});

describe("tidyUpTitleFromChain (NEO-497)", () => {
  const chain = [
    { level: "sport", value: "Baseball" },
    { level: "year", value: "2024" },
    { level: "manufacturer", value: "Topps" },
    { level: "setName", value: "Topps Chrome" },
  ];

  it("reads the year and set by level, never the manufacturer, and drops a Base leaf", () => {
    expect(tidyUpTitleFromChain([...chain, { level: "variantType", value: "Base" }])).toBe(
      "Tidy up 2024 Topps Chrome",
    );
  });

  it("names an insert under Insert by its own value, unchanged by the Base rule", () => {
    expect(
      tidyUpTitleFromChain([
        ...chain,
        { level: "variantType", value: "Insert" },
        { level: "insert", value: "Future Stars" },
      ]),
    ).toBe("Tidy up 2024 Topps Chrome Future Stars");
  });

  it("drops an insert-level Base leaf the same way (a Base row under Insert)", () => {
    expect(
      tidyUpTitleFromChain([
        ...chain,
        { level: "variantType", value: "Insert" },
        { level: "insert", value: "Base" },
      ]),
    ).toBe("Tidy up 2024 Topps Chrome");
  });

  it("names an insert leaf by its own value, never the variant type", () => {
    expect(
      tidyUpTitleFromChain([
        ...chain,
        { level: "variantType", value: "Parallel" },
        { level: "insert", value: "Gold Wave Refractors" },
      ]),
    ).toBe("Tidy up 2024 Topps Chrome Gold Wave Refractors");
  });

  it("names a parallel after its insert, never the variant type", () => {
    expect(
      tidyUpTitleFromChain([
        ...chain,
        { level: "variantType", value: "Insert" },
        { level: "insert", value: "Future Stars" },
        { level: "parallel", value: "Gold" },
      ]),
    ).toBe("Tidy up 2024 Topps Chrome Future Stars Gold");
  });

  it("leaves a parallel alone when its name already opens with its insert's", () => {
    const donruss = [
      { level: "sport", value: "Baseball" },
      { level: "year", value: "2026" },
      { level: "manufacturer", value: "Panini" },
      { level: "setName", value: "Donruss" },
      { level: "variantType", value: "Inserts" },
      { level: "insert", value: "Unleashed" },
    ];
    expect(tidyUpTitleFromChain([...donruss, { level: "parallel", value: "Unleashed Blue Ice" }])).toBe(
      "Tidy up 2026 Donruss Unleashed Blue Ice",
    );
    // Case-folded.
    expect(tidyUpTitleFromChain([...donruss, { level: "parallel", value: "unleashed Gold" }])).toBe(
      "Tidy up 2026 Donruss unleashed Gold",
    );
    // A token, not a substring: "Unleashedx" does not open with "Unleashed".
    expect(tidyUpTitleFromChain([...donruss, { level: "parallel", value: "Unleashedx" }])).toBe(
      "Tidy up 2026 Donruss Unleashed Unleashedx",
    );
  });

  it("does not say the year twice when the set's own name opens with it", () => {
    const yearInName = chain.map((row) =>
      row.level === "setName" ? { ...row, value: "2024 Topps Chrome" } : row,
    );
    expect(tidyUpTitleFromChain([...yearInName, { level: "variantType", value: "Base" }])).toBe(
      "Tidy up 2024 Topps Chrome",
    );
  });

  it("never names the set twice when the chain ends at the set", () => {
    expect(tidyUpTitleFromChain(chain)).toBe("Tidy up 2024 Topps Chrome");
  });

  it("is 'Tidy up this set' while the chain is loading or empty", () => {
    expect(tidyUpTitleFromChain(undefined)).toBe(WIZARD_TITLE);
    expect(tidyUpTitleFromChain(null)).toBe(WIZARD_TITLE);
    expect(tidyUpTitleFromChain([])).toBe(WIZARD_TITLE);
  });
});
