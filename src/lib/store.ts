/**
 * Local JSON store — used when Supabase is not configured.
 * Stores data in .mindarchive/ directory as JSON files.
 * This allows the app to work immediately without any external dependencies.
 */
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = path.join(process.cwd(), ".mindarchive");

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readStore<T>(filename: string): Promise<T[]> {
  await ensureDir();
  const filepath = path.join(DATA_DIR, filename);
  try {
    const data = await fs.readFile(filepath, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeStore<T>(filename: string, data: T[]): Promise<void> {
  await ensureDir();
  const filepath = path.join(DATA_DIR, filename);
  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
}

// ─── Generic CRUD ───

export async function getAll<T>(collection: string): Promise<T[]> {
  return readStore<T>(`${collection}.json`);
}

export async function getById<T extends { id: string }>(
  collection: string,
  id: string
): Promise<T | undefined> {
  const items = await readStore<T>(`${collection}.json`);
  return items.find((item) => item.id === id);
}

export async function create<T extends { id: string }>(
  collection: string,
  item: Omit<T, "id" | "created_at" | "updated_at"> & Partial<T>
): Promise<T> {
  const items = await readStore<T>(`${collection}.json`);
  const now = new Date().toISOString();
  const newItem = {
    ...item,
    id: crypto.randomUUID(),
    created_at: now,
    updated_at: now,
  } as unknown as T;
  items.push(newItem);
  await writeStore(`${collection}.json`, items);
  return newItem;
}

export async function update<T extends { id: string }>(
  collection: string,
  id: string,
  updates: Partial<T>
): Promise<T | undefined> {
  const items = await readStore<T>(`${collection}.json`);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return undefined;
  items[index] = {
    ...items[index],
    ...updates,
    updated_at: new Date().toISOString(),
  } as T;
  await writeStore(`${collection}.json`, items);
  return items[index];
}

export async function remove<T extends { id: string }>(
  collection: string,
  id: string
): Promise<boolean> {
  const items = await readStore<T>(`${collection}.json`);
  const filtered = items.filter((item) => item.id !== id);
  if (filtered.length === items.length) return false;
  await writeStore(`${collection}.json`, filtered);
  return true;
}

// ─── Settings (key-value) ───

interface SettingRecord {
  id: string;
  key: string;
  value: string;
}

export async function getSetting(key: string): Promise<string | undefined> {
  const settings = await readStore<SettingRecord>("settings.json");
  return settings.find((s) => s.key === key)?.value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const settings = await readStore<SettingRecord>("settings.json");
  const index = settings.findIndex((s) => s.key === key);
  if (index >= 0) {
    settings[index].value = value;
  } else {
    settings.push({ id: crypto.randomUUID(), key, value });
  }
  await writeStore("settings.json", settings);
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const settings = await readStore<SettingRecord>("settings.json");
  return Object.fromEntries(settings.map((s) => [s.key, s.value]));
}
