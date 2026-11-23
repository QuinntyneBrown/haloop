import { Injectable } from '@angular/core';

export type HaloopStoreKey =
  | 'profile'
  | 'preferences'
  | 'sessions'
  | 'coachMessages'
  | 'devices'
  | 'models';

const STORAGE_PREFIX = 'haloop:v1:';

/**
 * Local-first persistence adapter backed by IndexedDB when available with
 * synchronous localStorage fallback for constrained environments and tests.
 * Zero remote network transmission ever occurs (L2-026, L2-027).
 */
@Injectable({ providedIn: 'root' })
export class HaloopDbService {
  private readonly memoryFallback = new Map<string, string>();
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  private openDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) {
      return this.dbPromise;
    }
    if (typeof indexedDB === 'undefined') {
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }
    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = indexedDB.open('haloop-db', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) {
            db.createObjectStore('kv');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  async get<T>(key: HaloopStoreKey): Promise<T | null> {
    const db = await this.openDb();
    if (db) {
      try {
        const val = await new Promise<T | null>((resolve, reject) => {
          const tx = db.transaction('kv', 'readonly');
          const req = tx.objectStore('kv').get(key);
          req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
          req.onerror = () => reject(req.error);
        });
        if (val !== null) {
          return val;
        }
      } catch {
        // Fall back to localStorage / memory below.
      }
    }
    const raw = this.readFallback(STORAGE_PREFIX + key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: HaloopStoreKey, value: T): Promise<void> {
    const serialized = JSON.stringify(value);
    this.writeFallback(STORAGE_PREFIX + key, serialized);

    const db = await this.openDb();
    if (db) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        const req = tx.objectStore('kv').put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  }

  async checkStorageAvailable(): Promise<boolean> {
    try {
      const testKey = `${STORAGE_PREFIX}probe`;
      this.writeFallback(testKey, '1');
      return this.readFallback(testKey) === '1';
    } catch {
      return false;
    }
  }

  private readFallback(key: string): string | null {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(key);
      }
    } catch {
      // Ignore private browsing localStorage errors.
    }
    return this.memoryFallback.get(key) ?? null;
  }

  private writeFallback(key: string, value: string): void {
    this.memoryFallback.set(key, value);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
      }
    } catch {
      // Ignore private browsing localStorage errors.
    }
  }
}
