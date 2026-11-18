/**
 * NEO-591 — `checkPublishedChecklist` re-derives the Prospect claim itself
 * (the client's flags are never trusted) and refuses what contradicts itself.
 * The parser leaves `prospect` / `prospectTeams` on a row; a hand-written call
 * may send either those or the raw cell, and both must read the same.
 */

import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { MAX_CARD_TEAMS } from "../features/cardAttention";
import { parsePublishedChecklist } from "../../lib/checklists/parse-published-checklist";
import { MAX_PLAYER_NAME_LENGTH } from "../../lib/players/name-limits";
import { MAX_PUBLISHED_ROW_NAMES, checkPublishedChecklist } from "./publishedChecklistCheck";

type Sent = {
  number?: string;
  players?: string[];
  teams?: string[];
  noTeam?: boolean;
  prospect?: boolean;
  prospectTeams?: string[];
};
const one = (sent: Sent) => ({ number: "1", players: ["Cord Rager"], teams: [] as string[], ...sent });
const checked = (sent: Sent) => checkPublishedChecklist({ rows: [one(sent)] })!.rows[0];

describe("checkPublishedChecklist — Prospect", () => {
  test("keeps a parser row's prospect and X, with X out of the teams", () => {
    expect(checked({ prospect: true, prospectTeams: ["Oklahoma"] })).toEqual({
      number: "1",
      players: ["Cord Rager"],
      teams: [],
      prospect: true,
      prospectTeams: ["Oklahoma"],
    });
  });

  test("reads a lone team string \"Prospect (Oklahoma)\" as the same row", () => {
    expect(checked({ teams: ["Prospect (Oklahoma)"] })).toEqual(
      checked({ prospect: true, prospectTeams: ["Oklahoma"] }),
    );
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
    expect(checked({ prospect: true }).prospectTeams).toBeUndefined();
  });

  test("a bare Prospect beside a real team is a prospect with that team, not No Team", () => {
    const out = checked({ prospect: true, teams: ["Boston Red Sox"] });
    expect(out).toEqual({
      number: "1",
      players: ["Cord Rager"],
      teams: ["Boston Red Sox"],
      prospect: true,
    });
  });

  test("an X beside a real team keeps both and is not No Team", () => {
    const out = checked({ prospectTeams: ["Oklahoma"], teams: ["Boston Red Sox"] });
    expect(out).toMatchObject({ teams: ["Boston Red Sox"], prospect: true, prospectTeams: ["Oklahoma"] });
    expect(out.noTeam).toBeUndefined();
  });

  test("sending only prospectTeams is enough to make the row a prospect", () => {
    expect(checked({ prospectTeams: ["Oklahoma"] })).toMatchObject({ prospect: true, prospectTeams: ["Oklahoma"] });
  });

  test("an X that says nothing is dropped (N/A, None, No Team), so a row of only those is no prospect", () => {
    for (const x of ["N/A", "None", "No Team", " ", "-"]) {
      const out = checked({ prospectTeams: [x] });
      expect(out.prospect).toBeUndefined();
      expect(out.prospectTeams).toBeUndefined();
      expect(out.noTeam).toBeUndefined();
    }
  });

  test("dedupes X by the folded team key, keeping the first spelling", () => {
    expect(checked({ prospectTeams: ["Oklahoma", " oklahoma ", "OKLAHOMA"] }).prospectTeams).toEqual(["Oklahoma"]);
  });

  test("merges sent X with the one in a lone cell string, sent first, without repeating", () => {
    expect(checked({ prospectTeams: ["Texas"], teams: ["Prospect (Oklahoma)"] }).prospectTeams).toEqual(["Texas", "Oklahoma"]);
    expect(checked({ prospectTeams: ["oklahoma"], teams: ["Prospect (Oklahoma)"] }).prospectTeams).toEqual(["oklahoma"]);
  });

  test("reads each team string on its own: a prospect cell beside a team is the claim, the team stays", () => {
    const out = checked({ teams: ["Boston Red Sox", "Prospect (Oklahoma)"] });
    expect(out.teams).toEqual(["Boston Red Sox"]);
    expect(out.prospect).toBe(true);
    expect(out.prospectTeams).toEqual(["Oklahoma"]);
    expect(out.noTeam).toBeUndefined();
  });

  test("a bare Prospect string beside a team is a prospect without No Team", () => {
    const out = checked({ teams: ["Mets", "Prospect"] });
    expect(out.teams).toEqual(["Mets"]);
    expect(out.prospect).toBe(true);
    expect(out.noTeam).toBeUndefined();
    expect(out.prospectTeams).toBeUndefined();
  });

  test("two prospect strings are one prospect with both X, deduped, never a team named Prospect", () => {
    const out = checked({ teams: ["Prospect (Oklahoma)", "Prospect (oklahoma)", "Prospect (Texas)"] });
    expect(out.teams).toEqual([]);
    expect(out.prospectTeams).toEqual(["Oklahoma", "Texas"]);
    const bare = checked({ teams: ["Prospect", "Prospect"] });
    expect(bare.teams).toEqual([]);
    expect(bare).toMatchObject({ prospect: true, noTeam: true });
  });

  test("takes the first bracket as X and drops the notes after it, as the parser does", () => {
    for (const cell of ["Prospect (Oklahoma) (RC)", "Prospect (Oklahoma) (Future Stars)", "Prospect (Oklahoma) [SP] (x)"]) {
      expect(checked({ teams: [cell] })).toEqual(
        checked({ prospect: true, prospectTeams: ["Oklahoma"] }),
      );
      expect(checked({ teams: ["Mets", cell] })).toEqual(
        checked({ teams: ["Mets"], prospect: true, prospectTeams: ["Oklahoma"] }),
      );
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
    expect(out.prospectTeams).toEqual(parsed.prospectTeams);
    // The raw cell, sent as one string per "/" segment, reads the same.
    const raw = checked({ teams: cell.split(" / ") });
    expect(raw).toEqual(out);
  });

  test("agrees with the parser's row for the same cell", () => {
    expect(checked({ teams: ["Mets", "Prospect (Oklahoma)"] })).toEqual(
      checked({ teams: ["Mets"], prospect: true, prospectTeams: ["Oklahoma"] }),
    );
  });

  test("never moves an X into teams, whatever the shape sent", () => {
    for (const sent of [
      { teams: ["Prospect (Arizona)"] },
      { prospect: true, prospectTeams: ["Arizona"] },
      { prospectTeams: ["Arizona"], teams: [] },
    ]) {
      const out = checked(sent);
      expect(out.teams).toEqual([]);
      expect(out.prospectTeams).toEqual(["Arizona"]);
    }
  });
});

describe("checkPublishedChecklist — Prospect contradictions and caps", () => {
  const refuses = (sent: Sent) => {
    const call = () => checkPublishedChecklist({ rows: [one(sent)] });
    expect(call).toThrow(ConvexError);
    expect(call).toThrow(/Row 1 of the official checklist says No Team and names a team\./);
  };

  test("refuses No Team beside an X (flag and X sent)", () => {
    refuses({ noTeam: true, prospectTeams: ["Oklahoma"] });
  });

  test("refuses a team string \"No Team\" beside an X", () => {
    refuses({ teams: ["No Team"], prospectTeams: ["Oklahoma"] });
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
    expect(() => checkPublishedChecklist({ rows: [one({ teams, prospectTeams: ["Oklahoma"] })] })).not.toThrow();
    expect(() => checkPublishedChecklist({ rows: [one({ teams, prospectTeams: ["Oklahoma", "Texas"] })] })).toThrow(
      `Row 1 of the official checklist names ${MAX_CARD_TEAMS + 1} teams; the limit is ${MAX_CARD_TEAMS}.`,
    );
  });

  test("refuses more X than the card's team cap on their own", () => {
    const prospectTeams = Array.from({ length: MAX_CARD_TEAMS + 1 }, (_, i) => `School ${i}`);
    expect(() => checkPublishedChecklist({ rows: [one({ prospectTeams })] })).toThrow(
      /names \d+ prospect teams; the limit is 8\./,
    );
  });

  test("refuses an X that is over a name's length", () => {
    expect(() => checkPublishedChecklist({ rows: [one({ prospectTeams: ["x".repeat(MAX_PLAYER_NAME_LENGTH + 1)] })] })).toThrow(
      new RegExp(`prospect team name over ${MAX_PLAYER_NAME_LENGTH} characters`),
    );
  });

  test("refuses more sent X strings than the raw cap, blanks included, before trimming", () => {
    const prospectTeams = Array.from({ length: MAX_PUBLISHED_ROW_NAMES + 1 }, () => " ");
    expect(() => checkPublishedChecklist({ rows: [one({ prospectTeams })] })).toThrow(
      `Row 1 of the official checklist sends ${MAX_PUBLISHED_ROW_NAMES + 1} prospect team names; the limit is ${MAX_PUBLISHED_ROW_NAMES}.`,
    );
  });

  test("a section's label names the row", () => {
    expect(() =>
      checkPublishedChecklist({ rows: [one({ noTeam: true, prospectTeams: ["Oklahoma"] })] }, { label: "section “Autos”" }),
    ).toThrow("Row 1 of section “Autos” says No Team and names a team.");
  });
});
