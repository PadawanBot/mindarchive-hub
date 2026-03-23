"""Project model — represents a single video production."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from mindarchive.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from mindarchive.models.asset import AssetRecord
    from mindarchive.models.cost import CostLedger
    from mindarchive.models.pipeline_run import PipelineRun


class Project(Base, TimestampMixin):
    """A video production project tied to a channel profile and format preset."""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(500))
    topic: Mapped[str] = mapped_column(String(500))
    keyword: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    search_volume: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    viral_score: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # Links
    profile_slug: Mapped[str] = mapped_column(String(200), index=True)
    format_preset: Mapped[str] = mapped_column(String(100))

    # Status
    status: Mapped[str] = mapped_column(
        String(50), default="created"
    )  # created, running, paused, complete, error
    current_step: Mapped[Optional[int]] = mapped_column(nullable=True)
    current_phase: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Paths
    output_dir: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Settings for this run
    mode: Mapped[str] = mapped_column(String(20), default="phase_gate")
    model: Mapped[str] = mapped_column(String(100), default="claude-sonnet-4-6")

    # Relationships
    runs: Mapped[list[PipelineRun]] = relationship(back_populates="project", cascade="all, delete")
    assets: Mapped[list[AssetRecord]] = relationship(
        back_populates="project", cascade="all, delete"
    )
    costs: Mapped[list[CostLedger]] = relationship(
        back_populates="project", cascade="all, delete"
    )
