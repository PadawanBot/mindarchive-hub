"""Tests for pipeline orchestrator, step base, and step context."""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

import pytest


class TestStepContext:
    def test_create_context(self, tmp_dir: Path):
        from mindarchive.pipeline.step_base import StepContext

        ctx = StepContext(
            project_slug="test-project",
            topic="Dark Triad",
            step_number=2,
            profile={"slug": "mindarchive", "niche": "psychology"},
            format_preset={"slug": "documentary", "target_words": 1260},
            output_dir=tmp_dir,
            artifacts={},
            extra_vars={},
        )
        assert ctx.project_slug == "test-project"
        assert ctx.topic == "Dark Triad"
        assert ctx.step_number == 2

    def test_context_artifacts(self, tmp_dir: Path):
        from mindarchive.pipeline.step_base import StepContext

        ctx = StepContext(
            project_slug="test",
            topic="Topic",
            step_number=5,
            profile={},
            format_preset={},
            output_dir=tmp_dir,
            artifacts={2: "Previous script content"},
            extra_vars={},
        )
        assert 2 in ctx.artifacts
        assert ctx.artifacts[2] == "Previous script content"


class TestStepOutput:
    def test_success_output(self):
        from mindarchive.pipeline.step_base import StepOutput

        out = StepOutput(
            step_number=2,
            step_name="Script Writer",
            status="complete",
            artifact_name="script.md",
            content="The script content...",
            summary="Generated 1260-word script",
            quality_score=0.85,
        )
        assert out.is_success is True
        assert out.step_name == "Script Writer"

    def test_error_output(self):
        from mindarchive.pipeline.step_base import StepOutput

        out = StepOutput(
            step_number=2,
            step_name="Script Writer",
            status="error",
            artifact_name=None,
            error="API call failed",
        )
        assert out.is_success is False
        assert out.error == "API call failed"

    def test_skipped_output(self):
        from mindarchive.pipeline.step_base import StepOutput

        out = StepOutput(
            step_number=4,
            step_name="Voice Crafter",
            status="skipped",
            artifact_name=None,
            summary="Voice already locked in profile",
        )
        assert out.status == "skipped"
        # Skipped counts as success in the pipeline (not an error)
        assert out.is_success is True


class TestPipelineEvent:
    def test_event_creation(self):
        from mindarchive.pipeline.orchestrator import PipelineEvent

        event = PipelineEvent(
            event_type="step_complete",
            step_number=3,
            step_name="Hook Generator",
            message="Generated 3 hooks",
            data={"quality_score": 0.9},
        )
        assert event.event_type == "step_complete"
        assert event.step_number == 3
        assert event.data["quality_score"] == 0.9


class TestPipelineOrchestrator:
    def test_run_mode_enum(self):
        from mindarchive.pipeline.orchestrator import RunMode

        assert RunMode.AUTO.value == "auto"
        assert RunMode.GATE.value == "gate"
        assert RunMode.PHASE_GATE.value == "phase_gate"
