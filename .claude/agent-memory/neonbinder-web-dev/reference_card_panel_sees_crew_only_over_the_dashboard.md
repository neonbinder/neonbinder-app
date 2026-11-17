---
name: reference-card-panel-sees-crew-only-over-the-dashboard
description: The collection card panel (CardDetail) gets useCrew() only when opened over the signed-in dashboard; Collection, Inventory and the demo give null, and a held-back notice only exists on the dashboard
metadata:
  type: reference
---

`useCrew()` (app/dashboard/screen/crew.ts) is provided by `CrewProvider` in
app/dashboard/page.tsx around `DashboardScreen`. The card panel over the
dashboard (`DashboardCardPanel` → lazy `CardPanelHost` → `OpenCardDrawer` →
CardDetail) renders inside it, so CardDetail can call `useCrew()` and offer the
crew's Report. On /collection and /inventory, and on the logged-out demo, it is
null. The `held` notice (`?held=<platform>.<reason>`) is also passed only by
CardPanelHost, so on Collection/Inventory there is no held notice at all.

**Import rule:** CardDetail must not import app/dashboard/screen/SyncStatus.tsx
(SyncStatus → panelLink → lazy CardPanelHost → CardDetail is a cycle, and it
pulls the dashboard screen into the collection chunk). Shared crew UI lives in
its own pure module (`ReportToCrew.tsx`, NEO-569) importing only crew.ts,
dash-labels.ts and primitives.

**Copy check:** a sentence that says "Report it" is reachable only where crew
is non-null. Inventory's Sync status tab (SyncStatusView) has no crew, so a
reportable reason's sentence there must not promise a Report button on that
screen. Related: [[operator-copy-must-be-reachable-and-actionable]].
