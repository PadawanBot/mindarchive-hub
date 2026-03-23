"""PipelineRun and StepResult models — track pipeline execution."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from mindarchive.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from mindarchive.models.project import Project


class PipelineRun(Base, TimestampMixin):
    """A single execution run of the pipeline for a project."""

    __tablename__ = "pipeline_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    run_number: Mapped[int] = mapped_column(default=1)
    status: Mapped[str] = mapped_column(
        String(50), default="running"
    )  # running, paused, complete, error
    mode: Mapped[str] = mapped_column(String(20), default="phase_gate")
    model: Mapped[str] = mapped_column(String(100), default="claude-sonnet-4-6")
    started_at: Mapped[datetime] = mapped_column()
    completed_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    error_detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    project: Mapped[Project] = relationship(back_populates="runs")
    steps: Mapped[list[StepResult]] = relationship(back_populates="run", cascade="all, delete")


class StepResult(Base, TimestampMixin):
    """Result of a single pipeline step within a run."""

    __tablename__ = "step_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("pipeline_runs.id"), index=True)
    step_number: Mapped[int] = mapped_column()
    step_name: Mapped[str] = mapped_column(String(100))

    # Status: pending, running, complete, skipped, error, paused
    status: Mapped[str] = mapped_column(String(50), default="pending")

    # Versioning — supports re-runs producing new versions
    version: Mapped[int] = mapped_column(default=1)

    # Output
    artifact_name: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    artifact_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    key_output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Quality scoring (automated check after each step)
    quality_score: Mapped[Optional[float]] = mapped_column(nullable=True)
    quality_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Timing
    started_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    duration_seconds: Mapped[Optional[float]] = mapped_column(nullable=True)

    # Error info
    error_detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(default=0)

    # Relationships
    run: Mapped[PipelineRun] = relationship(back_populates="steps")


class Approval(Base, TimestampMixin):
    """Human approval/rejection record for a gate pause."""

    __tablename__ = "approvals"

    id: Mapped[int] = mapped_column(primary_key=True)
    step_result_id: Mapped[int] = mapped_column(ForeignKey("step_results.id"), index=True)
    decision: Mapped[str] = mapped_column(String(20))  # approved, rejected, adjusted
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    adjustment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    decided_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    decided_at: Mapped[datetime] = mapped_column()
