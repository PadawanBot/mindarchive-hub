-- Asset Management: add columns to assets table + modified_at to pipeline_steps
-- Run this on existing Supabase projects to upgrade the schema

-- Assets: step tracking, slot key, source, URL, media metadata
ALTER TABLE assets ADD COLUMN IF NOT EXISTS step text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS slot_key text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'generated';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS url text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS width int;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS height int;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS duration_ms int;

CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_project_step_slot
  ON assets(project_id, step, slot_key);

-- Pipeline steps: track manual modifications separately from pipeline completion
ALTER TABLE pipeline_steps ADD COLUMN IF NOT EXISTS modified_at timestamptz;
