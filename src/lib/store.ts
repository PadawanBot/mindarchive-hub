/**
 * Unified data store.
 * - Uses Supabase when NEXT_PUBLIC_SUPABASE_URL is configured (production/Vercel)
 * - Falls back to local JSON files when not configured (local dev)
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ─── Supabase client (cached, server-side) ───

let _sb: SupabaseClient | null | undefined;

function getSupabase(): SupabaseClient | null {
  if (_sb !== undefined) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.log("[store] Supabase not configured — url:", !!url, "key:", !!key);
    _sb = null;
    return null;
  }
  try {
    _sb = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return _sb;
  } catch (err) {
    console.error("[store] Failed to create Supabase client:", err);
    _sb = null;
    return null;
  }
}

function useSupabase(): boolean {
  return getSupabase() !== null;
}

// ─── Collection → Supabase table name mapping ───

const tableMap: Record<string, string> = {
  profiles: "channel_profiles",
  projects: "projects",
  settings: "settings",
  assets: "assets",
  cost_ledger: "cost_ledger",
  pipeline_steps: "pipeline_steps",
  topic_bank: "topic_bank",
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
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from(tableName(collection))
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error(`[store] getAll(${collection}) error:`, error.message);
      return [];
    }
    return (data || []) as T[];
  }
  const store = await getLocalStore();
  return store.read<T>(`${collection}.json`);
}

export async function getById<T extends { id: string }>(
  collection: string,
  id: string
): Promise<T | undefined> {
  const sb = getSupabase();
  if (sb) {
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
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from(tableName(collection))
      .insert(item)
      .select()
      .single();
    if (error) throw new Error(`[store] create(${collection}): ${error.message}`);
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
  const sb = getSupabase();
  if (sb) {
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
  const sb = getSupabase();
  if (sb) {
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

// ─── Generic filtered query ───

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getByField<T extends Record<string, any>>(
  collection: string,
  field: string,
  value: string
): Promise<T[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from(tableName(collection))
      .select("*")
      .eq(field, value)
      .order("created_at", { ascending: false });
    if (error) {
      console.error(`[store] getByField(${collection}, ${field}) error:`, error.message);
      return [];
    }
    return (data || []) as T[];
  }
  const store = await getLocalStore();
  const items = await store.read<T>(`${collection}.json`);
  return items
    .filter((item) => item[field] === value)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

// ─── Settings (key-value) ───

interface SettingRecord {
  id: string;
  key: string;
  value: string;
}

export async function getSetting(key: string): Promise<string | undefined> {
  const sb = getSupabase();
  if (sb) {
    const { data } = await sb
      .from("settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    return data?.value;
  }
  const store = await getLocalStore();
  const settings = await store.read<SettingRecord>("settings.json");
  return settings.find((s) => s.key === key)?.value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const sb = getSupabase();
  if (sb) {
    const { error } = await sb
      .from("settings")
      .upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
    if (error) throw new Error(`[store] setSetting(${key}): ${error.message}`);
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
  const sb = getSupabase();
  if (sb) {
    const { data } = await sb.from("settings").select("key, value");
    return Object.fromEntries((data || []).map((s: { key: string; value: string }) => [s.key, s.value]));
  }
  const store = await getLocalStore();
  const settings = await store.read<SettingRecord>("settings.json");
  return Object.fromEntries(settings.map((s) => [s.key, s.value]));
}

// ─── Pipeline Step Helpers ───

import type { StepResult } from "@/types";

export async function getStepsByProject(projectId: string): Promise<StepResult[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from(tableName("pipeline_steps"))
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error(`[store] getStepsByProject(${projectId}) error:`, error.message);
      return [];
    }
    return (data || []) as StepResult[];
  }
  const store = await getLocalStore();
  const allSteps = await store.read<StepResult & { project_id: string }>("pipeline_steps.json");
  return allSteps
    .filter((s) => s.project_id === projectId)
    .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
}

export async function upsertStep(
  projectId: string,
  step: string,
  data: Partial<StepResult>
): Promise<StepResult> {
  const sb = getSupabase();
  if (sb) {
    const payload = {
      ...data,
      project_id: projectId,
      step,
    };
    const { data: result, error } = await sb
      .from(tableName("pipeline_steps"))
      .upsert(payload, { onConflict: "project_id,step" })
      .select()
      .single();
    if (error) throw new Error(`[store] upsertStep(${projectId}, ${step}): ${error.message}`);
    return result as StepResult;
  }
  const store = await getLocalStore();
  const allSteps = await store.read<StepResult & { id: string; project_id: string }>("pipeline_steps.json");
  const now = new Date().toISOString();
  const index = allSteps.findIndex((s) => s.project_id === projectId && s.step === step);
  if (index >= 0) {
    allSteps[index] = { ...allSteps[index], ...data, project_id: projectId, step: step as StepResult["step"] };
  } else {
    allSteps.push({
      id: store.randomId(),
      project_id: projectId,
      step: step as StepResult["step"],
      status: "pending",
      created_at: now,
      ...data,
    } as StepResult & { id: string; project_id: string });
  }
  await store.write("pipeline_steps.json", allSteps);
  const saved = allSteps.find((s) => s.project_id === projectId && s.step === step);
  return saved as StepResult;
}
