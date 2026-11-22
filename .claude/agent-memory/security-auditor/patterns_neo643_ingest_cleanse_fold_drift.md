---
name: neo643-ingest-cleanse-fold-drift
description: Cleansing incoming marketplace labels at ingest drifts from matchers that fold less (selectorValueKey = lowercase+trim); the SL All Brands prefix filter decides which ids come back
metadata:
  type: project
---

When a change cleanses marketplace LABELS at ingest (junk deleted, NFC,
whitespace collapsed) but leaves stored NB values and stored NB metadata
un-backfilled, every matcher that compares an incoming label against stored
text with a NARROWER fold drifts. Three places to check:

- `selectorSyncMatch.selectorValueKey` (lowercase + trim only) keys the name
  tier for unlinked rows. Drift there mints twin rows instead of attaching
  the second marketplace's id. It is not link loss, because the identity tiers
  run first.
- `matchesBrandPrefix(label, metadata.setNamePrefix)` in SL `fetchSetNames`
  (All Brands narrowing) FILTERS the option list. A label that stops matching
  an un-cleansed prefix drops its radio id from a `success: true` answer, and
  the unlink pass then detaches it. That one is a rule 5 path: cleanse the
  prefix the same way.
- `sectionKeyOf` is a stored key (publishedChecklistLinks survive replaces by
  it). Changing what `cleanSectionName` feeds it is a re-key in disguise.

Also: a junk-class regex written with LITERAL invisible characters
(`/[\\<U+00AD><U+200B>-<U+200D>...]/`) renders as `[\\-]` in review and on
GitHub. That is the Trojan Source shape the repo's own guards refuse. Ask for
`\uXXXX` escapes. ESLint here did not flag it.

**How to apply:** for any "cleanse at ingest" diff, grep for every function
that compares an adapter label to a stored value or to stored metadata, and
check its fold is at least as wide as the cleanse. Treat a filter that decides
which ids are returned as a link-loss path.

**Stored key vs comparison key split (later in NEO-643).** Stored keys kept
main's hyphen-inside-token; comparisons read a hyphen as a space. Two checks
that paid off: (1) diff `normalizeEntityName` against
`git show origin/main:` over every BMP char and test only "does the key
contain a hyphen" — 0 drift proves no re-key. (2) A filter that runs over
index hits with the COMPARISON reading must be a superset of main's filter.
Splitting a stored token on the hyphen does not re-join initials, while the
typed comparison reading does: stored "k-c royals" splits to k, c, royals,
typed "K-C Royals" reads as kc, royals, so the row drops. Fix: OR main's
stored-reading test into the filter.
