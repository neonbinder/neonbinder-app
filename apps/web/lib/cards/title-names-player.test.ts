import { describe, expect, it } from "vitest";
import { surnameOf, titleMissesPlayer } from "./title-names-player";

describe("surnameOf", () => {
  it("reads the last word, past a suffix, accents and punctuation folded", () => {
    expect(surnameOf("Jackson Merrill")).toBe("merrill");
    expect(surnameOf("Ken Griffey Jr.")).toBe("griffey");
    expect(surnameOf("José Ramírez")).toBe("ramirez");
    expect(surnameOf("Shaquille O'Neal")).toBe("neal");
    expect(surnameOf("Ichiro")).toBe("ichiro");
    expect(surnameOf("  ")).toBeUndefined();
    expect(surnameOf("Jr.")).toBeUndefined();
  });
});

describe("titleMissesPlayer", () => {
  it("is false when the title says the player's surname", () => {
    expect(titleMissesPlayer("2024 Topps Chrome #118 Jackson Merrill RC Padres", ["Jackson Merrill"])).toBe(false);
    expect(titleMissesPlayer("2024 Topps #5 Jose Ramirez", ["José Ramírez"])).toBe(false);
  });

  it("is true when the card names a player and the title carries none", () => {
    expect(titleMissesPlayer("2024 Topps Chrome #118 Rafaela Image Variation", ["Jackson Merrill"])).toBe(true);
    expect(titleMissesPlayer("", ["Jackson Merrill"])).toBe(true);
  });

  it("matches a whole word, never a fragment of one", () => {
    expect(titleMissesPlayer("2024 Topps Merrillville Gold", ["Jackson Merrill"])).toBe(true);
  });

  it("is satisfied by any one of several names", () => {
    expect(titleMissesPlayer("2024 Topps Judge Pinstripes", ["Aaron Judge", "Juan Soto"])).toBe(false);
    expect(titleMissesPlayer("2024 Topps Gold", ["Aaron Judge", "Juan Soto"])).toBe(true);
  });

  it("has nothing to miss with no usable name", () => {
    expect(titleMissesPlayer("2024 Topps Gold", [])).toBe(false);
    expect(titleMissesPlayer("2024 Topps Gold", ["", "  "])).toBe(false);
  });
});
