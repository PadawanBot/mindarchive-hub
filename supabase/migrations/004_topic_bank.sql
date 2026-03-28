-- Topic Bank: persistent topic storage per channel profile
create table if not exists topic_bank (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references channel_profiles(id) on delete cascade,
  title text not null,
  angle text not null default '',
  keywords text[] default '{}',
  estimated_interest text not null default 'medium',
  reasoning text not null default '',
  status text not null default 'available',
  project_id uuid references projects(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_topic_bank_profile on topic_bank(profile_id);
create index if not exists idx_topic_bank_profile_status on topic_bank(profile_id, status);
