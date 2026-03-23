"""AssetRecord model — tracks individual generated assets (images, clips, graphics)."""

from __future__ import annotations

from typing import Optional

from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from mindarchive.models.base import Base, TimestampMixin


class AssetRecord(Base, TimestampMixin):
    """Individual asset generated during production (DALL-E image, Pexels clip, etc.)."""

    __tablename__ = "asset_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    step_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    scene_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Asset type: dalle, stock, runway, graphic, voiceover, thumbnail, video_final
    asset_type: Mapped[str] = mapped_column(String(50), index=True)
    file_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    file_size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Generation info
    prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    provider: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    model_used: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Status: pending, generating, generated, approved, rejected, error
    status: Mapped[str] = mapped_column(String(50), default="pending")
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Version — supports regeneration without overwriting
    version: Mapped[int] = mapped_column(Integer, default=1)

    # Cost tracking
    estimated_cost_usd: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    actual_cost_usd: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Duration (for video/audio assets)
    duration_seconds: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Relationships
    project = relationship("Project", back_populates="assets")
