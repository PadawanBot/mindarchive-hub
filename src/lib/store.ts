/**
 * Unified data store.
 * - Uses Supabase when NEXT_PUBLIC_SUPABASE_URL is configured (production/Vercel)
 * - Falls back to local JSON files when not configured (local dev)
 */
import { createClient } from "@supabase/supabase-js";

// ─── Supabase client (server-side, no cookie dependency) ───

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Support both new Supabase key format and legacy key names
  const key = process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function useSupabase(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return !!url && !!key;
}

// ─── Collection → Supabase table name mapping ───

const tableMap: Record<string, string> = {
  profiles: "channel_profiles",
  projects: "projects",
  settings: "settings",
  assets: "assets",
  cost_ledger: "cost_ledger",
  pipeline_steps: "pipeline_steps",
};

function tableName(collection: string): string {
  return tableMap[collection] || collection;
}

// ─── Local JSON store (fallback for dev) ───

async function getLocalStore() {
  const { promises: fs } = await import("fs");
  const path = await import("path");
  const crypto = await import("crypto");
  const DATA_DIR = path.join(process.cwd(), ".mindarchive");
  await fs.mkdir(DATA_DIR, { recursive: true });

  return {
    async read<T>(filename: string): Promise<T[]> {
      try {
        const data = await fs.readFile(path.join(DATA_DIR, filename), "utf-8");
        return JSON.parse(data);
      } catch {
        return [];
      }
    },
    async write<T>(filename: string, data: T[]): Promise<void> {
      await fs.writeFile(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
    },
    randomId: () => crypto.randomUUID(),
  };
}

// ─── Generic CRUD ───

export async function getAll<T>(collection: string): Promise<T[]> {
  if (useSupabase()) {
    const sb = getSupabase()!;
    const { data, error } = await sb
      .from(tableName(collection))
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []) as T[];
  }
  const store = await getLocalStore();
  return store.read<T>(`${collection}.json`);
}

export async function getById<T extends { id: string }>(
  collection: string,
  id: string
): Promise<T | undefined> {
  if (useSupabase()) {
    const sb = getSupabase()!;
    const { data, error } = await sb
      .from(tableName(collection))
      .select("*")
      .eq("id", id)
      .single();
    if (error) return undefined;
    return data as T;
  }
  const store = await getLocalStore();
  const items = await store.read<T>(`${collection}.json`);
  return items.find((item) => item.id === id);
}

export async function create<T extends { id: string }>(
  collection: string,
  item: Omit<T, "id" | "created_at" | "updated_at"> & Partial<T>
): Promise<T> {
  if (useSupabase()) {
    const sb = getSupabase()!;
    const { data, error } = await sb
      .from(tableName(collection))
      .insert(item)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as T;
  }
  const store = await getLocalStore();
  const items = await store.read<T>(`${collection}.json`);
  const now = new Date().toISOString();
  const newItem = {
    ...item,
    id: store.randomId(),
    created_at: now,
    updated_at: now,
  } as unknown as T;
  items.push(newItem);
  await store.write(`${collection}.json`, items);
  return newItem;
}

export async function update<T extends { id: string }>(
  collection: string,
  id: string,
  updates: Partial<T>
): Promise<T | undefined> {
  if (useSupabase()) {
    const sb = getSupabase()!;
    const { data, error } = await sb
      .from(tableName(collection))
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) return undefined;
    return data as T;
  }
  const store = await getLocalStore();
  const items = await store.read<T>(`${collection}.json`);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return undefined;
  items[index] = {
    ...items[index],
    ...updates,
    updated_at: new Date().toISOString(),
  } as T;
  await store.write(`${collection}.json`, items);
  return items[index];
}

export async function remove<T extends { id: string }>(
  collection: string,
  id: string
): Promise<boolean> {
  if (useSupabase()) {
    const sb = getSupabase()!;
    const { error } = await sb
      .from(tableName(collection))
      .delete()
      .eq("id", id);
    return !error;
  }
  const store = await getLocalStore();
  const items = await store.read<T>(`${collection}.json`);
  const filtered = items.filter((item) => item.id !== id);
  if (filtered.length === items.length) return false;
  await store.write(`${collection}.json`, filtered);
  return true;
}

// ─── Settings (key-value) ───

interface SettingRecord {
  id: string;
  key: string;
  value: string;
}

export async function getSetting(key: string): Promise<string | undefined> {
  if (useSupabase()) {
    const sb = getSupabase()!;
    const { data } = await sb
      .from("settings")
      .select("value")
      .eq("key", key)
      .single();
    return data?.value;
  }
  const store = await getLocalStore();
  const settings = await store.read<SettingRecord>("settings.json");
  return settings.find((s) => s.key === key)?.value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  if (useSupabase()) {
    const sb = getSupabase()!;
    const { data: existing } = await sb
      .from("settings")
      .select("id")
      .eq("key", key)
      .single();
    if (existing) {
      await sb.from("settings").update({ value, updated_at: new Date().toISOString() }).eq("key", key);
    } else {
      await sb.from("settings").insert({ key, value });
    }
    return;
  }
  const store = await getLocalStore();
  const settings = await store.read<SettingRecord>("settings.json");
  const index = settings.findIndex((s) => s.key === key);
  if (index >= 0) {
    settings[index].value = value;
  } else {
    settings.push({ id: store.randomId(), key, value });
  }
  await store.write("settings.json", settings);
}

export async function getAllSettings(): Promise<Record<string, string>> {
  if (useSupabase()) {
    const sb = getSupabase()!;
    const { data } = await sb.from("settings").select("key, value");
    return Object.fromEntries((data || []).map((s: { key: string; value: string }) => [s.key, s.value]));
  }
  const store = await getLocalStore();
  const settings = await store.read<SettingRecord>("settings.json");
  return Object.fromEntries(settings.map((s) => [s.key, s.value]));
}
