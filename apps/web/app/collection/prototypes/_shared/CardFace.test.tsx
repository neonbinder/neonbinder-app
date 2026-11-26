import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import CardFace, { signatureSize } from "./CardFace";
import type { Card } from "../../final/data/types";

/**
 * NEO-668 — an autograph card signs the player's name in a script face under
 * the initials, in one column, so the two can never overlap.
 */

afterEach(cleanup);

const SET = {
  id: "s1",
  year: 1990,
  season: "1990",
  name: "Score",
} as unknown as Card["set"];
const BASE = {
  id: "v1",
  kind: "base",
  name: null,
  order: 0,
} as unknown as Card["variant"];

const card = (over: Partial<Card> = {}): Card =>
  ({
    id: "c1",
    set: SET,
    variant: BASE,
    cardNumber: "1",
    players: [{ id: "p1", name: "Dan Marino" }],
    teams: [],
    printRun: null,
    features: [],
    cardVariation: null,
    isVariation: false,
    sortOrder: 1,
    finish: { kind: "standard" },
    ...over,
  }) as Card;

function face(c: Card) {
  const { container } = render(
    <Theme>
      <CardFace model={c} size="lg" />
    </Theme>,
  );
  return container;
}

const styleOf = (el: HTMLElement) => el.getAttribute("style") ?? "";
const signatures = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>("span")).filter((s) =>
    (s.getAttribute("style") ?? "").includes("Mrs Saint Delafield"),
  );

describe("an autograph card's face (NEO-668)", () => {
  it("signs the player's name under the initials, in one column with them", () => {
    const el = face(card({ features: ["AU"] }));
    const [sig] = signatures(el);
    expect(sig.textContent).toBe("Dan Marino");
    expect(styleOf(sig)).toContain("cursive");
    const group = sig.parentElement as HTMLElement;
    expect(group.className).toContain("flex-col");
    expect(group.firstElementChild?.textContent).toBe("DM");
    expect(group.lastElementChild).toBe(sig);
    // Drawn art only: the signed name never reaches the accessibility tree.
    expect(sig.closest("[aria-hidden='true']")).not.toBeNull();
    expect(el.querySelector("svg")).toBeNull();
  });

  it("leaves the card's accessible name as it was", () => {
    const el = face(card({ features: ["AU"] }));
    expect(el.querySelector("[role='img']")?.getAttribute("aria-label")).toBe(
      face(card()).querySelector("[role='img']")?.getAttribute("aria-label"),
    );
  });

  it("sizes the signature by the name's length", () => {
    expect(signatureSize("Dan Marino")).toBe(20);
    expect(signatureSize("Shai Gilgeous")).toBe(16);
    expect(signatureSize("Giannis Antetokounmpo")).toBe(13);
  });

  it("draws the squiggle under the initials when there is no name to sign", () => {
    const el = face(card({ features: ["AU"], players: [] }));
    expect(signatures(el)).toHaveLength(0);
    const svg = el.querySelector("svg") as SVGElement;
    expect((svg.parentElement as HTMLElement).className).toContain("flex-col");
  });

  it("a card that is not an autograph has no signature and keeps its centred initials", () => {
    const el = face(card());
    expect(signatures(el)).toHaveLength(0);
    expect(el.querySelector("svg")).toBeNull();
    expect(screenInitials(el).className).toContain(
      "absolute inset-0 flex items-center",
    );
  });
});

function screenInitials(el: HTMLElement): HTMLElement {
  return Array.from(el.querySelectorAll<HTMLElement>("span")).find(
    (s) => s.textContent === "DM",
  ) as HTMLElement;
}
