"""FormatPreset model — database record for video format presets."""

from __future__ import annotations

from typing import Optional

from sqlalchemy import Boolean, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from mindarchive.models.base import Base, TimestampMixin


class FormatPreset(Base, TimestampMixin):
    """A video format preset defining content parameters."""

    __tablename__ = "format_presets"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    builtin: Mapped[bool] = mapped_column(Boolean, default=False)

    # Duration & pacing
    target_duration_min: Mapped[int] = mapped_column(Integer)  # e.g. 9
    duration_range_min: Mapped[int] = mapped_column(Integer)   # e.g. 8
    duration_range_max: Mapped[int] = mapped_column(Integer)   # e.g. 10
    base_wpm: Mapped[int] = mapped_column(Integer, default=140)

    # Word count (derived from duration × WPM)
    target_words: Mapped[int] = mapped_column(Integer)         # e.g. 1260
    word_range_min: Mapped[int] = mapped_column(Integer)       # e.g. 1120
    word_range_max: Mapped[int] = mapped_column(Integer)       # e.g. 1400

    # Structure
    structure: Mapped[str] = mapped_column(
        String(200), default="3-act structure"
    )
    cold_open_max_seconds: Mapped[int] = mapped_column(Integer, default=7)
    retention_checkpoints: Mapped[int] = mapped_column(Integer, default=5)

    # Visual parameters
    visual_density: Mapped[str] = mapped_column(
        String(50), default="medium"
    )  # low, medium, high
    runway_max_scenes: Mapped[int] = mapped_column(Integer, default=4)
    stock_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 0.0-1.0

    # Tone & style
    tone_instruction: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    style_model: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    visual_style: Mapped[Optional[str]] = mapped_column(
        String(200), default="cinematic, documentary, stylized realism"
    )
