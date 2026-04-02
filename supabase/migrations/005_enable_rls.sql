-- Migration 005: Enable Row Level Security on all public tables
-- Applied: 2026-04-02
-- Reason: Supabase security alert — tables publicly accessible without RLS
-- 
-- Service role (used by Vercel API routes via SUPABASE_SECRET_KEY) bypasses RLS automatically.
-- Anon key (public JS bundle) will be blocked from direct table access.
-- No explicit policies needed for current architecture.

alter table if exists public.settings enable row level security;
alter table if exists public.channel_profiles enable row level security;
alter table if exists public.format_presets enable row level security;
alter table if exists public.projects enable row level security;
alter table if exists public.pipeline_steps enable row level security;
alter table if exists public.assets enable row level security;
alter table if exists public.cost_ledger enable row level security;
alter table if exists public.topic_bank enable row level security;
