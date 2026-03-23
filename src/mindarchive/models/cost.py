"""CostLedger model — tracks API costs per run and per step."""

from __future__ import annotations

from typing import Optional

from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from mindarchive.models.base import Base, TimestampMixin


class CostLedger(Base, TimestampMixin):
    """Tracks estimated and actual API costs per operation."""

    __tablename__ = "cost_ledger"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    run_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("pipeline_runs.id"), nullable=True
    )
    step_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Service: anthropic, elevenlabs, openai_dalle, pexels, runway, youtube
    service: Mapped[str] = mapped_column(String(100), index=True)
    operation: Mapped[str] = mapped_column(String(200))  # e.g. "generate_image", "tts"

    # Cost
    estimated_cost_usd: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    actual_cost_usd: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Usage details
    units_used: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    unit_type: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # tokens, characters, images, credits, seconds

    # Budget tracking
    budget_cap_usd: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    budget_warning_sent: Mapped[bool] = mapped_column(default=False)

    # Detail
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    project = relationship("Project", back_populates="costs")
