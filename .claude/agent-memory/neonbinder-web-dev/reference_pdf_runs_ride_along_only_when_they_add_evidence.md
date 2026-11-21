---
name: reference_pdf_runs_ride_along_only_when_they_add_evidence
description: A new field on the PDF reader's records changes the golden "records mapping" snapshot of every existing PDF, so pdf.js text runs are passed to the parser only for documents that need them
metadata:
  type: reference
---

`checklist-formats-golden.test.ts` snapshots `file.input.cells` (the records read-checklist-file hands the parser). Adding `items` to every PDF record would move the Topps snapshot, so `read-checklist-file.ts` attaches the pdf.js text runs only when the document has a Last/First header or a line whose cells merged a gap wider than a word space (`hidesAColumnGap`). Any new per-record field needs the same "only when it adds evidence" gate, or the golden diff is the (correct) alarm.

Scratch-probing a lib module against a real fixture: a `.mts` file run with `npx tsx` (top-level await needs ESM; `.ts` is CJS and fails), reading pdf.js from `pdfjs-dist/legacy/build/pdf.mjs` as the golden test does.

**How to apply:** touching the reader or `ChecklistCellRecord`, run the golden test first; never `-u`.
