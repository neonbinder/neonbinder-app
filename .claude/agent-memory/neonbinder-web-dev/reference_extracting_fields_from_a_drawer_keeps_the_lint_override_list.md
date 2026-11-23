---
name: extracting-fields-from-a-drawer-keeps-the-lint-override-list
description: Moving JSX out of a file that has a per-file eslint override (e.g. visual-caption labels) means adding the new file to that override too, or the old errors reappear
metadata:
  type: reference
---

When a big component is split (NEO-645: `CardDetailPanel` -> `CardDetailFields` + the drawer chrome), check `eslint.config.mjs` for per-file overrides naming the old file (`visualCaptionLabels` turns `jsx-a11y/label-has-associated-control` off for the card panels). The new file inherits none of them, so the same 8 baseline errors surface on code you only moved. Add the new path to the override list; do not rewrite the labels.

Other mechanics that held on that extraction:
- Hooks must run unconditionally, so a `sections` prop gates only JSX (`has("x") && ...`), never a hook.
- A toast that two hosts render (drawer footer, a tile's own line) is a hook returning `{toast, announce, announceAppended}` passed in as a prop; "appended" keeps an earlier message ("Saved Card title. Description rebuilt").
- A tile test that mounts the fields needs a label-aware `PlayerPicker` stub: the drawer mounts two pickers and the labelled one (Also pictured) belongs to the leftover set.
- `react-hooks/refs` flags a ref read inside a `.filter` callback in render; freeze the value in `useState(() => ...)` instead.
- `react-hooks/set-state-in-effect`: to forget a result when its offer changes, store `{offer, kind}` and derive `done/failed` by comparing keys, no reset effect.
