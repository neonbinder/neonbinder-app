/**
 * NEO-602 — the team-step panel on its own: link names that never repeat, list
 * semantics that survive `list-style: none`, and an intro that is announced
 * when the query answers.
 *
 * The wizard-level behaviour (what a click records, where the panel sits) is in
 * `EntityReviewWizard.teamCandidates.test.tsx`.
 */

import { render, screen, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

vi.mock("../../convex/_generated/api", () => ({
  api: { entityReviewQueue: { teamStepContext: "entityReviewQueue.teamStepContext" } },
}));

let answer: unknown;
vi.mock("convex/react", () => ({
  useQuery: () => answer,
}));

import TeamStepContext, {
  candidateLinkLabel,
  candidateLinkLabels,
  candidatesIntro,
  type TeamStepCandidate,
} from "./TeamStepContext";

const cand = (
  teamId: string,
  era: string,
  league?: string,
  fullName = "Baltimore Orioles",
): TeamStepCandidate => ({
  teamId: teamId as unknown as Id<"teams">,
  fullName,
  era,
  ...(league ? { league } : {}),
});

describe("candidateLinkLabels", () => {
  it("leaves a unique label exactly as candidateLinkLabel writes it", () => {
    const rows = [cand("a", "1954–present", "Major League Baseball"), cand("b", "1901–1902")];
    expect(candidateLinkLabels(rows)).toEqual([
      "Link to Baltimore Orioles · 1954–present · Major League Baseball",
      "Link to Baltimore Orioles · 1901–1902",
    ]);
    expect(candidateLinkLabels(rows)).toEqual(rows.map(candidateLinkLabel));
  });

  it("numbers two rows with no era and no league, so their names differ", () => {
    const labels = candidateLinkLabels([cand("a", ""), cand("b", "")]);
    expect(labels).toEqual([
      "Link to Baltimore Orioles · undated #1",
      "Link to Baltimore Orioles · undated #2",
    ]);
    expect(new Set(labels).size).toBe(2);
  });

  it("numbers rows that share an era and league, and leaves the others alone", () => {
    const labels = candidateLinkLabels([
      cand("a", "1954–present", "MLB"),
      cand("b", "1954–present", "MLB"),
      cand("c", "1901–1902"),
      cand("d", ""),
    ]);
    expect(labels).toEqual([
      "Link to Baltimore Orioles · 1954–present · MLB · #1",
      "Link to Baltimore Orioles · 1954–present · MLB · #2",
      "Link to Baltimore Orioles · 1901–1902",
      "Link to Baltimore Orioles",
    ]);
    expect(new Set(labels).size).toBe(4);
  });

  it("an undated row alongside a dated one needs no number", () => {
    expect(candidateLinkLabels([cand("a", "1954–present"), cand("b", "")])).toEqual([
      "Link to Baltimore Orioles · 1954–present",
      "Link to Baltimore Orioles",
    ]);
  });
});

describe("TeamStepContext", () => {
  const reviewRowId = "row-1" as unknown as Id<"entityReviewQueue">;
  const context = (candidates: TeamStepCandidate[]) => ({
    candidates,
    cards: [{ number: "7", players: [{ name: "Some Player", stints: [], moreStints: 0 }] }],
    moreCards: 0,
    playersDontSettle: false,
  });
  // A FRESH element per render: a rerender of the same element bails out and
  // never re-reads the module-state mock.
  const panel = () => <TeamStepContext reviewRowId={reviewRowId} onLink={vi.fn()} />;

  beforeEach(() => {
    answer = undefined;
  });

  it("gives the candidate and card lists an explicit list role", () => {
    answer = context([cand("a", "1954–present"), cand("b", "1901–1902")]);
    render(panel());
    for (const name of ["Teams already filed under this name", "Cards that print this team name"]) {
      expect(screen.getByRole("list", { name }).getAttribute("role")).toBe("list");
    }
  });

  it("names two undated rows apart", () => {
    answer = context([cand("a", ""), cand("b", "")]);
    render(panel());
    const list = screen.getByRole("list", { name: "Teams already filed under this name" });
    const names = within(list)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(new Set(names).size).toBe(2);
  });

  it("keeps ONE polite status mounted, empty until the answer lands, then carrying the intro", () => {
    const { rerender } = render(panel());
    const before = screen.getByRole("status");
    expect(before.textContent).toBe("");
    expect(screen.queryByRole("list", { name: /^Teams already filed/ })).toBeNull();

    answer = context([cand("a", "1954–present"), cand("b", "1901–1902"), cand("c", "1882–1899")]);
    rerender(panel());

    // The very element that was mounted empty: that is what is announced.
    expect(screen.getByRole("status")).toBe(before);
    expect(before.textContent).toBe(candidatesIntro(3));
    expect(screen.getAllByText(candidatesIntro(3))).toHaveLength(1);
  });

  it("says nothing in the status for a step with one row or none", () => {
    answer = context([]);
    render(panel());
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.getByText("Printed on 1 card")).toBeTruthy();
  });

  it("moves no focus when the answer lands", () => {
    const { rerender } = render(<div>{panel()}</div>);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    answer = context([cand("a", ""), cand("b", "1901–1902")]);
    rerender(<div>{panel()}</div>);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
