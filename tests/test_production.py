"""Tests for production helpers, compositor, and context building."""

from __future__ import annotations

from pathlib import Path

import pytest


class TestProductionHelpers:
    def test_extract_narration(self):
        from mindarchive.production.steps import _extract_narration

        script = """
Welcome to this documentary about the Dark Triad.
[DALLE: A shadowy figure in a corporate office]
The Dark Triad refers to three personality traits.
[STOCK: office workers, corporate environment]
Narcissism is the first of these traits.
[MOTION_GRAPHIC: 3 Traits\nNarcissism, Machiavellianism, Psychopathy]
[RUNWAY: Dramatic zoom into a mirror reflecting a distorted face]
"""
        narration = _extract_narration(script)
        assert "Welcome to this documentary" in narration
        assert "Dark Triad refers to three" in narration
        assert "Narcissism is the first" in narration
        # Tags should be stripped
        assert "[DALLE:" not in narration
        assert "[STOCK:" not in narration
        assert "[MOTION_GRAPHIC:" not in narration
        assert "[RUNWAY:" not in narration

    def test_extract_narration_empty(self):
        from mindarchive.production.steps import _extract_narration

        assert _extract_narration("") == ""

    def test_extract_tagged_scenes_dalle(self):
        from mindarchive.production.steps import _extract_tagged_scenes

        script = """
[DALLE: A dark room with a single spotlight]
Some narration here.
[DALLE: Corporate boardroom, intense meeting]
More narration.
[STOCK: city skyline at night]
"""
        scenes = _extract_tagged_scenes(script, "DALLE")
        assert len(scenes) == 2
        assert scenes[0]["scene_id"] == 0
        assert "dark room" in scenes[0]["prompt"]
        assert scenes[1]["scene_id"] == 1
        assert "boardroom" in scenes[1]["prompt"]

    def test_extract_tagged_scenes_stock(self):
        from mindarchive.production.steps import _extract_tagged_scenes

        script = "[STOCK: busy street, pedestrians] text [STOCK: ocean waves]"
        scenes = _extract_tagged_scenes(script, "STOCK")
        assert len(scenes) == 2

    def test_extract_tagged_scenes_runway(self):
        from mindarchive.production.steps import _extract_tagged_scenes

        script = "[RUNWAY: Camera slowly zooms into mirror]"
        scenes = _extract_tagged_scenes(script, "RUNWAY")
        assert len(scenes) == 1
        assert "mirror" in scenes[0]["prompt"]

    def test_extract_tagged_scenes_none(self):
        from mindarchive.production.steps import _extract_tagged_scenes

        assert _extract_tagged_scenes("No tags here.", "DALLE") == []

    def test_extract_tagged_scenes_motion_graphic(self):
        from mindarchive.production.steps import _extract_tagged_scenes

        script = "[MOTION_GRAPHIC: 85%\nOf people show at least one trait]"
        scenes = _extract_tagged_scenes(script, "MOTION_GRAPHIC")
        assert len(scenes) == 1
        assert "85%" in scenes[0]["prompt"]


class TestBuildTimeline:
    def test_empty_timeline(self):
        from mindarchive.production.steps import ProductionContext, _build_timeline

        ctx = ProductionContext(project_slug="test", output_dir=Path("/tmp"))
        timeline = _build_timeline(ctx)
        assert timeline == []

    def test_timeline_priority(self):
        from mindarchive.production.steps import ProductionContext, _build_timeline

        ctx = ProductionContext(project_slug="test", output_dir=Path("/tmp"))
        # Scene 0 has both runway and ken_burns — runway should win
        ctx.runway_clips = [{"scene_id": 0, "path": "/runway.mp4", "status": "generated"}]
        ctx.ken_burns_clips = [{"scene_id": 0, "path": "/kb.mp4", "status": "generated"}]
        ctx.stock_clips = [{"scene_id": 1, "path": "/stock.mp4"}]

        timeline = _build_timeline(ctx)
        assert len(timeline) == 2
        assert timeline[0]["path"] == "/runway.mp4"  # Runway wins for scene 0
        assert timeline[1]["path"] == "/stock.mp4"  # Stock for scene 1


