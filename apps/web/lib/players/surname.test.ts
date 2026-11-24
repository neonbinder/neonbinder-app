import { describe, expect, it } from "vitest";
import { playerSurname } from "./surname";

describe("playerSurname", () => {
  it("is the last word of a plain name", () => {
    expect(playerSurname("Francisco Lindor")).toBe("Lindor");
    expect(playerSurname("Juan Carlos Soto")).toBe("Soto");
  });

  it("sets a trailing generational suffix aside, in any spelling", () => {
    for (const name of [
      "Ronald Acuña Jr.",
      "Ronald Acuña Jr",
      "Ronald Acuña, Jr.",
      "Ronald Acuña, Jr",
      "Ronald Acuña JR.",
      "Ronald Acuña jr",
    ]) {
      expect(playerSurname(name)).toBe("Acuña");
    }
    expect(playerSurname("Ken Griffey Sr.")).toBe("Griffey");
    expect(playerSurname("Cal Ripken II")).toBe("Ripken");
    expect(playerSurname("Cal Ripken, III")).toBe("Ripken");
    expect(playerSurname("Ed Smith iv")).toBe("Smith");
    expect(playerSurname("Ed Smith V")).toBe("Smith");
    expect(playerSurname("Ed Smith, V.")).toBe("Smith");
  });

  it("keeps accents as stored", () => {
    expect(playerSurname("José Ramírez")).toBe("Ramírez");
  });

  it("is the whole name when there is one word", () => {
    expect(playerSurname("Pelé")).toBe("Pelé");
    expect(playerSurname("  Boomer ")).toBe("Boomer");
    expect(playerSurname("Jr.")).toBe("Jr.");
  });

  it("leaves a suffix-like word that is not last alone", () => {
    expect(playerSurname("Ed V Smith")).toBe("Smith");
  });
});
