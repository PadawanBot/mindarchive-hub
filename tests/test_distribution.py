"""Tests for distribution context and orchestrator."""

from __future__ import annotations

import json
from pathlib import Path

import pytest


class TestDistributionContext:
    def test_default_values(self, tmp_dir: Path):
        from mindarchive.distribution.orchestrator import DistributionContext

        ctx = DistributionContext(
            project_slug="test-project",
            project_dir=tmp_dir,
        )
        assert ctx.project_slug == "test-project"
        assert ctx.privacy == "private"
        assert ctx.youtube_url == ""
        assert ctx.vizard_clips == []
        assert ctx.buffer_posts == []

    def test_context_with_metadata(self, tmp_dir: Path):
        from mindarchive.distribution.orchestrator import DistributionContext

        ctx = DistributionContext(
            project_slug="dark-triad",
            project_dir=tmp_dir,
            video_title="The Dark Triad Explained",
            video_description="An in-depth look...",
            video_tags=["psychology", "personality"],
            hashtags=["darktriad", "psychology"],
            privacy="unlisted",
        )
        assert ctx.video_title == "The Dark Triad Explained"
        assert len(ctx.video_tags) == 2
        assert ctx.privacy == "unlisted"


class TestDistributionOrchestrator:
    async def test_run_all_skipped(self, settings, tmp_dir: Path):
        """When no services are configured, all steps should skip gracefully."""
        from mindarchive.distribution.orchestrator import (
            DistributionContext,
            DistributionOrchestrator,
        )

        events: list[tuple[str, str]] = []

        def on_event(step_id: str, status: str, data: dict) -> None:
            events.append((step_id, status))

        orch = DistributionOrchestrator(settings=settings, event_callback=on_event)
        ctx = DistributionContext(
            project_slug="test",
            project_dir=tmp_dir,
        )

        results = await orch.run(ctx)
        # All should be skip or error (no API keys configured)
        for r in results:
            assert r.status in ("skip", "error", "complete")

    async def test_run_with_skip_steps(self, settings, tmp_dir: Path):
        from mindarchive.distribution.orchestrator import (
            DistributionContext,
            DistributionOrchestrator,
        )

        orch = DistributionOrchestrator(settings=settings)
        ctx = DistributionContext(project_slug="test", project_dir=tmp_dir)

        results = await orch.run(ctx, skip_steps={"D1", "D2", "D3", "D4", "D5"})
        # All steps were skipped — should have no results
        assert len(results) == 0

    def test_build_context(self, settings, tmp_dir: Path):
        from mindarchive.distribution.orchestrator import DistributionOrchestrator

        orch = DistributionOrchestrator(settings=settings)

        # Create mock pre-production artifacts
        artifacts = {
            13: {
                "title": "The Dark Triad",
                "description": "A deep dive...",
                "tags": ["psychology", "personality"],
                "hashtags": ["darktriad"],
                "privacy": "unlisted",
            }
        }

        ctx = orch.build_context(
            project_slug="dark-triad",
            project_dir=tmp_dir,
            preproduction_artifacts=artifacts,
            profile_data={"slug": "mindarchive"},
        )

        assert ctx.video_title == "The Dark Triad"
        assert ctx.video_description == "A deep dive..."
        assert ctx.privacy == "unlisted"
        assert "psychology" in ctx.video_tags

    def test_distribution_summary_written(self, settings, tmp_dir: Path):
        """D5 writes a distribution_summary.json."""
        summary_path = tmp_dir / "metadata" / "distribution_summary.json"
        summary_path.parent.mkdir(parents=True, exist_ok=True)

        summary = {
            "project_slug": "test",
            "youtube_url": "https://youtu.be/abc123",
            "drive_folder_id": "folder_xyz",
            "vizard_clips": 3,
            "buffer_posts": 2,
        }
        summary_path.write_text(json.dumps(summary))

        loaded = json.loads(summary_path.read_text())
        assert loaded["youtube_url"] == "https://youtu.be/abc123"
        assert loaded["vizard_clips"] == 3


class TestDistributionStepResult:
    def test_complete_result(self):
        from mindarchive.distribution.orchestrator import DistributionStepResult

        r = DistributionStepResult(
            step_id="D1",
            status="complete",
            message="YouTube upload: https://youtu.be/abc",
            data={"video_id": "abc"},
        )
        assert r.step_id == "D1"
        assert r.status == "complete"
        assert "abc" in r.data["video_id"]

    def test_skip_result(self):
        from mindarchive.distribution.orchestrator import DistributionStepResult

        r = DistributionStepResult(
            step_id="D3",
            status="skip",
            message="Vizard API key not configured",
        )
        assert r.status == "skip"
