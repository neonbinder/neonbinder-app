---
name: patterns-convex-client-error-origin
description: How to tell a server-returned Convex error from a client-side one when reporting caught errors to Sentry, and why client-side convexToJson errors carry the call's args
metadata:
  type: project
---

When a catch reports a Convex call's error to Sentry, the two origins need different handling, and the markers are not equally reliable.

- `[CONVEX M(module:fn)]` / `A(` / `Q(` is added by the CLIENT (`createHybridErrorStacktrace` in convex/browser/logging) to every server-returned failure. It is the reliable "this came from the server" marker.
- `[Request ID: x]` is text inside the SERVER's `errorMessage`. Useful as a tag, but keying origin on it alone fails open: a server message without it would be treated as client text and sent.
- A `ConvexError` carries `.data`; its presence also means server-origin.
- Client-side `convexToJson` errors ("undefined is not a valid Convex value", "X is not a supported Convex type") embed `JSON.stringify` of the WHOLE original args object (Convex truncates at 16 KB) after "in original object". A "send the client message, capped" rule therefore sends the head of the args. Field-name errors ("Field name X has invalid character") carry only the key.

**Why:** NEO-625 added a caught-error Sentry helper whose plan promised "never attach args", while the client-origin path sent 300 chars of a message that can contain the args.

**How to apply:** for any caught-error reporter, require origin = server if the `[CONVEX X(` prefix OR a request id OR `.data` is present, and require client text to be cut at " (present at path" before capping. Related: [[patterns_coded_convex_error_oracle]].
