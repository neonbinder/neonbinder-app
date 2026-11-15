/**
 * Fake accounts (CONTRACT.md, "Accounts and per-run isolation"): the sign-in
 * username `nb+<convexSlug>-<userTag>@fake.invalid` names the namespace that
 * holds one run's state. Shared by the server and the identity endpoints.
 */

export const NAMESPACE_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

const USERNAME_RE = /^nb\+([^@]+)@fake\.invalid$/i;

/** The namespace a fake username names, or null for any other username. */
export function namespaceFromUsername(username: string): string | null {
  if (typeof username !== "string") return null;
  const m = USERNAME_RE.exec(username.trim());
  if (!m) return null;
  const ns = m[1].toLowerCase();
  return NAMESPACE_RE.test(ns) ? ns : null;
}

export function isNamespace(value: unknown): value is string {
  return typeof value === "string" && NAMESPACE_RE.test(value);
}

/** `{ns}` (exact) or `{prefix}` (startsWith); `{}` selects every namespace. */
export interface NamespaceSelector {
  ns?: string;
  prefix?: string;
}

export function matchesSelector(ns: string, sel: NamespaceSelector): boolean {
  if (sel.ns !== undefined) return ns === sel.ns;
  if (sel.prefix !== undefined) return ns.startsWith(sel.prefix);
  return true;
}

/**
 * Reads `{ns}` or `{prefix}` from an untrusted body. A prefix must look like
 * the start of a namespace and be at least 3 characters, so a typo cannot
 * select every run. Null when neither is valid.
 */
export function readSelector(body: unknown): NamespaceSelector | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.ns !== undefined) return isNamespace(b.ns) ? { ns: b.ns } : null;
  if (typeof b.prefix === "string" && b.prefix.length >= 3 && /^[a-z0-9][a-z0-9-]{2,99}$/.test(b.prefix)) {
    return { prefix: b.prefix };
  }
  return null;
}

/**
 * The `x-nb-fake-ns` header on a request with no BSC token (CONTRACT.md,
 * "Module seams"). A value ending in `-` is a deployment prefix (the
 * background team lane, which has no user); any other value is one namespace.
 * Strict: the whole value must match the namespace pattern, and a prefix must
 * be at least 3 characters, like a `{prefix}` selector. Anything else is null,
 * read as no header.
 */
export function readHeaderScope(value: unknown): { ns: string } | { prefix: string } | null {
  if (!isNamespace(value)) return null;
  if (value.endsWith("-")) return value.length >= 3 ? { prefix: value } : null;
  return { ns: value };
}