class TestProductionContext:
    def test_default_values(self):
        from mindarchive.production.steps import ProductionContext

        ctx = ProductionContext(project_slug="test", output_dir=Path("/tmp"))
        assert ctx.project_slug == "test"
        assert ctx.final_script == ""
        assert ctx.voiceover_path is None
        assert ctx.scene_images == []
        assert ctx.runway_max_scenes == 4

    def test_context_with_script(self):
        from mindarchive.production.steps import ProductionContext

        ctx = ProductionContext(
            project_slug="dark-triad",
            output_dir=Path("/tmp/dark-triad"),
            final_script="[DALLE: scene] Narration text here.",
            voice_settings={"voice_id": "abc123", "voice_model": "eleven_v3"},
        )
        assert "DALLE" in ctx.final_script
        assert ctx.voice_settings["voice_id"] == "abc123"


class TestProductionStepResult:
    def test_result_complete(self):
        from mindarchive.production.steps import ProductionStepResult

        r = ProductionStepResult(
            step_id="P1",
            status="complete",
            message="Voiceover: 1200 chars, 45.2s",
            cost_usd=0.36,
        )
        assert r.step_id == "P1"
        assert r.status == "complete"
        assert r.cost_usd == pytest.approx(0.36)

    def test_result_error(self):
        from mindarchive.production.steps import ProductionStepResult

        r = ProductionStepResult(
            step_id="P2",
            status="error",
            error="DALL-E rate limited",
        )
        assert r.status == "error"
        assert r.error is not None


class TestCompositor:
    def test_thumbnail_compositor_creates_file(self, tmp_dir: Path):
        """Test thumbnail composition with a real image."""
        from PIL import Image

        from mindarchive.production.compositor import ThumbnailCompositor

        # Create a test image
        img = Image.new("RGB", (1792, 1024), color=(50, 50, 80))
        base_path = tmp_dir / "base.png"
        img.save(base_path)

        output = tmp_dir / "thumb.jpg"
        comp = ThumbnailCompositor()
        result = comp.compose(
            base_image_path=base_path,
            text="TEST TEXT",
            output_path=output,
        )
        assert result.exists()
        assert result.stat().st_size > 0

        # Verify output dimensions
        thumb = Image.open(result)
        assert thumb.size == (1280, 720)

    def test_motion_graphic_renderer(self, tmp_dir: Path):
        from mindarchive.production.compositor import MotionGraphicRenderer

        renderer = MotionGraphicRenderer()
        output = tmp_dir / "mg.png"
        result = renderer.render_text_card(
            text="85% of leaders show Dark Triad traits",
            output_path=output,
            style="clean",
        )
        assert result.exists()

    def test_motion_graphic_stat_style(self, tmp_dir: Path):
        from mindarchive.production.compositor import MotionGraphicRenderer

        renderer = MotionGraphicRenderer()
        output = tmp_dir / "stat.png"
        result = renderer.render_text_card(
            text="85%\nOf Fortune 500 CEOs",
            output_path=output,
            style="stat",
        )
        assert result.exists()

    def test_ken_burns_generates_frames(self, tmp_dir: Path):
        from PIL import Image

        from mindarchive.production.compositor import KenBurnsGenerator

        # Create test image (must be larger than output resolution)
        img = Image.new("RGB", (2400, 1600), color=(30, 30, 60))
        img_path = tmp_dir / "scene.png"
        img.save(img_path)

        frames_dir = tmp_dir / "frames"
        kb = KenBurnsGenerator()
        frames = kb.generate_frames(
            image_path=img_path,
            output_dir=frames_dir,
            duration_seconds=1.0,
            fps=10,
            motion_type="slow_zoom_in",
            output_resolution=(640, 360),  # Smaller for fast test
        )
        assert len(frames) == 10
        assert all(f.exists() for f in frames)
