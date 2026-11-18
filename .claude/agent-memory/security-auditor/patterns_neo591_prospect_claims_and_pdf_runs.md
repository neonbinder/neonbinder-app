---
name: neo591-prospect-claims-and-pdf-runs
description: NEO-591 prospect team claims + PDF text runs - a joined display string of a capped list breaks a downstream per-name cap; a saturated take() read as complete makes "exactly one" a guess; retained runs past the parser's own per-line cap are waste
metadata:
  type: project
---

Three recurring shapes found auditing NEO-591 (Onyx PDF + "Prospect (X)").

1. **Joined text vs per-name cap.** A list capped at N names of <= 120 chars each
   (`prospectTeams`) was ALSO carried joined (" / ") as one string
   (`prospectTeam`, mirrored into `rawTeamName`). Every downstream check
   (`startCandidateBatch.assertNames`, `assertCardBatchWithinLimits`) holds that
   string to ONE name's 120, so a row whose held names join past 120 makes the
   server refuse its own output: the whole fetch fails. Grep any `.join(` that
   feeds a field validated as a name.

2. **Saturated read treated as complete.** An exactly-one resolver
   (`resolveProspectTeams`) filtered `search_name ... .take(K)` hits and settled
   when one survivor remained. If the read returned K rows, a second qualifying
   row may have been cut, so "one" is a guess (product invariant 8). Rule: when
   `hits.length === K` (or a window-limited helper returns its window), answer
   held/ambiguous, never settled. A docstring claiming "a cut-off lookup is held"
   is not proof: check for the length comparison.

3. **Retained data past the consumer's cap.** The PDF reader kept every line's
   pdf.js runs; the parser ignores runs on a line over `PDF_MAX_LINE_ITEMS`
   (falls back to cells). Keeping them multiplies memory for nothing. Also: a
   header-driven slotting loop (header cells x runs) is quadratic in header
   width when no width cap gates the path. Client-side only (self-DoS), but cheap
   to cap.

**How to apply:** for any new claim field carried both as a list and a joined
string, and any resolver that settles on a single surviving candidate from a
bounded read. Related: [[patterns_neo300_held_elsewhere]],
[[patterns_neo496_client_file_readers]].
