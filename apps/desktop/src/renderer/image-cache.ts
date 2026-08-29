import type { SentImageMessage } from "./types";

export type SentImagesSnapshot = Record<string, SentImageMessage[]>;

const DATABASE_NAME = "pideck-cache";
const STORE_NAME = "snapshots";
const SNAPSHOT_KEY = "sent-images.v1";

type StoredSnapshot = { key: string; value: SentImagesSnapshot };

async function openDatabase() {
  if (typeof indexedDB === "undefined") return null;
  const { openDB } = await import("idb");
  return openDB(DATABASE_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "key" });
    },
  });
}

export async function readSentImagesCache(): Promise<SentImagesSnapshot | null> {
  try {
    const database = await openDatabase();
    if (!database) return null;
    try {
      const stored = await database.get(STORE_NAME, SNAPSHOT_KEY) as StoredSnapshot | undefined;
      return stored?.value && typeof stored.value === "object" ? stored.value : null;
    } finally {
      database.close();
    }
  } catch {
    return null;
  }
}

export async function writeSentImagesCache(value: SentImagesSnapshot): Promise<boolean> {
  try {
    const database = await openDatabase();
    if (!database) return false;
    try {
      await database.put(STORE_NAME, { key: SNAPSHOT_KEY, value } satisfies StoredSnapshot);
      return true;
    } finally {
      database.close();
    }
  } catch {
    return false;
  }
}
