---
name: wrapping-label-with-hint-names-the-control
description: A checkbox inside a <label> that also holds a help line gets the help text in its accessible name; name it by the title span (aria-labelledby) and point aria-describedby at the hint
metadata:
  type: reference
---

A `<label>` wrapping a checkbox, its title AND a line of help text makes the whole label text the checkbox's accessible name ("Include cameos Also take cards…"), so `getByRole("checkbox", { name: "Include cameos" })` misses it in unit tests and Playwright alike.

Keep the wrapping label (the whole block stays clickable) and give the input `aria-labelledby={titleSpanId}` plus `aria-describedby={hintId}`. Seen on NEO-528's rule builder "Include cameos" (`binders/RuleBuilder.tsx`).

Rendering `RuleBuilder` in a test also needs `useSearchText` from `../catalog/search` mocked (it reads `useCollectionStore`), and a partial `vi.mock("../data/store", async (importOriginal) => …)`: a full mock breaks `mode.tsx`'s `ScopeProvider` import through `PrintShopLink`.
