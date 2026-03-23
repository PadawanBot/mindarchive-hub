"""Project manager — CRUD operations for video production projects."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from slugify import slugify
from sqlalchemy import select
from sqlalchemy.orm import Session

from mindarchive.config.settings import AppSettings
from mindarchive.models.project import Project
from mindarchive.models.pipeline_run import PipelineRun, StepResult
from mindarchive.models.base import utcnow


class ProjectManager:
    """Manages project lifecycle — creation, querying, output directory setup."""

    def __init__(self, session: Session, settings: AppSettings) -> None:
        self._session = session
        self._settings = settings

    def create_project(
        self,
        topic: str,
        profile_slug: str,
        format_preset: str,
        mode: str = "phase_gate",
        model: str = "claude-sonnet-4-6",
        title: str | None = None,
        keyword: str | None = None,
    ) -> Project:
        """Create a new project and its output directory."""
        title = title or topic
        slug = self._generate_slug(topic)

        # Create output directory
        output_dir = self._settings.projects_dir / slug
        output_dir.mkdir(parents=True, exist_ok=True)

        # Create subdirectories
        for sub in ["scripts", "visuals", "audio", "video", "thumbnails", "metadata"]:
            (output_dir / sub).mkdir(exist_ok=True)

        project = Project(
            slug=slug,
            title=title,
            topic=topic,
            keyword=keyword,
            profile_slug=profile_slug,
            format_preset=format_preset,
            mode=mode,
            model=model,
            output_dir=str(output_dir),
            status="created",
        )
        self._session.add(project)
        self._session.flush()
        return project

    def get_by_slug(self, slug: str) -> Project | None:
        """Find a project by slug."""
        stmt = select(Project).where(Project.slug == slug)
        return self._session.execute(stmt).scalar_one_or_none()

    def list_projects(
        self,
        profile_slug: str | None = None,
        status: str | None = None,
        limit: int = 50,
    ) -> list[Project]:
        """List projects with optional filters."""
        stmt = select(Project).order_by(Project.created_at.desc()).limit(limit)
        if profile_slug:
            stmt = stmt.where(Project.profile_slug == profile_slug)
        if status:
            stmt = stmt.where(Project.status == status)
        return list(self._session.execute(stmt).scalars().all())

    def update_status(self, project: Project, status: str, step: int | None = None) -> None:
        """Update project status and current step."""
        project.status = status
        if step is not None:
            project.current_step = step
        self._session.flush()

    def create_run(self, project: Project) -> PipelineRun:
        """Create a new pipeline run for a project."""
        # Determine run number
        existing_runs = len(project.runs) if project.runs else 0
        run = PipelineRun(
            project_id=project.id,
            run_number=existing_runs + 1,
            status="running",
            mode=project.mode,
            model=project.model,
            started_at=utcnow(),
        )
        self._session.add(run)
        self._session.flush()
        return run

    def create_step_result(
        self,
        run: PipelineRun,
        step_number: int,
        step_name: str,
    ) -> StepResult:
        """Create a step result record."""
        # Check for existing versions of this step in this run
        stmt = (
            select(StepResult)
            .where(StepResult.run_id == run.id, StepResult.step_number == step_number)
            .order_by(StepResult.version.desc())
        )
        existing = self._session.execute(stmt).scalar_one_or_none()
        version = (existing.version + 1) if existing else 1

        result = StepResult(
            run_id=run.id,
            step_number=step_number,
            step_name=step_name,
            status="running",
            version=version,
            started_at=utcnow(),
        )
        self._session.add(result)
        self._session.flush()
        return result

    def complete_step(
        self,
        step_result: StepResult,
        artifact_name: str | None = None,
        artifact_path: str | None = None,
        summary: str | None = None,
        key_output: str | None = None,
        quality_score: float | None = None,
        quality_notes: str | None = None,
    ) -> None:
        """Mark a step as complete with its outputs."""
        step_result.status = "complete"
        step_result.completed_at = utcnow()
        if step_result.started_at:
            delta = step_result.completed_at - step_result.started_at
            step_result.duration_seconds = delta.total_seconds()
        step_result.artifact_name = artifact_name
        step_result.artifact_path = artifact_path
        step_result.summary = summary
        step_result.key_output = key_output
        step_result.quality_score = quality_score
        step_result.quality_notes = quality_notes
        self._session.flush()

    def fail_step(self, step_result: StepResult, error: str) -> None:
        """Mark a step as failed."""
        step_result.status = "error"
        step_result.completed_at = utcnow()
        step_result.error_detail = error
        if step_result.started_at:
            delta = step_result.completed_at - step_result.started_at
            step_result.duration_seconds = delta.total_seconds()
        self._session.flush()

    def pause_step(self, step_result: StepResult) -> None:
        """Pause a step at a confirmation gate."""
        step_result.status = "paused"
        self._session.flush()

    def skip_step(self, step_result: StepResult, reason: str = "") -> None:
        """Skip a step."""
        step_result.status = "skipped"
        step_result.summary = reason
        step_result.completed_at = utcnow()
        self._session.flush()

    def complete_run(self, run: PipelineRun) -> None:
        """Mark a run as complete."""
        run.status = "complete"
        run.completed_at = utcnow()
        self._session.flush()

    def fail_run(self, run: PipelineRun, error: str) -> None:
        """Mark a run as failed."""
        run.status = "error"
        run.completed_at = utcnow()
        run.error_detail = error
        self._session.flush()

    def save_artifact(
        self,
        project: Project,
        filename: str,
        content: str,
        subdir: str = "metadata",
    ) -> Path:
        """Save a text artifact to the project output directory."""
        output_dir = Path(project.output_dir) if project.output_dir else self._settings.projects_dir / project.slug
        artifact_path = output_dir / subdir / filename
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(content)
        return artifact_path

    def save_json_artifact(
        self,
        project: Project,
        filename: str,
        data: Any,
        subdir: str = "metadata",
    ) -> Path:
        """Save a JSON artifact to the project output directory."""
        content = json.dumps(data, indent=2, ensure_ascii=False)
        return self.save_artifact(project, filename, content, subdir)

    def _generate_slug(self, topic: str) -> str:
        """Generate a unique slug from a topic."""
        base_slug = slugify(topic, separator="-", max_length=60)
        slug = base_slug
        counter = 1
        while self.get_by_slug(slug) is not None:
            slug = f"{base_slug}-{counter}"
            counter += 1
        return slug
