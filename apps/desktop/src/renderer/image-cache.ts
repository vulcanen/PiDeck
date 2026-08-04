import type { SentImageMessage } from "./types";

export type SentImagesSnapshot = Record<string, SentImageMessage[]>;

const DATABASE_NAME = "pideck-cache";
const STORE_NAME = "snapshots";
const SNAPSHOT_KEY = "sent-images.v1";

type StoredSnapshot = { key: string; value: SentImagesSnapshot };

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
    } catch {
      resolve(null);
    }
  });
}

export async function readSentImagesCache(): Promise<SentImagesSnapshot | null> {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
      request.onerror = () => { database.close(); resolve(null); };
      request.onsuccess = () => {
        const value = request.result as StoredSnapshot | undefined;
        database.close();
        resolve(value?.value && typeof value.value === "object" ? value.value : null);
      };
    } catch {
      database.close();
      resolve(null);
    }
  });
}

export async function writeSentImagesCache(value: SentImagesSnapshot): Promise<boolean> {
  const database = await openDatabase();
  if (!database) return false;
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ key: SNAPSHOT_KEY, value } satisfies StoredSnapshot);
      transaction.onerror = () => { database.close(); resolve(false); };
      transaction.onabort = () => { database.close(); resolve(false); };
      transaction.oncomplete = () => { database.close(); resolve(true); };
    } catch {
      database.close();
      resolve(false);
    }
  });
}
