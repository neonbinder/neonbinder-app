---
name: reference-external-links-house-pattern
description: House external link = <a target=_blank rel="noopener noreferrer"> in text-neon-blue-text underline with a trailing sr-only " (opens in new tab)" span; arrow glyph aria-hidden
metadata:
  type: reference
---
See LeagueManagement.tsx and EntityReviewWizard.tsx (Wikidata/Wikipedia links)
and PublisherChecklistLinks.tsx. Accessible name ends "(opens in new tab)", so
specs find it by role link + name and assert href/target/rel without ever
clicking (specs must not visit outside sites). Min height 24px, 44px on a phone
(`min-h-6 max-sm:min-h-11`).
