// File cache adapter for dev: one JSON file per request key under .qloo-private/cache/. That directory is
// gitignored. The adapter refuses any directory that is not inside a `.qloo-private` folder, so Qloo data
// cannot be written to a tracked path by mistake. Server-side only.

import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { CACHE_ENTRY_VERSION, type CacheEntry, type QlooCacheAdapter } from "./cache";

export const DEFAULT_CACHE_DIR = join(".qloo-private", "cache");

export function createFileCache(dir: string = join(process.cwd(), DEFAULT_CACHE_DIR)): QlooCacheAdapter {
  // The ignore comment keeps Turbopack from tracing the whole project: the directory is a runtime value that
  // is checked below, and this adapter is dev and local only.
  const root = resolve(/*turbopackIgnore: true*/ dir);
  if (!root.split(sep).includes(".qloo-private")) {
    throw new Error(`Qloo file cache must live inside a .qloo-private directory, got ${root}`);
  }
  const fileFor = (key: string) => {
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("invalid cache key");
    return join(root, `${key}.json`);
  };
  return {
    async get(key) {
      let text: string;
      try {
        text = await readFile(fileFor(key), "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
      const entry = JSON.parse(text) as CacheEntry;
      return entry.v === CACHE_ENTRY_VERSION && entry.key === key ? entry : null;
    },
    async set(entry) {
      await mkdir(root, { recursive: true });
      const file = fileFor(entry.key);
      const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await writeFile(tmp, JSON.stringify(entry));
      await rename(tmp, file);
    },
  };
}
