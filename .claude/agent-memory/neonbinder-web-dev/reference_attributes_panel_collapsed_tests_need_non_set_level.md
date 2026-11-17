---
name: reference_attributes_panel_collapsed_tests_need_non_set_level
description: SetAttributesPanel unit tests - a setName row opens itself, so "collapsed" tests use a non-set level or click Hide attributes first
metadata:
  type: reference
---

`SetAttributesPanel` opens by default at the set level whatever `defaultCollapsed` says (NEO-496), so a unit test that renders a `setName` row with `defaultCollapsed` is testing the OPEN panel and passes for the wrong reason. To test the collapsed state, render a non-set level (insert, parallel, variantType) or click "Hide attributes" on the set first. The same trap applies to Playwright: only non-set levels start shut.

Since NEO-569 the collapsed panel draws only its title and toggle; the Team and Player-on-every-card bulk controls stay mounted outside the `expanded` branch (a run ledger must survive collapse), and in tests they are stubs with their own buttons, so assert on the header row, not on "the only button in the panel".

`aria-controls` is set only while expanded (the body is not mounted otherwise).
