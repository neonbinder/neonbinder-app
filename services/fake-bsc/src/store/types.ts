/**
 * Where recordings, the manifest and write captures live (CONTRACT.md,
 * "Storage layout"): a private GCS bucket in the dev project, a local
 * directory for tests and dev, or memory. The server loads everything into
 * memory at boot; these stores are touched again only on upload.
 */

export class ManifestConflictError extends Error {
  constructor() {
    super("manifest changed underneath this write");
  }
}

export interface ManifestRead {
  value: unknown;
  /** Opaque generation for the conditional write; null when absent. */
  generation: string | null;
}

export interface ObjectStore {
  describe(): string;
  /** null when the object does not exist. */
  read(name: string): Promise<unknown | null>;
  write(name: string, value: unknown): Promise<void>;
  list(prefix: string): Promise<string[]>;
  readManifest(): Promise<ManifestRead | null>;
  /**
   * Writes `manifest.json` only when its generation is still `expected`
   * (null: only when it does not exist). Throws ManifestConflictError otherwise.
   */
  writeManifest(value: unknown, expected: string | null): Promise<void>;
}

export const MANIFEST_OBJECT = "manifest.json";

/** One live object and the generation it is at. */
export interface StoredVersion {
  name: string;
  generation: string;
}

/**
 * What durable misses need of the store (CONTRACT.md, "Durable misses").
 * Every delete names a generation: the bucket is versioned, and a plain
 * delete would leave a noncurrent version its lifecycle rule never reaps.
 */
export interface MissObjectStore {
  describe(): string;
  /**
   * Creates `name` only when it does not exist (a create-only precondition).
   * Resolves the new object's generation, or null when it already existed.
   */
  createOnce(name: string, value: unknown): Promise<string | null>;
  /** Live objects under `prefix` with their generations, at most `limit`. */
  listVersions(prefix: string, limit: number): Promise<StoredVersion[]>;
  /** That generation's JSON, or null when it is gone. */
  readVersion(name: string, generation: string): Promise<unknown | null>;
  /** Permanently deletes that generation; one already gone is not an error. */
  deleteVersion(name: string, generation: string): Promise<void>;
}
