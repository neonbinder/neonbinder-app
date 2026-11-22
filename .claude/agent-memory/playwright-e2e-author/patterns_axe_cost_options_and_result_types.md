---
name: axe-cost-options-and-result-types
description: NEO-628 - where an expectAccessible call's time goes, the AxeBuilder options()/withTags trap, resultTypes, and the one-whole-page-check-per-state owner rule
metadata:
  type: feedback
---

**`AxeBuilder.options(o)` REPLACES the option object; `withTags` / `disableRules` add to it.** Call `options()` first, then `withTags()`. The other order drops `runOnly`, every rule runs (best-practice ones too), the call slows and a WCAG-clean page goes red on e.g. `landmark-unique`. A measurement made with the wrong order is meaningless; check the attachment's rule counts match before comparing times.

**Where the time goes on a big DOM.** With `performanceTimer: true` (logs `Measure rule_<id> took Nms` to the page console; capture with `page.on("console")`), the 2,000-row Team Management list spent ~4 s in rules (colour contrast ~60% of that) of a 30-50 s analyze. The rest is axe describing nodes (a unique selector per node per result) and shipping results back. `resultTypes: ["violations", "incomplete"]` cut that list from 80-89 s a call to 59-63 s, with the sanitised attachment byte-identical (passes are counted per RULE). On a 300-row checklist the cut was within noise (16-23 s either way). Whole page vs `within` the checklist region costs the same when the region is most of the page.

**Owner rule (Jason via coordinator, 2026-11-20):** one whole-page check per screen state, per project, across the suite, in the spec that owns the state; later states of the same page are checked `within` the region that changed; a duplicate state in another spec is scoped to what it drives or dropped with a comment naming the owner. Scope only to a region the product already names (a plain div with no role/name, like the inline common-price editor or the collection's floating notice, cannot be a `within`): never add a name for a test.

**Why:** axe was a large share of CI shard time; duplicates bought no coverage.
**How to apply:** before adding `expectAccessible`, grep the suite for the same state; prefer a short list that shows the same markup (Jason approved a league-filtered Team Management list, with its overflow asserted, see [[patterns_prove_a_list_overflows_its_scroller]]). Measure with a temp spec + env-toggled hook in `runAxe`, restore a11y.ts byte-exact after.
