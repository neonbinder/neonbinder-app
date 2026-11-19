/**
 * NEO-591 — `checkPublishedChecklist` re-derives the Prospect claim itself
 * (the client's flags are never trusted) and refuses what contradicts itself.
 * The X of "Prospect (X)" is the card's printed team (Jason, 2026-11-19): the
 * parser leaves `prospect` and X in `teams`; a hand-written call may send that
 * or the raw cell, and both must read the same.
 */

import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { MAX_CARD_TEAMS } from "../features/cardAttention";
import { parsePublishedChecklist } from "../../lib/checklists/parse-published-checklist";
import { MAX_PLAYER_NAME_LENGTH } from "../../lib/players/name-limits";
import { checkPublishedChecklist } from "./publishedChecklistCheck";

type Sent = {
  number?: string;
  players?: string[];
  teams?: string[];
  noTeam?: boolean;
  prospect?: boolean;
};
const one = (sent: Sent) => ({ number: "1", players: ["Cord Rager"], teams: [] as string[], ...sent });
const checked = (sent: Sent) => checkPublishedChecklist({ rows: [one(sent)] })!.rows[0];

describe("checkPublishedChecklist — Prospect", () => {
  test("keeps a parser row's prospect and X as a team", () => {
    expect(checked({ prospect: true, teams: ["Oklahoma"] })).toEqual({
      number: "1",
      players: ["Cord Rager"],
      teams: ["Oklahoma"],
      prospect: true,
    });
  });

  test("reads a lone team string \"Prospect (Oklahoma)\" as the same row", () => {
    expect(checked({ teams: ["Prospect (Oklahoma)"] })).toEqual(checked({ prospect: true, teams: ["Oklahoma"] }));
  });

  test.each(["Prospect", "prospect", "Prospect (N/A)", "Prospect ()", "Prospect (No Team)"])(
    "reads the lone team string %j as a bare prospect: prospect and No Team, no team",
    (cell) => {
      expect(checked({ teams: [cell] })).toEqual({
        number: "1",
        players: ["Cord Rager"],
        teams: [],
        noTeam: true,
        prospect: true,
      });
    },
  );

  test("a prospect flag with no X and no team is a No Team row too", () => {
    expect(checked({ prospect: true })).toMatchObject({ noTeam: true, prospect: true, teams: [] });
  });

  test("a bare Prospect beside a real team is a prospect with that team, not No Team", () => {
    expect(checked({ prospect: true, teams: ["Boston Red Sox"] })).toEqual({
      number: "1",
      players: ["Cord Rager"],
      teams: ["Boston Red Sox"],
      prospect: true,
    });
  });

  test("an X beside a real team keeps both teams and is not No Team", () => {
    const out = checked({ teams: ["Boston Red Sox", "Prospect (Oklahoma)"] });
    expect(out.teams).toEqual(["Boston Red Sox", "Oklahoma"]);
    expect(out.prospect).toBe(true);
    expect(out.noTeam).toBeUndefined();
  });

  test("an X already among the teams is not repeated, by the folded team key", () => {
    expect(checked({ teams: ["Oklahoma", "Prospect ( oklahoma )"] }).teams).toEqual(["Oklahoma"]);
    expect(checked({ teams: ["Prospect (Oklahoma)", "Prospect (oklahoma)", "Prospect (Texas)"] }).teams).toEqual([
      "Oklahoma",
      "Texas",
    ]);
  });

  test("a bare Prospect string beside a team is a prospect without No Team", () => {
    const out = checked({ teams: ["Mets", "Prospect"] });
    expect(out.teams).toEqual(["Mets"]);
    expect(out.prospect).toBe(true);
    expect(out.noTeam).toBeUndefined();
  });

  test("never a team named Prospect", () => {
    const bare = checked({ teams: ["Prospect", "Prospect"] });
    expect(bare.teams).toEqual([]);
    expect(bare).toMatchObject({ prospect: true, noTeam: true });
  });

  test("takes the first bracket as X and drops the notes after it, as the parser does", () => {
    for (const cell of ["Prospect (Oklahoma) (RC)", "Prospect (Oklahoma) (Future Stars)", "Prospect (Oklahoma) [SP] (x)"]) {
      expect(checked({ teams: [cell] })).toEqual(checked({ prospect: true, teams: ["Oklahoma"] }));
      expect(checked({ teams: ["Mets", cell] })).toEqual(checked({ teams: ["Mets", "Oklahoma"], prospect: true }));
    }
  });

  test.each([
    "Prospect (Oklahoma) (RC) / Mets",
    "Mets / Prospect (Oklahoma) (Future Stars)",
    "Prospect (A) (B)",
    "Prospect / Prospect (Texas)",
  ])("keeps the parser's own row for the cell %j unchanged", (cell) => {
    const parsed = parsePublishedChecklist(`Card #,Player,Team\n1,Cord Rager,"${cell}"\n`).rows[0];
    const { subset: _subset, ...sent } = parsed;
    const out = checked(sent);
    expect(out.teams).toEqual(parsed.teams);
    expect(out.prospect).toBe(parsed.prospect);
    // The raw cell, sent as one string per "/" segment, reads the same.
    expect(checked({ teams: cell.split(" / ") })).toEqual(out);
  });
});

