/**
 * The fake BSC's namespaces (CONTRACT.md, "Accounts and per-run isolation"):
 * pure and runtime-free, so a mutation, an action and the BSC call gate all
 * derive the same value. Re-exported by `testing.ts`.
 */

/**
 * The Convex deployment's slug from `CONVEX_CLOUD_URL`
 * (`https://<slug>.convex.cloud`), or null when it is missing or not the
 * shape a Convex slug has. Lowercase letters, digits and hyphens only, so it
 * is safe inside an email local part.
 */
export function convexSlugOf(cloudUrl: string | undefined): string | null {
  if (!cloudUrl) return null;
  const slug = /^https:\/\/([a-z0-9-]+)\.convex\.cloud\/?$/.exec(cloudUrl)?.[1];
  return slug ?? null;
}

/**
 * A stable, short tag for one test user: the first 12 hex digits of the
 * FNV-1a 64-bit hash of their Clerk subject. Stable across runs and
 * deployments (the same worker account always has the same tag), and it keeps
 * the Clerk id itself off the fake. Synchronous and runtime-free, so a
 * mutation and an action derive the same value.
 */
export function fakeBscUserTag(userId: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(userId)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0").slice(0, 12);
}

/**
 * Every namespace this deployment owns on the fake starts with this:
 * `<convexSlug>-`. The trailing hyphen keeps one slug from matching another
 * that merely starts with it.
 */
export function fakeBscPrefixFor(cloudUrl: string | undefined): string {
  const slug = convexSlugOf(cloudUrl);
  if (!slug) {
    // Fail closed: a namespace with no deployment in it could collide with
    // another deployment's, and a reset by an empty prefix would clear them all.
    throw new Error("Fake BuySportsCards needs this deployment's CONVEX_CLOUD_URL");
  }
  return `${slug}-`;
}

/** The test user's namespace on the fake: `<convexSlug>-<userTag>`. */
export function fakeBscNamespaceFor(userId: string, cloudUrl: string | undefined): string {
  return `${fakeBscPrefixFor(cloudUrl)}${fakeBscUserTag(userId)}`;
}

