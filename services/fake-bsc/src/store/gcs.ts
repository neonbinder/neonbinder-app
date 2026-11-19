/**
 * The bucket store: a private, versioned GCS bucket in the dev project. The
 * runtime SA reads and writes it; recordings never go into a repo.
 */
import { Storage, type Bucket } from "@google-cloud/storage";
import { MANIFEST_OBJECT, ManifestConflictError, type ManifestRead, type MissObjectStore, type ObjectStore, type StoredVersion } from "./types";

function code(err: unknown): number | undefined {
  const c = (err as { code?: unknown })?.code;
  return typeof c === "number" ? c : undefined;
}

export class GcsStore implements ObjectStore, MissObjectStore {
  private readonly bucket: Bucket;

  constructor(bucketName: string, storage: Storage = new Storage()) {
    this.bucket = storage.bucket(bucketName);
  }

  describe(): string {
    return "gcs";
  }

  async read(name: string): Promise<unknown | null> {
    try {
      const [buf] = await this.bucket.file(name).download();
      return JSON.parse(buf.toString("utf8"));
    } catch (err) {
      if (code(err) === 404) return null;
      throw err;
    }
  }

  async write(name: string, value: unknown): Promise<void> {
    await this.bucket.file(name).save(JSON.stringify(value), {
      contentType: "application/json",
      resumable: false,
    });
  }

  async list(prefix: string): Promise<string[]> {
    const [files] = await this.bucket.getFiles({ prefix });
    return files.map((f) => f.name).sort();
  }

  async readManifest(): Promise<ManifestRead | null> {
    try {
      // Metadata first, then that exact generation, so the generation the
      // conditional write checks is the one whose bytes were read.
      const [meta] = await this.bucket.file(MANIFEST_OBJECT).getMetadata();
      if (meta.generation === undefined) return null;
      const generation = String(meta.generation);
      const [buf] = await this.bucket.file(MANIFEST_OBJECT, { generation }).download();
      return { value: JSON.parse(buf.toString("utf8")), generation };
    } catch (err) {
      if (code(err) === 404) return null;
      throw err;
    }
  }

  async writeManifest(value: unknown, expected: string | null): Promise<void> {
    try {
      await this.bucket.file(MANIFEST_OBJECT).save(JSON.stringify(value), {
        contentType: "application/json",
        resumable: false,
        preconditionOpts: { ifGenerationMatch: expected === null ? 0 : Number(expected) },
      });
    } catch (err) {
      if (code(err) === 412) throw new ManifestConflictError();
      throw err;
    }
  }

  async createOnce(name: string, value: unknown): Promise<string | null> {
    const file = this.bucket.file(name);
    try {
      await file.save(JSON.stringify(value), {
        contentType: "application/json",
        resumable: false,
        // Create-only: a second writer (or a retry after a lost answer) gets 412.
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    } catch (err) {
      if (code(err) === 412) return null;
      throw err;
    }
    const generation = file.metadata?.generation;
    if (generation === undefined || generation === null) throw new Error("upload answered no generation");
    return String(generation);
  }

  async listVersions(prefix: string, limit: number): Promise<StoredVersion[]> {
    const [files] = await this.bucket.getFiles({ prefix, maxResults: limit, autoPaginate: true });
    const out: StoredVersion[] = [];
    for (const f of files) {
      const g = f.metadata?.generation;
      if (g !== undefined && g !== null) out.push({ name: f.name, generation: String(g) });
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async readVersion(name: string, generation: string): Promise<unknown | null> {
    try {
      const [buf] = await this.bucket.file(name, { generation }).download();
      return JSON.parse(buf.toString("utf8"));
    } catch (err) {
      if (code(err) === 404) return null;
      throw err;
    }
  }

  async deleteVersion(name: string, generation: string): Promise<void> {
    // A File scoped to a generation deletes that generation permanently
    // (the `generation` query parameter), leaving no noncurrent version.
    await this.bucket.file(name, { generation }).delete({ ignoreNotFound: true });
  }
}
