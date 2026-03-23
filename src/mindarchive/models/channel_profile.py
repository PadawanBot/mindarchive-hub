"""ChannelProfile model — database record for channel profiles."""

from __future__ import annotations

from typing import Optional

from sqlalchemy import JSON, Boolean, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from mindarchive.models.base import Base, TimestampMixin


class ChannelProfile(Base, TimestampMixin):
    """Database record for a channel profile. Full config lives in TOML on disk."""

    __tablename__ = "channel_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(300))
    niche: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Voice settings (locked once configured)
    voice_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    voice_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    voice_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    voice_model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    voice_stability: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    voice_similarity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    voice_style: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    voice_base_wpm: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    voice_slow_wpm: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Brand settings (locked once configured)
    brand_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    brand_intro_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    brand_icon_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Production defaults
    default_format: Mapped[str] = mapped_column(String(100), default="documentary")
    default_model: Mapped[str] = mapped_column(String(100), default="claude-sonnet-4-6")
    runway_max_scenes: Mapped[int] = mapped_column(Integer, default=4)

    # Visual style
    dalle_style_suffix: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    visual_style: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    tone_instruction: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    style_model: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Profile directory on disk
    profile_dir: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Counters
    published_count: Mapped[int] = mapped_column(Integer, default=0)
    avg_views: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Upload settings
    upload_frequency: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    upload_timezone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Notification preferences (JSON: {"provider": "telegram", "chat_id": "..."})
    notification_config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
