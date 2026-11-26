---
name: patterns_aria_hidden_glyph_breaks_exact_text
description: Match Cards conflict warnings start with an aria-hidden "⚠ " that getByText still sees; exact text fails and ^-anchored negatives go vacuous. Also twin-row "row N of M" counts the column, not the file
metadata:
  type: feedback
---

`getByText` matches the element's text content, aria-hidden children included. Match Cards'
`ConflictRadioGroup` warning span is `<span aria-hidden>⚠</span> {warning}`, so the text is
"⚠ Sources disagree on the number. …" / "⚠ Potential names for this card — …".

- `getByText("<warning>", { exact: true })` finds nothing (red that looks like a missing warning).
- `getByText(/^Sources disagree/)` in a `toHaveCount(0)` is VACUOUS: it can never match.
- Use `getByText(/^⚠ Sources disagree on the number\. …\.$/)` for the positive and an unanchored
  regex for the negative.

**Why:** NEO-591 WIP specs written without a run pinned the warnings exact; three specs went red
on present warnings and one negative was silently dead.

**How to apply:** before pinning any status/warning text, read the ARIA snapshot AND the component
for decorative glyphs (⚠, ✓, ▶/▼ toggles: "▶ Matched (55) 1 name conflict" is the button TEXT,
its NAME is "Expand matched cards, 1 with a name conflict").

Twin checklist rows (same printed line) are named "<line>, row N of M" where N/M count the rows
LEFT in the "Checklist only" column, not the file ("row 1 of 2", never "row 6 of 19"). Assert
`row [0-9]+ of [0-9]+$` with a count, not the file length. A red between a leaf fetch and its
Cancel leaves the batch open: the rerun's column shows the rows twice ("row 1 of 4"), so reseed.
Related: [[patterns_pairing_conflict_pills_are_bare_values]]
