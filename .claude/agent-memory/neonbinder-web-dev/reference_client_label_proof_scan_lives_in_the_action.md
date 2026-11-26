---
name: reference_client_label_proof_scan_lives_in_the_action
description: A client-carried label (gate link origin "setHistory") is proved by the server's own scanSetHistory; a query ctx has no runQuery, so the action scans and hands the proof to the internalQuery
metadata:
  type: reference
---

`scanSetHistory` needs `ctx.runQuery`, which an `internalQuery` ctx lacks (mutations and actions have it). To prove a client label inside a checker query, scan in the calling action (`setHistory.proveSetHistoryLinks`) and pass the proven subset as an optional arg (absent = proves nothing, fail closed). A mutation can call the same scan (`setHistoryOffersPlayer`) but the scan then shares one transaction's read budget, so run it only on the fallback path after the cheap name/alias check fails.

Tests that commit a cross-sport `setHistory` link must seed the set's history: a card on a SIBLING leaf under the same setName with `playerLinks` (`nameOnCard` + `playerId`) and/or `teamOnCardIds`.
