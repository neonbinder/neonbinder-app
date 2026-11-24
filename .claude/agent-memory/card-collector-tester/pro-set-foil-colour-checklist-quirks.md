---
name: pro-set-foil-colour-checklist-quirks
description: Collector-review pattern for manufacturer foil x colour checklist exports (Pro Set Metal style) - what to check before naming parallels
metadata:
  type: project
---

Manufacturer exports with one row per card x foil and one column per colour (value = print run) hide hobby traps. Check these on any such file:

- A foil name can already contain a colour ("Silver Circles RWB" in the RWB column) or a colour word ("Super Prismatic Gold" with its only run in the Silver column). Literal "<Subset> <Foil> <Colour>" then doubles up or sits next to a near-twin ("Prismatic Gold" 1/1 vs "Super Prismatic Gold Silver" 1/1).
- Mini subsets carry their own card numbers (89M-1 vs 89B-1), so a Mini parallel's cards must keep the mini number.
- An Auto/Base flag column can be the only autograph signal for a subset whose name omits "Auto" (Dugout Duos).
- The same card can carry a team on some foil rows and blank on others; dedupe must not take the blank.
- Unlicensed brands send a city designation ("Los Angeles N", "Chicago A"), and plain "Philadelphia"/"Washington"/"Florida" are league- and era-ambiguous.
- Print runs within one section are almost uniform but not quite (1 card in 188 differs), so a per-card run matters.

**Why:** found reviewing NEO-616 (2026-11-19); these decide whether a dealer can pick the right parallel and list it.
**How to apply:** profile the file (foils per subset, colours per foil, runs per section, team per card across rows) before signing off on naming.
