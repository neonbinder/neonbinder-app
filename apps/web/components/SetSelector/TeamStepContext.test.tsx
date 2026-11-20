/**
 * NEO-602 — the team-step panel on its own: link names that never repeat, list
 * semantics that survive `list-style: none`, and an intro that is announced
 * when the query answers.
 *
 * The wizard-level behaviour (what a click records, where the panel sits) is in
 * `EntityReviewWizard.teamCandidates.test.tsx`.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
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
  STATUS_ANNOUNCE_DELAY_MS,
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

  it("gives the candidate and card lists an explicit list role", async () => {
    answer = context([cand("a", "1954–present"), cand("b", "1901–1902")]);
    render(panel());
    for (const name of [candidatesIntro(2), "Printed on 1 card"]) {
      expect((await screen.findByRole("list", { name })).getAttribute("role")).toBe("list");
    }
  });

  it("names both lists by their visible lead-in (aria-labelledby), not by a separate label", async () => {
    answer = context([cand("a", "1954–present"), cand("b", "1901–1902")]);
    render(panel());
    for (const name of [candidatesIntro(2), "Printed on 1 card"]) {
      const list = await screen.findByRole("list", { name });
      expect(list.getAttribute("aria-label")).toBeNull();
      const lead = document.getElementById(list.getAttribute("aria-labelledby") ?? "");
      expect(lead?.textContent).toBe(name);
    }
    // The candidates are named by the live region itself: one element, two jobs.
    expect(screen.getByRole("status").id).toBe(
      screen.getByRole("list", { name: candidatesIntro(2) }).getAttribute("aria-labelledby"),
    );
  });

  it("names two undated rows apart", async () => {
    answer = context([cand("a", ""), cand("b", "")]);
    render(panel());
    const list = await screen.findByRole("list", { name: candidatesIntro(2) });
    const names = within(list)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(new Set(names).size).toBe(2);
  });

  it("keeps ONE polite status mounted, empty until the answer lands, then carrying the intro", async () => {
    const { rerender } = render(panel());
    const before = screen.getByRole("status");
    expect(before.textContent).toBe("");
    expect(screen.queryByRole("list", { name: /^We've got/ })).toBeNull();

    answer = context([cand("a", "1954–present"), cand("b", "1901–1902"), cand("c", "1882–1899")]);
    rerender(panel());

    // The very element that was mounted empty: that is what is announced.
    expect(screen.getByRole("status")).toBe(before);
    expect(await screen.findByText(candidatesIntro(3))).toBe(before);
    expect(screen.getAllByText(candidatesIntro(3))).toHaveLength(1);
  });

  it("mounts the status EMPTY even when the answer is already in hand, and fills it a tick later", async () => {
    // A cached answer, as a revisited step has: a live region born holding its
    // text may not be announced, so the text must land after the element exists.
    answer = context([cand("a", "1954–present"), cand("b", "1901–1902")]);
    render(panel());
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    await waitFor(() => expect(status.textContent).toBe(candidatesIntro(2)), {
      timeout: STATUS_ANNOUNCE_DELAY_MS * 10,
    });
    expect(screen.getByRole("status")).toBe(status);
  });

  it("says nothing in the status for a step with one row or none", () => {
    answer = context([]);
    render(panel());
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.getByText("Printed on 1 card")).toBeTruthy();
  });

  it("moves no focus when the answer lands, intro included", async () => {
    const { rerender } = render(<div>{panel()}</div>);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    answer = context([cand("a", ""), cand("b", "1901–1902")]);
    rerender(<div>{panel()}</div>);
    await screen.findByText(candidatesIntro(2));
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
