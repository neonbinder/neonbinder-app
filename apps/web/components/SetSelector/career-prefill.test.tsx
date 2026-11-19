/**
 * NEO-574 — what the New player step's career form opens with
 * (`career-prefill.ts`). (`.test.tsx`: collected under components/.)
 */
import { describe, expect, it } from "vitest";
import { careerPrefill, type CareerPrefillInput } from "./career-prefill";

const base = (over: Partial<CareerPrefillInput> = {}): CareerPrefillInput => ({
  playerName: "Fernando Tatis Jr.",
  cards: [],
  rows: [],
  setYear: 2022,
  accepted: [],
  ...over,
});

const solo = (team: string, n = "1") => ({
  cardNumber: n,
  players: ["Fernando Tatis Jr."],
  teams: [team],
});

describe("careerPrefill", () => {
  it("offers the team on the player's cards in the set's year", () => {
    const out = careerPrefill(base({ cards: [solo("Padres")] }));
    expect(out.prefill).toEqual({ team: "Padres", fromYear: 2022 });
    expect(out.quickPicks).toEqual([]);
  });

  it("offers nothing without a set year", () => {
    expect(careerPrefill(base({ cards: [solo("Padres")], setYear: undefined }))).toEqual({
      prefill: null,
      quickPicks: [],
    });
  });

  it("prefills the team on most of the solo cards, the rest as chips; ties go to the earlier card", () => {
    const out = careerPrefill(
      base({
        cards: [solo("Cubs", "1"), solo("Padres", "2"), solo("Padres", "3"), solo("Rays", "4")],
      }),
    );
    expect(out.prefill?.team).toBe("Padres");
    expect(out.quickPicks.map((q) => q.team)).toEqual(["Cubs", "Rays"]);
    const tie = careerPrefill(base({ cards: [solo("Cubs", "1"), solo("Padres", "2")] }));
    expect(tie.prefill?.team).toBe("Cubs");
  });

  it("never offers a team from a card with several players", () => {
    const out = careerPrefill(
      base({
        cards: [
          { cardNumber: "9", players: ["Fernando Tatis Jr.", "Juan Soto"], teams: ["Nationals"] },
          solo("Padres"),
        ],
      }),
    );
    expect(out.prefill?.team).toBe("Padres");
    expect(out.quickPicks).toEqual([]);
  });

  it("counts a card as solo when its other name was ruled 'not a person'", () => {
    const cards = [{ cardNumber: "9", players: ["Fernando Tatis Jr.", "Checklist"], teams: ["Padres"] }];
    const rows = [{ kind: "player" as const, name: "Checklist", decision: { action: "skip" as const } }];
    expect(careerPrefill(base({ cards, rows })).prefill?.team).toBe("Padres");
    expect(careerPrefill(base({ cards, skippedPlayerNames: ["checklist"] })).prefill?.team).toBe(
      "Padres",
    );
    expect(careerPrefill(base({ cards })).prefill).toBeNull();
  });

  it("ignores cards that re-sync a stored row", () => {
    const out = careerPrefill(base({ cards: [solo("Cubs", "1"), solo("Padres", "2")], existingIndexes: [0] }));
    expect(out.prefill?.team).toBe("Padres");
  });

  it("uses the name the batch will use: a New Team's composed name, a linked team's name", () => {
    const rows = [
      {
        kind: "team" as const,
        name: "Padres",
        decision: { action: "create" as const, create: { location: "San Diego", name: "Padres" } },
      },
      { kind: "team" as const, name: "Cubs", decision: { action: "link" as const, linkedTeamId: "t-cubs" } },
    ];
    const out = careerPrefill(
      base({
        cards: [solo("Padres", "1"), solo("Cubs", "2")],
        rows,
        linkedTeamNameById: new Map([["t-cubs", "Chicago Cubs"]]),
      }),
    );
    expect(out.prefill?.team).toBe("San Diego Padres");
    expect(out.quickPicks.map((q) => q.team)).toEqual(["Chicago Cubs"]);
  });

  it("falls back to the gate's resolved name, then the printed string", () => {
    const resolved = [{ printed: "Padres", name: "San Diego Padres" }];
    expect(careerPrefill(base({ cards: [solo("Padres")], resolvedTeams: resolved })).prefill?.team).toBe(
      "San Diego Padres",
    );
    expect(careerPrefill(base({ cards: [solo("Padres")] })).prefill?.team).toBe("Padres");
  });

  it("never offers a team ruled 'not a team'", () => {
    const rows = [{ kind: "team" as const, name: "Sticker", decision: { action: "skip" as const } }];
    expect(careerPrefill(base({ cards: [solo("Sticker")], rows })).prefill).toBeNull();
  });

  it("skips a team the career already covers for the set's year, and moves on to the next", () => {
    const cards = [solo("Padres", "1"), solo("Padres", "2"), solo("Cubs", "3")];
    const covered = careerPrefill(base({ cards, accepted: [{ name: "Padres", fromYear: 2019 }] }));
    expect(covered.prefill?.team).toBe("Cubs");
    // A stint that starts AFTER the set's year does not cover it (strict).
    const later = careerPrefill(base({ cards, accepted: [{ name: "Padres", fromYear: 2024 }] }));
    expect(later.prefill?.team).toBe("Padres");
  });

  it("matches the career's team by the dedupe key, not the spelling", () => {
    const out = careerPrefill(
      base({ cards: [solo("San Diego Padres")], accepted: [{ name: "san diego padres", fromYear: 2020 }] }),
    );
    expect(out.prefill).toBeNull();
  });

  it("offers nothing for a player no card prints solo", () => {
    expect(careerPrefill(base({ cards: [{ players: ["Someone Else"], teams: ["Padres"] }] })).prefill).toBeNull();
  });

  it("adversarial: one card printing a team in two spellings counts for that team once", () => {
    // Without the fold a single card inflates its team past a genuine two-card lead.
    const out = careerPrefill(
      base({
        cards: [
          { cardNumber: "1", players: ["Fernando Tatis Jr."], teams: ["Padres", "PADRES"] },
          solo("Cubs", "2"),
          solo("Cubs", "3"),
        ],
      }),
    );
    expect(out.prefill?.team).toBe("Cubs");
  });

  it("adversarial: a New Team decision and the same text printed plainly are one team", () => {
    const rows = [
      {
        kind: "team" as const,
        name: "Padres",
        decision: { action: "create" as const, create: { location: "San Diego", name: "Padres" } },
      },
    ];
    const out = careerPrefill(base({ cards: [solo("Padres", "1"), solo("San Diego Padres", "2")], rows }));
    expect(out.prefill?.team).toBe("San Diego Padres");
    expect(out.quickPicks).toEqual([]);
  });
});
