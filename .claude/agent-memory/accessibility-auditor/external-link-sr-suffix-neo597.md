---
name: external-link-sr-suffix-neo597
description: House shape for an external new-tab link (sr-only "(opens in new tab)" suffix, min-h-6 max-sm:min-h-11, focus-outline) and what to check on it
metadata:
  type: patterns
---

NEO-597 PublisherChecklistLinks was clean: visible text is a prefix of the accessible name (2.5.3),
`inline-flex min-h-6 max-sm:min-h-11` meets 2.5.8, `focus-outline` is the house 2px/2px-offset ring,
`text-neon-blue-text` underlined (light #006da6 on white/surface 5.09+, dark #00c2ff far above 4.5),
hover to neon-green-text keeps the underline.

**How to apply:** for a new link row, check (1) the host scroller has padding so the 4px outline is not
clipped (the dialog body grid has p-5), (2) DOM order equals the documented Tab order, (3) the sr-only
suffix is a child span, not an aria-label override, (4) rel="noopener noreferrer". Dialog in
PublishedChecklistDialog has no Tab trap of its own (inertBackground only), so a link inside it is
reachable and cannot be missed by a trap's first/last logic.
