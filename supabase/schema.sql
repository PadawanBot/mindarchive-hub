-- MindArchive Production Hub — Supabase Schema
-- Run this in Supabase SQL Editor to create all tables

-- ─── Settings (encrypted API keys, preferences) ───
create table if not exists settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value text not null,  -- encrypted for API keys
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── Channel Profiles ───
create table if not exists channel_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  niche text not null default '',
  description text not null default '',
  voice_style text not null default 'professional',
  brand_colors text[] default '{}',
  target_audience text not null default '',
  llm_provider text not null default 'anthropic',
  llm_model text not null default 'claude-sonnet-4-6',
  image_provider text not null default 'dalle',
  voice_provider text not null default 'elevenlabs',
  voice_id text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── Format Presets ───
create table if not exists format_presets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  duration_min int not null,
  duration_max int not null,
  word_count_min int not null,
  word_count_max int not null,
  wpm int not null default 145,
  sections text[] not null default '{}',
  description text not null default '',
  is_builtin boolean default false,
  created_at timestamptz default now()
);

-- ─── Projects ───
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  topic text not null default '',
  profile_id uuid references channel_profiles(id) on delete set null,
  format_id uuid references format_presets(id) on delete set null,
  status text not null default 'draft',
  total_cost_cents int not null default 0,
  output_url text,
  script_data jsonb,
  topic_data jsonb,
  visual_data jsonb,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── Pipeline Steps (per project) ───
create table if not exists pipeline_steps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  step text not null,
  status text not null default 'pending',
  output jsonb,
  error text,
  cost_cents int default 0,
  duration_ms int default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now(),
  modified_at timestamptz                             -- set when assets are manually replaced
);

create index if not exists idx_pipeline_steps_project on pipeline_steps(project_id);

-- ─── Assets (generated files: images, audio, video) ───
create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  type text not null,  -- 'image', 'audio', 'video', 'thumbnail'
  filename text not null,
  storage_path text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes int default 0,
  metadata jsonb default '{}',
  step text,                                          -- pipeline step this asset belongs to
  slot_key text,                                      -- output field path e.g. "images[2].url"
  source text not null default 'generated',           -- 'generated' | 'manual'
  url text,                                           -- public URL of the asset
  width int,
  height int,
  duration_ms int,
  created_at timestamptz default now()
);

create index if not exists idx_assets_project on assets(project_id);
create unique index if not exists idx_assets_project_step_slot on assets(project_id, step, slot_key);

-- ─── Cost Ledger ───
create table if not exists cost_ledger (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  provider text not null,
  operation text not null,
  input_tokens int default 0,
  output_tokens int default 0,
  cost_cents int not null default 0,
  created_at timestamptz default now()
);

create index if not exists idx_cost_ledger_project on cost_ledger(project_id);

-- ─── Seed built-in format presets ───
insert into format_presets (name, type, duration_min, duration_max, word_count_min, word_count_max, wpm, sections, description, is_builtin) values
  ('Documentary', 'documentary', 480, 600, 1120, 1400, 140,
   '{"hook","intro","section_1","section_2","section_3","conclusion","cta"}',
   'Deep-dive documentary style. 8-10 minutes, rich narration with cinematic visuals.', true),
  ('Explainer', 'explainer', 300, 420, 750, 1050, 150,
   '{"hook","problem","solution","examples","conclusion","cta"}',
   'Clear explainer format. 5-7 minutes, focused on making complex topics simple.', true),
  ('Listicle', 'listicle', 600, 900, 1450, 2175, 145,
   '{"hook","intro","item_1","item_2","item_3","item_4","item_5","conclusion","cta"}',
   'Numbered list format. 10-15 minutes, high retention through countdown structure.', true),
  ('Tutorial', 'tutorial', 420, 600, 1050, 1500, 150,
   '{"hook","overview","step_1","step_2","step_3","step_4","recap","cta"}',
   'Step-by-step tutorial. 7-10 minutes, practical and actionable.', true),
  ('Storytime', 'storytime', 360, 540, 900, 1350, 150,
   '{"cold_open","setup","rising_action","climax","resolution","lesson","cta"}',
   'Narrative storytelling. 6-9 minutes, emotional arc with a takeaway.', true),
  ('Debate', 'debate', 480, 720, 1120, 1680, 140,
   '{"hook","context","side_a","side_b","analysis","verdict","cta"}',
   'Two-sided analysis. 8-12 minutes, balanced exploration of controversial topics.', true)
on conflict do nothing;

-- ─── Row-level security (optional, enable when auth is added) ───
-- alter table settings enable row level security;
-- alter table channel_profiles enable row level security;
-- alter table projects enable row level security;
