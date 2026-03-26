-- Add asset_sources JSONB column to channel_profiles
-- Stores default asset type preferences: { dalle_images, stock_footage, hero_scenes }
ALTER TABLE channel_profiles ADD COLUMN IF NOT EXISTS asset_sources jsonb DEFAULT '{"dalle_images": true, "stock_footage": true, "hero_scenes": true}';

-- Also add asset_sources to projects table for per-project overrides
ALTER TABLE projects ADD COLUMN IF NOT EXISTS asset_sources jsonb;
