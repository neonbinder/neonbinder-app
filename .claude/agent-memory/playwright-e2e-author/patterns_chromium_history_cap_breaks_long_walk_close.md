---
name: patterns-chromium-history-cap-breaks-long-walk-close
description: Chromium keeps at most 50 session-history entries; a close that does history.go(-(depth+1)) is a silent no-op after a long walk (Done/Save for later leave the dialog up)
metadata:
  type: feedback
---

Chromium caps a tab's session history at 50 entries (older ones are pruned), and
`history.go(-n)` past the start of what is kept does nothing at all: no error, no
navigation. A UI that pushes one history entry per step and "leaves" by going back
`depth + 1` entries (the Tidy Up walk's `useTidyWalkUrl.close()`, NEO-645) works on
a short walk and silently fails once the walk has made about 49 moves: Done (Esc)
and Save for later leave the dialog visible, URL unchanged.

**Why:** a 92-card walk (2014 Topps Football, team-leader spec) ended on its end
screen and `finishTidyWalk` failed "Done closed the walk"; Done's handler is
unconditional, so nothing in the component explains it. Proved offline with a
throwaway Chromium script: 41 pushes then `go(-41)` returns to the start; 96 pushes
leave `history.length` at 50 and `go(-96)` stays put.

**How to apply:** when a close/leave control "does nothing" only on long flows,
read the end screen's tally (cards passed = pushes) before any timing theory; if the
pushes exceed ~48, it is this product bug, not the spec. Report it with the close
line; never shorten the walk in the spec to dodge it (hard rule 1). Check it offline
with a scratch Node script requiring `apps/web/node_modules/playwright` (a routed
fake origin, `pushState` N times, `history.go(-N)`), not with `e2e-run`.
Related: [[pattern-find-one-card-among-nno-cards]] (the checklist list is windowed:
search for a card before clicking its Edit).
