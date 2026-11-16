---
name: patterns_aria_disabled_refusal_by_keyboard
description: Prove an aria-disabled refusal by keyboard; dnd-kit drag autoscroll and aria-disabled rows
metadata:
  type: pattern
---

A control that is `aria-disabled="true"` cannot be `click()`ed (Playwright waits for enabled and times out at 7 s). To prove it refuses: assert `toHaveAttribute("aria-disabled","true")` and `toHaveAccessibleDescription(reason)`, then `await control.focus(); await page.keyboard.press("Enter")` and assert the visible non-effect plus where focus landed (house precedent in the BSC listing spec).

The reverse trap: a value typed in a field that enables the control is often kept on BLUR. Playwright's click on the still-aria-disabled control would wait forever, because the blur only happens on the click. Press Tab first, assert the control lost `aria-disabled`, then click it.

Related: [[patterns_collection_optimistic_writes_wait_for_the_notice]]

## Dndkit drag autoscroll and aria disabled rows

**Drag with autoscroll (dnd-kit 6, MouseSensor distance 5).** No helper needed and
no evaluate: `scrollIntoViewIfNeeded` the source row, `boundingBox()` it,
`mouse.move` to its centre, `mouse.down()`, move ~12 px in a few steps (activates),
then move to a point just inside the target scroller's bottom edge and HOLD:
`await expect(targetBox).toBeInViewport({ ratio: 1 })` is the wait (dnd-kit keeps
scrolling on an interval while the pointer stays in the bottom 20 %). Then read the
target's box, move onto it, nudge 1 px, `mouse.up()`. Assert
`not.toBeInViewport()` on the target BEFORE the drag (R2) so the drag is what
brought it in. Works on `e2e-mobile` too (page.mouse reaches MouseSensor under
Pixel 7 emulation). Planting "skip the edge park" turns the spec red at the
in-viewport wait, which is the proof the claim is autoscroll.

**Why the edge point must be INSIDE a droppable's scroller:** the collision is
`pointerWithin`; over a gap `over` is null and dnd-kit autoscrolls the ancestors
of the ACTIVE row instead (the left pane), and its edge test ignores x. Desktop
two-pane: pane bottom − 12. Stacked phone: the body is the scroller, so a point
just above the footer (branch on `isMobile`, GUIDE "Desktop and mobile").

**Trap 1, a product bug pattern:** `useDraggable({ disabled: true })` spreads
`aria-disabled="true"` onto the row. Any button nested in that row (a jump, a ✕)
is then `[disabled]` in the ARIA snapshot, and Playwright's click waits on
"element is not enabled" for 7 s. Never `force: true` it: report it (NEO-472
"has parallels" jump). How to apply: when a click times out on "not enabled" and
the button has no disabled attribute, look for an aria-disabled ancestor in
error-context.md.

**Trap 2:** axe `scrollable-region-focusable` fires only when a pane actually
overflows AND holds nothing tabbable (a long list of empty drop boxes with
tabIndex −1). Short fixtures never see it; a long-set fixture does. Product fix,
never a spec change. See [[patterns_negative_asserts_pass_on_a_dead_page]].

**Debounced count beside a field (NEO-472 round 2).** A visible "N of M" plus a
separate sr-only `role=status` that copies it after a 500 ms debounce: a bare
`getByText("1 of 3 inserts", {exact:true})` passes only while it races ahead of
the debounce, then becomes a strict-mode violation. Wait on
`getByRole("status").filter({ hasText: /^…$/ })`, then `toHaveCount(2)` on the
text; the gone-state is `toHaveCount(0)`. A keyboard drop target (box with
`tabIndex=0` while a selection is up) is proven with `focus()` +
`toHaveAccessibleDescription(...)` + `press("Enter"|" ")`; planting "no key
handler" turns the promotions assert red.
