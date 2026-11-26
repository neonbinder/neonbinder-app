/**
 * NEO-645 — the order the Team tile offers the rows a printed name could mean:
 * newest era first (`yearsActive.from`, descending), an undated row last. It is
 * what the retired `teamStepContext` did before the rows were read client-side,
 * and the order `candidateTeamIds` arrives in is not it.
 *
 * Pure, so one function decides the order and a test can pin it. Ties are
 * broken the same way whatever order the ids arrive in: the later end of the
 * era first (an open-ended era, still running, ahead of a closed one), then the
 * display name, then the id. Two rows that print identically therefore keep the
 * same "#1" / "#2" link names from one render to the next.
 */

export type CandidateOrderRow = {
  id: string;
  fullName: string;
  yearsActive?: { from: number; to?: number };
};

export function orderCandidateTeams<T extends CandidateOrderRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const aFrom = a.yearsActive?.from;
    const bFrom = b.yearsActive?.from;
    if (aFrom === undefined || bFrom === undefined) {
      if (aFrom !== bFrom) return aFrom === undefined ? 1 : -1;
    } else if (aFrom !== bFrom) {
      return bFrom - aFrom;
    }
    const aTo = a.yearsActive ? (a.yearsActive.to ?? Number.POSITIVE_INFINITY) : 0;
    const bTo = b.yearsActive ? (b.yearsActive.to ?? Number.POSITIVE_INFINITY) : 0;
    if (aTo !== bTo) return aTo > bTo ? -1 : 1;
    if (a.fullName !== b.fullName) return a.fullName < b.fullName ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  });
}
