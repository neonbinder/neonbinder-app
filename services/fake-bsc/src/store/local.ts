/** Local-directory and in-memory stores, for tests and local dev. */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_OBJECT, ManifestConflictError, type ManifestRead, type ObjectStore } from "./types";

const NAME_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function checkName(name: string): void {
  if (!NAME_RE.test(name) || name.split("/").some((s) => s === "." || s === "..")) {
    throw new Error("bad object name");
  }
}

function generationOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export class LocalDirStore implements ObjectStore {
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
}

export class MemoryStore implements ObjectStore {
  private readonly objects = new Map<string, string>();

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
    this.objects.set(name, JSON.stringify(value));
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
    this.objects.set(MANIFEST_OBJECT, JSON.stringify(value));
  }
}
