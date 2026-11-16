/** Local-directory and in-memory stores, for tests and local dev. */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_OBJECT, ManifestConflictError, type ManifestRead, type MissObjectStore, type ObjectStore, type StoredVersion } from "./types";

const NAME_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function checkName(name: string): void {
  if (!NAME_RE.test(name) || name.split("/").some((s) => s === "." || s === "..")) {
    throw new Error("bad object name");
  }
}

function generationOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export class LocalDirStore implements ObjectStore, MissObjectStore {
  constructor(private readonly dir: string) {}

  describe(): string {
    return "local";
  }

  private file(name: string): string {
    checkName(name);
    return path.join(this.dir, ...name.split("/"));
  }

  async read(name: string): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(this.file(name), "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async write(name: string, value: unknown): Promise<void> {
    const file = this.file(name);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, file);
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(path.join(this.dir, rel), { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
      }
      for (const e of entries) {
        const name = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(name);
        else if (!e.name.endsWith(".tmp") && name.startsWith(prefix)) out.push(name);
      }
    };
    await walk("");
    return out.sort();
  }

  async readManifest(): Promise<ManifestRead | null> {
    try {
      const text = await readFile(this.file(MANIFEST_OBJECT), "utf8");
      return { value: JSON.parse(text), generation: generationOf(text) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async writeManifest(value: unknown, expected: string | null): Promise<void> {
    const current = await this.readManifest();
    if ((current?.generation ?? null) !== expected) throw new ManifestConflictError();
    await this.write(MANIFEST_OBJECT, value);
  }

  /** A local file's generation is the hash of its text. */
  private async readText(name: string): Promise<string | null> {
    try {
      return await readFile(this.file(name), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async createOnce(name: string, value: unknown): Promise<string | null> {
    const file = this.file(name);
    await mkdir(path.dirname(file), { recursive: true });
    const text = JSON.stringify(value);
    try {
      await writeFile(file, text, { flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return null;
      throw err;
    }
    return generationOf(text);
  }

  async listVersions(prefix: string, limit: number): Promise<StoredVersion[]> {
    const out: StoredVersion[] = [];
    for (const name of (await this.list(prefix)).slice(0, limit)) {
      const text = await this.readText(name);
      if (text !== null) out.push({ name, generation: generationOf(text) });
    }
    return out;
  }

  async readVersion(name: string, generation: string): Promise<unknown | null> {
    const text = await this.readText(name);
    return text !== null && generationOf(text) === generation ? JSON.parse(text) : null;
  }

  async deleteVersion(name: string, generation: string): Promise<void> {
    const text = await this.readText(name);
    if (text === null || generationOf(text) !== generation) return;
    try {
      await unlink(this.file(name));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

export class MemoryStore implements ObjectStore, MissObjectStore {
  private readonly objects = new Map<string, string>();
  /** Generation per object, bumped on every write (like GCS). */
  private readonly generations = new Map<string, string>();
  private nextGeneration = 1;

  private setObject(name: string, text: string): string {
    const g = String(this.nextGeneration++);
    this.objects.set(name, text);
    this.generations.set(name, g);
    return g;
  }

  describe(): string {
    return "memory";
  }

  async read(name: string): Promise<unknown | null> {
    checkName(name);
    const v = this.objects.get(name);
    return v === undefined ? null : JSON.parse(v);
  }

  async write(name: string, value: unknown): Promise<void> {
    checkName(name);
    this.setObject(name, JSON.stringify(value));
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }

  async readManifest(): Promise<ManifestRead | null> {
    const text = this.objects.get(MANIFEST_OBJECT);
    return text === undefined ? null : { value: JSON.parse(text), generation: generationOf(text) };
  }

  async writeManifest(value: unknown, expected: string | null): Promise<void> {
    const current = await this.readManifest();
    if ((current?.generation ?? null) !== expected) throw new ManifestConflictError();
    this.setObject(MANIFEST_OBJECT, JSON.stringify(value));
  }

  async createOnce(name: string, value: unknown): Promise<string | null> {
    checkName(name);
    if (this.objects.has(name)) return null;
    return this.setObject(name, JSON.stringify(value));
  }

  async listVersions(prefix: string, limit: number): Promise<StoredVersion[]> {
    return [...this.objects.keys()]
      .filter((k) => k.startsWith(prefix))
      .sort()
      .slice(0, limit)
      .map((name) => ({ name, generation: this.generations.get(name)! }));
  }

  async readVersion(name: string, generation: string): Promise<unknown | null> {
    const text = this.objects.get(name);
    return text !== undefined && this.generations.get(name) === generation ? JSON.parse(text) : null;
  }

  async deleteVersion(name: string, generation: string): Promise<void> {
    if (this.generations.get(name) !== generation) return;
    this.objects.delete(name);
    this.generations.delete(name);
  }
}
