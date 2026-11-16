import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@clerk/clerk-react", () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: false }) }));
vi.mock("convex/react", () => ({}));

import { cameoNames, cameoPhrase, cameosOn } from "./cameo";
import { CameoTag } from "./CameoTag";
import { AlsoPicturedRow } from "./CardDetail";
import { describeSmartRule, withCameoOption } from "./binders/RuleBuilder";
import type { SmartRule } from "./data/types";

/**
 * NEO-528 — the cameo's words, its list-row tag and the card detail's "Also
 * pictured" line. The collector never reads "secondary".
 */

afterEach(cleanup);

const MARINO = { id: "p-marino", name: "Dan Marino" };
const DUPER = { id: "p-duper", name: "Mark Duper" };

const playerRule = (ids: string[], over: Partial<SmartRule> = {}): SmartRule => ({
  version: 1,
  match: "all",
  terms: [{ test: { kind: "player", playerIds: ids } }],
  ...over,
});

describe("cameoNames: who makes the cameo", () => {
  it("names the pictured players the rule names, not every one pictured", () => {
    expect(cameoNames({ secondaryPlayers: [DUPER, MARINO] }, playerRule([MARINO.id]))).toEqual(["Dan Marino"]);
  });

  it("names every pictured player when the rule names none of them (a Hall of Famers line)", () => {
    const hof: SmartRule = { version: 1, match: "all", terms: [{ test: { kind: "hallOfFame" } }] };
    expect(cameoNames({ secondaryPlayers: [MARINO, DUPER] }, hof)).toEqual(["Dan Marino", "Mark Duper"]);
  });

  it("ignores a player the rule leaves out", () => {
    const rule: SmartRule = {
      version: 1,
      match: "all",
      terms: [{ negate: true, test: { kind: "player", playerIds: [DUPER.id] } }, { test: { kind: "hallOfFame" } }],
    };
    expect(cameoNames({ secondaryPlayers: [DUPER, MARINO] }, rule)).toEqual(["Mark Duper", "Dan Marino"]);
  });

  it("is empty while the card's pictured players are unknown", () => {
    expect(cameoNames({}, playerRule([MARINO.id]))).toEqual([]);
  });
});

describe("cameoPhrase", () => {
  it("says who, one or many", () => {
    expect(cameoPhrase(["Dan Marino"])).toBe("Dan Marino is a cameo on this card");
    expect(cameoPhrase(["Dan Marino", "Mark Duper"])).toBe("Dan Marino and Mark Duper are cameos on this card");
    expect(cameoPhrase(["A", "B", "C"])).toBe("A, B and C are cameos on this card");
  });

  it("still says cameo when no one is known yet", () => {
    expect(cameoPhrase([])).toBe("a cameo card");
  });
});

describe("the rule's cameo option", () => {
  it("is on only when the rule says so", () => {
    expect(cameosOn(playerRule([MARINO.id], { secondaryPlayers: true }))).toBe(true);
    expect(cameosOn(playerRule([MARINO.id]))).toBe(false);
    expect(cameosOn(undefined)).toBe(false);
  });

  it("is dropped from a draft once no line could use it, kept while one can", () => {
    const on = playerRule([MARINO.id], { secondaryPlayers: true });
    expect(withCameoOption(on)).toBe(on);
    const teamOnly: SmartRule = {
      version: 1,
      match: "all",
      terms: [{ test: { kind: "team", teamIds: ["t1"] } }],
      secondaryPlayers: true,
    };
    expect(withCameoOption(teamOnly)).toEqual({ version: 1, match: "all", terms: [{ test: { kind: "team", teamIds: ["t1"] } }] });
    const leftOut: SmartRule = { ...on, terms: [{ negate: true, test: { kind: "player", playerIds: [MARINO.id] } }] };
    expect(withCameoOption(leftOut).secondaryPlayers).toBeUndefined();
  });

  it("is said in the rule's words only when it can do something", () => {
    const names = { [MARINO.id]: "Dan Marino" };
    expect(describeSmartRule(playerRule([MARINO.id], { secondaryPlayers: true }), names)).toBe(
      "Dan Marino, cameos included",
    );
    expect(describeSmartRule(playerRule([MARINO.id]), names)).toBe("Dan Marino");
    const teamOnly: SmartRule = {
      version: 1,
      match: "all",
      terms: [{ test: { kind: "team", teamIds: ["t1"] } }],
      secondaryPlayers: true,
    };
    expect(describeSmartRule(teamOnly, { t1: "Dolphins" })).toBe("Dolphins on the card");
  });
});

describe("CameoTag on a list row", () => {
  it("shows the word and the brooch, and tells a screen reader who", () => {
    render(<CameoTag names={["Dan Marino"]} />);
    const word = screen.getByText("Cameo");
    expect(word.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("Dan Marino is a cameo on this card").className).toContain("sr-only");
    expect(word.parentElement?.getAttribute("title")).toBe("Dan Marino is a cameo on this card");
    expect(word.parentElement?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("AlsoPicturedRow on the card's detail", () => {
  it("names who else is pictured, read-only", () => {
    render(
      <dl>
        <AlsoPicturedRow players={[MARINO, DUPER]} />
      </dl>,
    );
    expect(screen.getByText("Also on this card").tagName).toBe("DT");
    expect(screen.getByText("Dan Marino, Mark Duper").tagName).toBe("DD");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("is not there at all when no one else is pictured", () => {
    const { container } = render(
      <dl>
        <AlsoPicturedRow players={[]} />
        <AlsoPicturedRow />
      </dl>,
    );
    expect(container.querySelector("dt")).toBeNull();
  });
});