describe("checkPublishedChecklist — Prospect contradictions and caps", () => {
  const refuses = (sent: Sent) => {
    const call = () => checkPublishedChecklist({ rows: [one(sent)] });
    expect(call).toThrow(ConvexError);
    expect(call).toThrow(/Row 1 of the official checklist says No Team and names a team\./);
  };

  test("refuses No Team beside an X (flag and X sent)", () => {
    refuses({ noTeam: true, prospect: true, teams: ["Oklahoma"] });
  });

  test("refuses a team string \"No Team\" beside an X", () => {
    refuses({ teams: ["No Team", "Prospect (Oklahoma)"] });
  });

  test("refuses No Team beside a prospect cell string that carries an X", () => {
    refuses({ noTeam: true, teams: ["Prospect (Oklahoma)"] });
  });

  test("refuses No Team beside a real team, as before", () => {
    refuses({ noTeam: true, teams: ["Boston Red Sox"] });
  });

  test("allows No Team beside a bare prospect", () => {
    expect(checked({ noTeam: true, prospect: true })).toMatchObject({ noTeam: true, prospect: true });
    expect(checked({ noTeam: true, teams: ["Prospect"] })).toMatchObject({ noTeam: true, prospect: true });
  });

  test("counts teams and X together against a card's team cap", () => {
    const teams = Array.from({ length: MAX_CARD_TEAMS - 1 }, (_, i) => `Team ${i}`);
    expect(() => checkPublishedChecklist({ rows: [one({ teams: [...teams, "Prospect (Oklahoma)"] })] })).not.toThrow();
    expect(() =>
      checkPublishedChecklist({ rows: [one({ teams: [...teams, "Prospect (Oklahoma)", "Prospect (Texas)"] })] }),
    ).toThrow(`Row 1 of the official checklist names ${MAX_CARD_TEAMS + 1} teams; the limit is ${MAX_CARD_TEAMS}.`);
  });

  test("refuses an X that is over a name's length", () => {
    expect(() =>
      checkPublishedChecklist({ rows: [one({ teams: [`Prospect (${"x".repeat(MAX_PLAYER_NAME_LENGTH + 1)})`] })] }),
    ).toThrow(new RegExp(`over ${MAX_PLAYER_NAME_LENGTH} characters`));
  });

  test("a section's label names the row", () => {
    expect(() =>
      checkPublishedChecklist(
        { rows: [one({ noTeam: true, teams: ["Prospect (Oklahoma)"] })] },
        { label: "section “Autos”" },
      ),
    ).toThrow("Row 1 of section “Autos” says No Team and names a team.");
  });
});
