---
name: pdf-checklist-geometry-lives-in-pdfjs-items
description: Publisher PDF checklists - column evidence is in pdf.js item boundaries and font ids, which read-pdf-lines' cell-gap merge throws away; Title Case headings need the font signal
metadata:
  type: project
---

`read-pdf-lines.ts` merges pdf.js text items into cells by an x-gap (`cellGap`, 2x font size). Tight column layouts (Onyx 2026, NEO-591) put a long surname's end within that gap of the next column, so "De La Torre" + "Luis" become one cell, yet pdf.js still returns them as two items, each starting exactly at its column's x. Plan column splits on item boundaries (keep items on the line, re-slot them in the parser once header anchors are known), never on words or a smaller global gap (Topps word spacing would break).

A single pdf.js item that straddles two columns (one text-show op, e.g. "Owusu-Asiedu Avery" crossing into an empty First Name column) is the source cell overflowing: geometry cannot split it. `getTextContent({ disableCombineTextItems: true })` does not split it either.

Headings in non-Topps PDFs can be Title Case ("Base Cards"), so `headingText`'s ALL-CAPS rule misses them; the generic signal is the item's `fontName` matching the column-header row's font and differing from the data rows' font (compare ids for equality only).

**Why:** measured on the Onyx fixture during NEO-591 planning; the reader output alone hid both facts.

**How to apply:** any new PDF layout plan starts with a pdf.js item dump (x, width, fontName per item) of the fixture, not the reader's cell output. Related: [[set-shape-doors-need-both-source-shapes]].
