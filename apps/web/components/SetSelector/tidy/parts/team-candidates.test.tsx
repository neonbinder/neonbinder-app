/**
 * NEO-645 — the Team tile offers a name's rows newest era first. (`.test.tsx`:
 * the components project only collects that suffix.)
 */
import { describe, expect, it } from "vitest";
import { orderCandidateTeams, type CandidateOrderRow } from "./team-candidates";

const row = (id: string, yearsActive?: { from: number; to?: number }, fullName = "Athletics"): CandidateOrderRow => ({
  id,
  fullName,
  ...(yearsActive ? { yearsActive } : {}),
});
const ids = (rows: readonly CandidateOrderRow[]) => rows.map((r) => r.id);

describe("orderCandidateTeams", () => {
  it("puts the newest era first, whatever order the ids arrive in", () => {
    const old = row("old", { from: 1968, to: 2024 });
    const current = row("current", { from: 2025 });
    expect(ids(orderCandidateTeams([old, current]))).toEqual(["current", "old"]);
    expect(ids(orderCandidateTeams([current, old]))).toEqual(["current", "old"]);
  });

  it("orders a longer list by start year, descending", () => {
    const rows = [
      row("a", { from: 1901, to: 1954 }),
      row("b", { from: 1955, to: 1967 }),
      row("c", { from: 1968, to: 2024 }),
      row("d", { from: 2025 }),
    ];
    expect(ids(orderCandidateTeams(rows))).toEqual(["d", "c", "b", "a"]);
  });

  it("puts an undated row last, however many there are", () => {
    const rows = [row("u1"), row("dated", { from: 1950 }), row("u2")];
    expect(ids(orderCandidateTeams(rows))).toEqual(["dated", "u1", "u2"]);
  });

  it("breaks a tie on the start year with the later end, open-ended first", () => {
    const rows = [row("closed", { from: 1990, to: 1995 }), row("open", { from: 1990 }), row("longer", { from: 1990, to: 2001 })];
    expect(ids(orderCandidateTeams(rows))).toEqual(["open", "longer", "closed"]);
  });

  it("breaks a full tie by name, then id, the same for either input order", () => {
    const a = row("t-1", { from: 1990 }, "Aces");
    const b = row("t-2", { from: 1990 }, "Aces");
    const c = row("t-0", { from: 1990 }, "Bees");
    expect(ids(orderCandidateTeams([c, b, a]))).toEqual(["t-1", "t-2", "t-0"]);
    expect(ids(orderCandidateTeams([a, b, c]))).toEqual(["t-1", "t-2", "t-0"]);
    expect(ids(orderCandidateTeams([row("u-b"), row("u-a")]))).toEqual(["u-a", "u-b"]);
  });

  it("does not touch the list it is given", () => {
    const input = [row("old", { from: 1968, to: 2024 }), row("current", { from: 2025 })];
    orderCandidateTeams(input);
    expect(ids(input)).toEqual(["old", "current"]);
  });
});
